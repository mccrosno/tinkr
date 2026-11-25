# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

Tinkr is a modular agentic code editor: a Tauri 2 desktop app combining a Claude chat with a VSCode-style editor. The core ships minimal; everything else (including the built-in Editor, Chat, File Tree, Terminal, Diff Review) is a plugin, and Claude can write plugins live.

`SPEC.md` is the source of truth for design decisions. Read it before starting any milestone, and update it when a decision changes (don't let code and spec drift apart).

## Current status

Spikes in progress (see "Spike findings" in `SPEC.md`). All four "First things to verify" spikes are done (see "Spike findings" in `SPEC.md`): auth, dockview-vue, the Bun sidecar under Tauri, and themes/blur on WebView2 and WebKitGTK (via WSL2). Spike code in `spikes/` is throwaway. Pending the author's sign-off: the CLI-shipping decision (use the user's installed `claude`). Next: Milestone 1.

WSL2: Ubuntu 24.04 is set up with Rust, Bun and the Tauri Linux prerequisites (run as root for now). Build Linux copies in the WSL home folder, not on `/mnt/c`.

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

None yet. Add the dev, build, test, and lint commands here once the project is scaffolded (Milestone 1).
