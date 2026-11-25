# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

Tinkr is a modular agentic code editor: a Tauri 2 desktop app combining a Claude chat with a VSCode-style editor. The chat is the main focus (it's meant to replace Claude Desktop for the author); the editor is for viewing Claude's changes and small hand edits. The core ships minimal; everything else (including the built-in Editor, Chat, File Tree, Terminal, Diff Review) is a plugin, and Claude can write plugins live.

`SPEC.md` is the source of truth for design decisions. Read it before starting any milestone, and update it when a decision changes (don't let code and spec drift apart).

## Current status

Spikes in progress (see "Spike findings" in `SPEC.md`). Milestones 1 (chat), 2 (file tree + CodeMirror editor) and 3 (terminal) are done. Next: Milestone 4 (Claude edits files with review, the "Ask Claude" selection menu, chat-first layout). The milestone order changed after Milestone 3; see `SPEC.md`. All four "First things to verify" spikes are done (see "Spike findings" in `SPEC.md`); `spikes/` is throwaway reference code. Tinkr uses the user's installed Claude Code CLI; it doesn't bundle one.

WSL2: the author works on more than one Windows machine. Each one used so far has Ubuntu 24.04 (`wsl -d Ubuntu-24.04 -u root`) with Rust, Bun and the Tauri Linux prerequisites, run as root. A new machine may not: check `wsl -l` first. Build Linux copies in the WSL home folder (e.g. rsync to `~/tinkr`), not on `/mnt/c`.

Windows dev notes:
- Smart App Control is now off on the author's machine; Rust builds needed that. Never change security settings yourself.
- Test the running app over the DevTools port (see `spikes/shell/e2e/cdp-check.ts`), not with mouse/keyboard automation. The author may be using the machine. Avoid relaunching the app window unnecessarily, because it can steal focus (the spike window is configured with `"focus": false`).

Keep the README's status section current as milestones land.

## About the author (affects how to write code)

- Experienced in frontend (Vue/TS); **new to Rust**.
- Keep the Rust layer thin. Push logic into TypeScript where reasonable.
- When writing or changing Rust, explain it clearly: comment ownership/borrowing, `Result`/`?` error flow, async/threads, and Tauri macros where they're non-obvious. Prefer simple, explicit Rust over clever generics or macros.
- This is a public portfolio project (MIT): favor readable code, small focused commits, and good docs.

## Stack

| Layer | Choice |
|---|---|
| Shell | Tauri 2 (Rust) |
| UI | Vue 3 + Vite + TypeScript + Pinia |
| Docking | dockview (fallback: golden-layout) |
| Editor | CodeMirror 6 |
| Terminal | xterm.js + Rust `portable-pty` |
| Agent | Claude Agent SDK (TS) in a Bun sidecar compiled with `bun build --compile` |
| Files | Rust `notify` for watching; `git` CLI via shell-out |
| Storage | JSON files in the config dir |

## Architecture rules

```
Webview (Vue core + plugins) <-- Tauri IPC/events --> Rust core <-- stdio JSON lines --> Agent sidecar (Bun + SDK)
```

- **Rust core is limited to five modules:** window/config, sidecar manager, file watcher (also drives plugin hot reload), PTY, host API permissions. Don't add new Rust modules without updating `SPEC.md` first.
- **Agent access goes through the `AgentProvider` interface** (start session, send message, stream events, abort, permission requests). Claude is the only v1 implementation; never call the SDK directly from UI code.
- **No login UI.** The sidecar uses the existing Claude Code login or `ANTHROPIC_API_KEY`. Tinkr only displays which is active. Do not build a claude.ai OAuth flow.
- **Built-ins use the public plugin API.** If a built-in needs something the API doesn't offer, extend `TinkrApi` rather than reaching into core internals.
- Panels are framework-agnostic: `mount(el, ctx) => cleanup`.
- Host APIs (fs, pty, agent, git, layout, settings, notifications) are Rust-backed and permission-gated via Tauri capabilities.
- Theming is CSS variables as tokens; no hard-coded colors in components.

## Conventions

- TypeScript strict mode. Vue SFCs with `<script setup lang="ts">`.
- Sidecar protocol: one JSON object per line on stdio. Keep message types defined in one shared TS file.
- Cross-platform: the app targets Windows (WebView2), macOS (WKWebView), and Linux (WebKitGTK). The author develops on Windows; avoid POSIX-only assumptions in scripts and paths.

## Commands

Run from the repo root:

| Command | What |
|---|---|
| `bun install` | Install all workspaces (root UI + `sidecar/`) |
| `bun run app` | `tauri dev`: UI with hot reload; debug builds run the sidecar from source with `bun` |
| `bun test` | Unit tests (`test/`, `sidecar/test/`) |
| `bun run typecheck` | `vue-tsc` for the UI, `tsc` for the sidecar |
| `bun run e2e` | Chat checks in the running app over CDP (see the header of `e2e/chat.e2e.ts` for how to launch it) |
| `bun e2e/editor.e2e.ts` | File tree/editor checks in the running app (makes and removes a temp project) |
| `bun e2e/terminal.e2e.ts` | Terminal checks in the running app (shell I/O, colors, resize, Ctrl+C, tabs, exit, kill) |
| `bun sidecar/scripts/smoke.ts [exe]` | Live stdio test of the sidecar (source, or a compiled exe) |
| `bun run build:sidecar` | Compile the sidecar to `src-tauri/binaries/` |
| `bun run release` | Compile the sidecar and build installers (adds `externalBin` via `tauri.release.conf.json`) |
| `bun run --cwd sidecar gen` | Regenerate `sdkVersion.generated.ts` after upgrading the Agent SDK (a test fails until you do) |

`e2e` and `smoke` use the real Claude Code login and cost a few cents. For Rust: `cargo build` / `cargo clippy` in `src-tauri/`.

## Layout

- `shared/protocol.ts`: the only definition of sidecar messages. Change both sides together and bump `PROTOCOL_VERSION` on breaking changes.
- `sidecar/src/`: `main.ts` (stdio loop), `agent.ts` (SDK turns, auth), `cli.ts` (find `claude`, version check).
- `src/agent/`: `types.ts` (`AgentProvider`), `claudeSidecar.ts` (Tauri events ↔ protocol). UI code uses only the provider via the `chat` store.
- `src-tauri/src/sidecar.rs`: spawn/relay/restart. Rust never parses protocol lines.
- `src-tauri/src/config.rs`: `config.json` (last/recent projects) and `open_project`, which adds the folder to the fs plugin scope. The webview can only touch opened folders; grant new fs commands in `capabilities/default.json` deliberately.
- `src/workspace/fs.ts`: the `FileSystem` interface the stores use (Tauri fs plugin in the app, `test/fakeFs.ts` in tests). `src/stores/workspace.ts` = tree + watcher, `src/stores/editor.ts` = tabs/dirty/save/disk changes, `src/components/EditorPane.vue` = one CodeMirror view with a state per tab.
- `src-tauri/src/pty.rs`: shells in PTYs (`portable-pty`). Rust picks the shell; output streams as raw bytes over a per-terminal `Channel`. `src/terminal/pty.ts` = the `PtyHost` interface, `src/stores/terminal.ts` = tabs and shell lifecycle, `src/components/TerminalView.vue` = one xterm.js instance.
- Dev-only window hooks for e2e: `window.__tinkr.pinia`, `window.__tinkrOpenFolder(path)`.
