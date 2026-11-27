# Tinkr

A modular, agentic code editor. Think Claude Desktop and VSCode in one window, built on Tauri.

Tinkr ships with a minimal core. Everything else, including the editor, chat, file tree, terminal, and diff review, is a plugin. Claude can write new plugins for you while the app is running.

> **Status:** Milestone 8 of 10. Themes: pick one in the Appearance panel (including see-through panels over animated backgrounds), or add your own as a plugin, even as plain JSON. Everything in the window is a plugin, including the built-in panels, and plugins you drop into `~/.config/tinkr/plugins` load and hot-reload while Tinkr runs. Panels dock anywhere: drag a tab to split or stack it, switch between the chat-first "Agent" layout and a classic "Editor" layout (Ctrl+Alt+1/2), or save your own. A chat-first app that works as a Claude Desktop replacement: past chats in the sidebar (reopen, continue, rename, delete), including the ones you started in the Claude Code CLI or Claude Desktop's Code tab, from every folder; chats with or without a project folder; images, PDFs and text files by paste, drop or the Attach button; and a model and effort picker. In a project folder, every edit Claude makes shows up as a diff you accept or reject chunk by chunk, and shell commands ask first. Select code and press Ctrl+L (or right-click) to ask Claude about it or request changes. There's a file tree, an editor that opens beside the chat when needed, and a terminal (Ctrl+`). Next: Claude writing plugins for you, inside Tinkr. See [SPEC.md](SPEC.md) for the full design and the [roadmap](#roadmap) below.

## Features (planned)

- **Watch Claude work live.** Agent edits stream into the editor as inline diffs. Accept, reject, or comment on each hunk, or edit by hand at any time.
- **Everything is a component.** Panels are dockable, resizable, and replaceable. Save layouts as presets (e.g. "Editor", "Agent") and switch with a hotkey.
- **Plugins all the way down.** A plugin is a folder with a `plugin.json` and an ES module. No build step required. Hot reloads on save.
- **Claude-authored plugins.** Ask Claude for a new panel or command; it writes the plugin, reloads it, and fixes its own errors.
- **Full theming.** Design tokens as CSS variables, plus image or SVG (including animated) backgrounds.
- **Uses your existing Claude login.** No separate sign-in. Tinkr uses your Claude Code subscription or an `ANTHROPIC_API_KEY`.

## Architecture

```
Webview (Vue core + plugins) <-- Tauri IPC/events --> Rust core <-- stdio JSON lines --> Agent sidecar (Bun + Claude Agent SDK)
```

| Layer | Choice |
|---|---|
| Shell | Tauri 2 (Rust) |
| UI | Vue 3, Vite, TypeScript, Pinia |
| Docking | dockview |
| Editor | CodeMirror 6 |
| Terminal | xterm.js + `portable-pty` |
| Agent | Claude Agent SDK in a compiled Bun sidecar |

The Rust core stays thin: window and config, sidecar management, file watching, PTY, and host API permissions. Everything else lives in TypeScript.

## Writing a plugin

A plugin is a folder in `~/.config/tinkr/plugins/<name>/` with a `plugin.json` and an ES module. No build step:

```json
{ "name": "notes", "displayName": "Notes", "version": "0.1.0", "main": "index.js", "permissions": ["agent"] }
```

```js
export function activate(api) {
  api.panels.register({
    id: 'notes',
    title: 'Notes',
    location: 'right',
    mount(el, ctx) {
      el.textContent = 'Hello from a plugin' // any framework, or none
      return () => {} // cleanup
    },
  })
  api.commands.register({ id: 'hello', title: 'Notes: say hello', keybinding: 'Ctrl+Alt+H', run: () => api.notifications.info('Hello') })
  api.actions.register({ id: 'open', slot: 'titlebar', title: 'Notes', run: () => api.layout.show('notes.notes') })
}
```

Plugins add panels, commands (with keybindings, listed in the command palette, Ctrl+Shift+P), buttons in the titlebar, status bar, chat toolbar or the selection menu, and layout presets. The host API covers the open folder's files, the editor, Claude, the terminal, settings and notifications; see [`src/plugins/api.ts`](src/plugins/api.ts) for all of it, and [`examples/plugins/word-count`](examples/plugins/word-count) for a working example. Save a file and the plugin reloads; errors show in the Console panel, with a button to hand them to Claude.

A theme can be a plugin with no code: list JSON files in `plugin.json` (`"themes": ["mytheme.json"]`), each with a `kind` (`dark` or `light`), the colors to change (`tokens`, e.g. `"accent": "#3fb0c9"`), and optionally a background picture (PNG, JPEG, WebP, GIF or SVG, animated ones too), how see-through the panels are over it, blur, and a CSS file. See [`examples/plugins/harbor-theme`](examples/plugins/harbor-theme).

Plugins are trusted code: they run inside Tinkr with access to your files, terminals and Claude. Tinkr asks before running a plugin it hasn't seen before; only turn on plugins you trust.

## Roadmap

1. ✅ Window, chat UI, sidecar streaming Claude responses
2. ✅ File tree + CodeMirror
3. ✅ Terminal
4. ✅ Claude edits files with review (live diffs, accept/reject/comment), "Ask Claude" selection menu, chat-first layout
5. ✅ Desktop-style chat: history (shared with the Claude Code CLI and Desktop's Code tab), chats without a folder, attachments, model and effort picker
6. ✅ Docking layout + saved layout presets
7. ✅ Plugin loader, slots, hot reload (built-ins are plugins too)
8. ✅ Themes and backgrounds
9. In-app plugin authoring by Claude
10. Git install for plugins

## Development

You'll need:

- [Rust](https://rustup.rs), [Bun](https://bun.sh), and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and signed in (`claude`, then `/login`), or `ANTHROPIC_API_KEY` set. Tinkr reuses that installation and login; it has no login of its own.

```bash
bun install
bun run app        # start Tinkr in dev mode (hot reload for the UI)
bun test           # unit tests (sidecar + UI store)
bun run typecheck
bun run release    # compile the sidecar and build installers
```

Layout:

| Path | What |
|---|---|
| `src/` | Vue UI: `agent/` (the `AgentProvider` interface and the Claude implementation), `stores/` (chat, workspace, editor, terminal), `editor/` (CodeMirror languages and theme), `terminal/` (PTY access and xterm.js colors), `workspace/` (file access), `components/` |
| `src-tauri/` | Rust core: window/config (open project, recent folders), the sidecar manager, and the PTY (terminal shells) |
| `sidecar/` | Bun process that drives the Claude Agent SDK |
| `shared/protocol.ts` | The JSON-lines messages between UI and sidecar |
| `e2e/` | End-to-end checks that drive the real window over the DevTools protocol |
| `spikes/` | Throwaway experiments behind the design decisions in SPEC.md |

On Windows, turn off Smart App Control to build. It blocks the DLLs Rust compiles for itself (see SPEC.md).

## License

MIT
