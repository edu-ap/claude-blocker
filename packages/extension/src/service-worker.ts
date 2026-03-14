export {};

const DEFAULT_WS_URL = "ws://localhost:8765/ws";
const KEEPALIVE_INTERVAL = 20_000;
const RECONNECT_BASE_DELAY = 1_000;
const RECONNECT_MAX_DELAY = 30_000;

// Configurable WebSocket URL (loaded from storage)
let wsUrl = DEFAULT_WS_URL;

// The actual state - service worker is single source of truth
interface State {
  serverConnected: boolean;
  sessions: number;
  working: number;
  waitingForInput: number;
  bypassUntil: number | null;
}

const state: State = {
  serverConnected: false,
  sessions: 0,
  working: 0,
  waitingForInput: 0,
  bypassUntil: null,
};

let websocket: WebSocket | null = null;
let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;

// Notification state
let notificationsEnabled = true;
let lastNotifyTime = 0;
const NOTIFY_COOLDOWN_MS = 30_000; // 30 seconds between notifications
let previousWorking = 0;

// Notify when any Claude session stops working
function maybeNotifyInputNeeded(): void {
  if (!notificationsEnabled) return;
  if (state.sessions === 0) return;

  const now = Date.now();
  if (now - lastNotifyTime < NOTIFY_COOLDOWN_MS) return;

  // Notify when working count decreases (a session finished)
  if (state.working < previousWorking) {
    lastNotifyTime = now;
    const title = state.waitingForInput > 0
      ? "Claude is waiting for your answer"
      : "Claude needs your input";
    // Clear first to ensure Chrome shows a fresh notification
    chrome.notifications.clear("claude-input-needed", () => {
      chrome.notifications.create("claude-input-needed", {
        type: "basic",
        iconUrl: "icon-128.png",
        title,
        message: "Claude Code has finished and is waiting for you.",
        priority: 2,
        requireInteraction: true,
      });
    });
  }
}

// Clear notification when user submits input (working resumes)
function maybeClearNotification(): void {
  if (state.working > previousWorking) {
    chrome.notifications.clear("claude-input-needed");
  }
}

// Load config from storage
async function loadConfig(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["serverUrl", "bypassUntil", "notificationsEnabled"], (result) => {
      if (result.serverUrl) {
        wsUrl = result.serverUrl;
        console.log("[Claude Blocker] Using custom server URL:", wsUrl);
      }
      if (result.bypassUntil && result.bypassUntil > Date.now()) {
        state.bypassUntil = result.bypassUntil;
      }
      if (result.notificationsEnabled !== undefined) {
        notificationsEnabled = result.notificationsEnabled;
      }
      resolve();
    });
  });
}

// Listen for config changes (reconnect if URL changes)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.serverUrl) {
    const newUrl = changes.serverUrl.newValue || DEFAULT_WS_URL;
    if (newUrl !== wsUrl) {
      console.log("[Claude Blocker] Server URL changed, reconnecting...");
      wsUrl = newUrl;
      // Close existing connection to trigger reconnect
      if (websocket) {
        websocket.close();
      }
    }
  }
});

// Compute derived state
function getPublicState() {
  const bypassActive = state.bypassUntil !== null && state.bypassUntil > Date.now();
  // Block unless ALL sessions are actively working (none idle, none waiting)
  const allWorking = state.serverConnected && state.sessions > 0 && state.working === state.sessions;
  const shouldBlock = !bypassActive && !allWorking;

  return {
    serverConnected: state.serverConnected,
    sessions: state.sessions,
    working: state.working,
    waitingForInput: state.waitingForInput,
    blocked: shouldBlock,
    bypassActive,
    bypassUntil: state.bypassUntil,
  };
}

// Broadcast current state to all tabs
function broadcast() {
  const publicState = getPublicState();
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: "STATE", ...publicState }).catch(() => {});
      }
    }
  });
}

// WebSocket connection management
function connect() {
  if (websocket?.readyState === WebSocket.OPEN) return;
  if (websocket?.readyState === WebSocket.CONNECTING) return;

  try {
    websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
      console.log("[Claude Blocker] Connected");
      state.serverConnected = true;
      retryCount = 0;
      startKeepalive();
      broadcast();
    };

    websocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "state") {
          previousWorking = state.working;
          state.sessions = msg.sessions;
          state.working = msg.working;
          state.waitingForInput = msg.waitingForInput ?? 0;

          maybeClearNotification();
          maybeNotifyInputNeeded();
          previousWorking = state.working;

          broadcast();
        }
      } catch {}
    };

    websocket.onclose = () => {
      console.log("[Claude Blocker] Disconnected");
      state.serverConnected = false;
      stopKeepalive();
      broadcast();
      scheduleReconnect();
    };

    websocket.onerror = () => {
      state.serverConnected = false;
      stopKeepalive();
    };
  } catch {
    scheduleReconnect();
  }
}

function startKeepalive() {
  stopKeepalive();
  keepaliveInterval = setInterval(() => {
    if (websocket?.readyState === WebSocket.OPEN) {
      websocket.send(JSON.stringify({ type: "ping" }));
    }
  }, KEEPALIVE_INTERVAL);
}

function stopKeepalive() {
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, retryCount), RECONNECT_MAX_DELAY);
  retryCount++;
  reconnectTimeout = setTimeout(connect, delay);
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_STATE") {
    sendResponse(getPublicState());
    return true;
  }

  if (message.type === "ACTIVATE_BYPASS") {
    const today = new Date().toDateString();
    chrome.storage.sync.get(["lastBypassDate"], (result) => {
      if (result.lastBypassDate === today) {
        sendResponse({ success: false, reason: "Already used today" });
        return;
      }
      state.bypassUntil = Date.now() + 5 * 60 * 1000;
      chrome.storage.sync.set({ bypassUntil: state.bypassUntil, lastBypassDate: today });
      broadcast();
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === "GET_BYPASS_STATUS") {
    const today = new Date().toDateString();
    chrome.storage.sync.get(["lastBypassDate"], (result) => {
      sendResponse({
        usedToday: result.lastBypassDate === today,
        bypassActive: state.bypassUntil !== null && state.bypassUntil > Date.now(),
        bypassUntil: state.bypassUntil,
      });
    });
    return true;
  }

  if (message.type === "SET_NOTIFICATIONS") {
    notificationsEnabled = message.enabled;
    chrome.storage.sync.set({ notificationsEnabled: message.enabled });
    sendResponse({ success: true });
    return true;
  }

  return false;
});

// Click on notification focuses the Codespace tab
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === "claude-input-needed") {
    chrome.notifications.clear(notificationId);
    chrome.tabs.query({}, (tabs) => {
      const codespaceTab = tabs.find((t) =>
        t.url?.includes(".github.dev") || t.url?.includes("github.dev/")
      );
      if (codespaceTab?.id) {
        chrome.tabs.update(codespaceTab.id, { active: true });
        if (codespaceTab.windowId) {
          chrome.windows.update(codespaceTab.windowId, { focused: true });
        }
      } else {
        chrome.tabs.create({ url: "https://spidery-graveyard-657rj7gvvx3r95p.github.dev/" });
      }
    });
  }
});

// Listen for notification setting changes from options page
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes.notificationsEnabled) {
    notificationsEnabled = changes.notificationsEnabled.newValue ?? true;
  }
});

// Check bypass expiry
setInterval(() => {
  if (state.bypassUntil && state.bypassUntil <= Date.now()) {
    state.bypassUntil = null;
    chrome.storage.sync.remove("bypassUntil");
    broadcast();
  }
}, 5000);

// Click extension icon: focus the Codespace tab instead of showing popup
chrome.action.onClicked.addListener(() => {
  chrome.tabs.query({}, (tabs) => {
    const codespaceTab = tabs.find((t) =>
      t.url?.includes(".github.dev") || t.url?.includes("github.dev/")
    );
    if (codespaceTab?.id) {
      chrome.tabs.update(codespaceTab.id, { active: true });
      if (codespaceTab.windowId) {
        chrome.windows.update(codespaceTab.windowId, { focused: true });
      }
    } else {
      // No codespace tab found, open one
      chrome.tabs.create({ url: "https://spidery-graveyard-657rj7gvvx3r95p.github.dev/" });
    }
  });
});

// Start - load config first, then connect
loadConfig().then(() => {
  connect();
});
