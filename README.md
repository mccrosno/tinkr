# Tinkr

A modular, agentic code editor. Think Claude Desktop and VSCode in one window, built on Tauri.

Tinkr ships with a minimal core. Everything else, including the editor, chat, file tree, terminal, and diff review, is a plugin. Claude can write new plugins for you while the app is running.

> **Status:** Milestone 3 of 9. Open a folder, browse it, edit files in a CodeMirror editor that notices changes on disk, and run shells in a terminal panel (Ctrl+`), with a Claude chat alongside that works in that folder. Claude can't edit files yet. Docking and plugins come next. See [SPEC.md](SPEC.md) for the full design and the [roadmap](#roadmap) below.

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

1. ✅ Window, chat UI, sidecar streaming Claude responses
2. ✅ File tree + CodeMirror
3. ✅ Terminal
4. Docking layout + saved layouts
5. Plugin loader, slots, hot reload
6. Diff review (live diffs, accept/reject/comment)
7. Themes and backgrounds
8. In-app plugin authoring by Claude
9. Git install for plugins

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
