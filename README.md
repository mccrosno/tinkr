# Tinkr

A modular, agentic code editor. Think Claude Desktop and VSCode in one window, built on Tauri.

Tinkr ships with a minimal core. Everything else, including the editor, chat, file tree, terminal, and diff review, is a plugin. Claude can write new plugins for you while the app is running.

> **Status:** early design. No code yet. See [SPEC.md](SPEC.md) for the full design and the [roadmap](#roadmap) below.

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

Plugins live in `~/.config/tinkr/plugins/<name>/`:

```ts
export function activate(api: TinkrApi) {
  api.panels.register({
    id: 'notes',
    title: 'Notes',
    mount(el, ctx) {
      el.textContent = 'Hello from a plugin'
      return () => {} // cleanup
    },
  })
  api.actions.register({ slot: 'toolbar', icon: '...', run() {} })
}
```

Plugins can contribute panels, actions, commands, themes, and layouts. They are trusted code with access to the host API (fs, pty, agent, git, layout, settings, notifications), so only install plugins you trust.

## Roadmap

1. Window, chat UI, sidecar streaming Claude responses
2. File tree + CodeMirror
3. Terminal
4. Docking layout + saved layouts
5. Plugin loader, slots, hot reload
6. Diff review (live diffs, accept/reject/comment)
7. Themes and backgrounds
8. In-app plugin authoring by Claude
9. Git install for plugins

## Development

Not set up yet. Build instructions will land with Milestone 1. You'll need [Rust](https://rustup.rs), [Bun](https://bun.sh), the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS, and Claude Code signed in (or `ANTHROPIC_API_KEY` set).

## License

MIT
