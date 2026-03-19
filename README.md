# Claude Blocker

Block distracting websites unless [Claude Code](https://claude.ai/claude-code) is actively running inference.

**The premise is simple:** if Claude is working, you should be too. When Claude stops, your distractions come back.

## How It Works

```
┌─────────────────┐     hooks      ┌─────────────────┐    websocket    ┌─────────────────┐
│   Claude Code   │ ─────────────► │  Blocker Server │ ◄─────────────► │ Chrome Extension│
│   (terminal)    │                │  (localhost)    │                 │   (browser)     │
└─────────────────┘                └─────────────────┘                 └─────────────────┘
       │                                   │                                   │
       │ UserPromptSubmit                  │ tracks sessions                   │ blocks sites
       │ PreToolUse                        │ broadcasts state                  │ shows modal
       │ Stop                              │                                   │ bypass button
       └───────────────────────────────────┴───────────────────────────────────┘
```

1. **Claude Code hooks** notify the server when you submit a prompt or when Claude finishes
2. **Blocker server** tracks all Claude Code sessions and their working/idle states
3. **Chrome extension** blocks configured sites when no session is actively working

## Quick Start

### 1. Install the server

```bash
npx claude-blocker --setup
```

This installs the Claude Code hooks and starts the server. The hooks are configured in `~/.claude/settings.json`.

> **Note:** If Claude Code is already running, you'll need to restart it for the hooks to take effect. Claude Code loads hooks at startup.

### 2. Install the Chrome extension

- Download from [Chrome Web Store](#) *(coming soon)*
- Or load unpacked from `packages/extension/dist`

### 3. Configure blocked sites

Click the extension icon → Settings to add sites you want blocked when Claude is idle.

Default blocked sites: `x.com`, `youtube.com`

## Server CLI

```bash
# Start with auto-setup (recommended for first run)
npx claude-blocker --setup

# Start on custom port
npx claude-blocker --port 9000

# Remove hooks from Claude Code settings
npx claude-blocker --remove

# Show help
npx claude-blocker --help
```

## Features

- **Soft blocking** — Sites show a modal overlay, not a hard block
- **Real-time updates** — No page refresh needed when state changes
- **Multi-session support** — Tracks multiple Claude Code instances
- **Emergency bypass** — 5-minute bypass, once per day
- **Configurable sites** — Add/remove sites from extension settings
- **Works offline** — Blocks everything when server isn't running (safety default)

## Requirements

- Node.js 18+
- Chrome (or Chromium-based browser)
- [Claude Code](https://claude.ai/claude-code)

## Using with GitHub Codespaces

Claude Blocker works with GitHub Codespaces! When you run Claude Code in a Codespace, the extension on your local browser can still connect to block distracting sites.

### Setup

1. **Start the server in your Codespace:**
   ```bash
   npx claude-blocker --setup
   ```
   The server will detect the Codespace environment and display the forwarded URL.

2. **Forward the port:**
   - Open the "Ports" tab in VS Code (or the Codespace web UI)
   - Find port `8765` (or your custom port)
   - Set visibility to **Public** (required for the extension to connect)

3. **Configure the extension:**
   - Click the Claude Blocker extension icon → Settings
   - In the "Server Connection" section, paste the forwarded URL:
     ```text
     wss://YOUR-CODESPACE-NAME-8765.app.github.dev/ws
     ```
   - Click "Save"

4. **Verify connection:**
   - The extension status should show "Connected"
   - When Claude is working in your Codespace, distractions will be blocked on your local browser

### How it works

```text
┌─────────────────────┐                    ┌─────────────────────┐
│   GitHub Codespace  │                    │   Your Local PC     │
│                     │                    │                     │
│  ┌───────────────┐  │     Forwarded      │  ┌───────────────┐  │
│  │  Claude Code  │  │       Port         │  │    Chrome     │  │
│  │   (hooks)     │──┼──►  8765  ◄────────┼──│   Extension   │  │
│  └───────────────┘  │                    │  └───────────────┘  │
│         │           │                    │         │           │
│         ▼           │                    │         ▼           │
│  ┌───────────────┐  │                    │  Blocks sites when  │
│  │    Server     │  │                    │  Claude is idle     │
│  │  (localhost)  │  │                    │                     │
│  └───────────────┘  │                    │                     │
└─────────────────────┘                    └─────────────────────┘
```

The hooks still use `localhost` inside the Codespace (container-to-container), but the extension connects via the public forwarded URL.

## Development

```bash
# Clone and install
git clone https://github.com/t3-content/claude-blocker.git
cd claude-blocker
pnpm install

# Build everything
pnpm build

# Development mode
pnpm dev
```

### Project Structure

```
packages/
├── server/      # Node.js server + CLI (published to npm)
├── extension/   # Chrome extension (Manifest V3)
└── shared/      # Shared TypeScript types
```

## Privacy

- **No data collection** — All data stays on your machine
- **Local only** — Server runs on localhost, no external connections
- **Chrome sync** — Blocked sites list syncs via your Chrome account (if enabled)

See [PRIVACY.md](PRIVACY.md) for full privacy policy.

## License

MIT © [Theo Browne](https://github.com/t3dotgg)
