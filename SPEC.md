# Tinkr: Design Spec

Modular agentic code editor. Claude Desktop + VSCode in Tauri. Ships minimal; everything else is a plugin, and Claude can write plugins live.

Personal open-source project (MIT) for a portfolio. The author is experienced in frontend, new to Rust. Keep Rust thin and explain Rust code clearly.

## Goals
- Watch Claude edit code live; accept, reject, comment on, or hand-edit changes.
- Everything is a component: dockable, resizable, replaceable. Claude can create new ones.
- Full theming: tokens, image/SVG backgrounds.
- Claude only for v1, behind an interface so other agents can be added.

## Stack
| Layer | Choice |
|---|---|
| Shell | Tauri 2 (Rust) |
| UI | Vue 3 + Vite + TypeScript + Pinia |
| Docking | dockview (verify Vue 3 support; fallback: golden-layout) |
| Editor | CodeMirror 6 |
| Terminal | xterm.js + Rust `portable-pty` |
| Agent | Claude Agent SDK (TS) in a Bun sidecar (`bun build --compile`; SDK `extractFromBunfs` helper) |
| Files | Rust `notify` (watch), `git` CLI via shell-out |
| Storage | JSON files in the config dir (Claude Code keeps its own sessions) |

## Architecture
```
Webview (Vue core + plugins) <-- Tauri IPC/events --> Rust core <-- stdio JSON lines --> Agent sidecar (Bun + SDK)
```
Rust core modules (keep to these):
1. Window and config
2. Sidecar manager (spawn, restart, relay messages)
3. File watcher (also drives plugin hot reload)
4. PTY
5. Host API permissions (Tauri capabilities)

## Agent layer
- `AgentProvider` interface (start session, send message, stream events, abort, permission requests). Claude is the only implementation in v1.
- Auth: Tinkr has NO login UI. The sidecar uses whatever Claude Code is already signed in with (subscription) or `ANTHROPIC_API_KEY` if set. Tinkr only shows which is active. Anthropic disallows third-party claude.ai login flows unless approved, so verify this approach first.
- Later: Agent Client Protocol (ACP) adapter for other agents.

## Review model (Antigravity-inspired)
- Each agent turn gets a baseline snapshot (SDK file checkpointing if available, otherwise git-based).
- Agent edits stream into the editor live as inline diffs.
- Per hunk: accept, reject, or comment. A comment goes to Claude with file + line range.
- Manual edits are allowed any time; Claude sees them next turn.
- Layouts are saved presets (e.g. "Editor", "Agent"), switchable by hotkey.

## Plugin system (core of the project)
Location: `~/.config/tinkr/plugins/<name>/` with `plugin.json` and an ES module entry.

Manifest declares contributions: `panel`, `action` (button in a slot), `command`, `theme`, `layout`.

```ts
export function activate(api: TinkrApi) {
  api.panels.register({ id: 'notes', title: 'Notes', mount(el, ctx) { /* any framework or vanilla */ return () => {} } })
  api.actions.register({ slot: 'toolbar', icon: '...', run() {} })
}
```
- Panels use `mount(el, ctx) => cleanup`: framework-agnostic, no build step needed. Optional esbuild step for Vue/React plugins.
- Slots: titlebar, sidebar, bottom panel, statusbar, chat toolbar.
- Host API: fs, pty, agent, git, layout, settings, notifications (Rust-backed, permission-gated).
- Built-ins (Editor, Chat, File Tree, Terminal, Diff Review) are plugins using the same API.
- Hot reload on file change. Plugin load errors surface in a console panel AND are fed to the agent.
- Plugins are trusted code. Install dialog must say so.

### Claude-authored plugins
The plugins folder ships with: `CLAUDE.md` (how to write plugins), `tinkr-api.d.ts` (typed API), and a skill describing the contribution types. A `reload_plugin` tool / error feedback loop lets Claude iterate on its own plugins.

### Distribution
- v1: local folder, and git URL (clone, pin commit/tag, update button).
- Later: static `registry.json` in a GitHub repo, shown as a "Browse plugins" tab that reuses git install. No server.

## Theming
- CSS variables as design tokens. A theme is JSON plus optional CSS.
- Background layer: image (PNG, JPG, WebP, GIF) and SVG (static or animated). Video and shaders are later plugins.
- Test blur and background effects on all three webviews (WebKitGTK, WebView2, WKWebView); they differ.

## Milestones
1. Window, chat UI, sidecar streaming Claude responses.
2. File tree + CodeMirror.
3. Terminal.
4. Docking layout + saved layouts.
5. Plugin loader, slots, hot reload (move built-ins onto the plugin API).
6. Diff review (live diffs, accept/reject/comment).
7. Themes and backgrounds.
8. In-app plugin authoring by Claude.
9. Git install for plugins.

## First things to verify
1. SDK auth behavior with an existing Claude Code subscription login.
2. dockview + Vue 3 viability.
3. Bun-compiled sidecar bundling with the SDK's native binary under Tauri.
4. Background and blur performance on WebKitGTK.

## Spike findings
Code in `spikes/sidecar/` (Windows x64, Bun 1.4.5, `@anthropic-ai/claude-agent-sdk` 0.3.331, bundled CLI 2.1.331).

**Sidecar bundling (spike 3): works, but it's big.**
- The SDK depends on a per-platform package (`@anthropic-ai/claude-agent-sdk-win32-x64`) that ships the native `claude.exe`. Embed it with `import p from '.../claude.exe' with { type: 'file' }`, call `extractFromBunfs(p)` (from `@anthropic-ai/claude-agent-sdk/extract`), and pass the result as `pathToClaudeCodeExecutable`.
- On Windows the embedded path looks like `B:\~BUN\...`; it's extracted to `%TEMP%\claude-agent-sdk\<hash>\`. Running uncompiled (`bun index.ts`), the import gives a real path and needs no extraction.
- The compiled sidecar runs from any folder and speaks stdio JSON lines as planned.
- **Size: 498 MB exe, of which 387 MB is `claude.exe`.** Too big to ship as-is in an installer. See "Shipping the CLI" below for the decision.
- Gotcha: the stdin reader must wait for in-flight requests before exiting on stdin EOF.

- Slim build (`slim.ts`: no embedded CLI; uses `TINKR_CLAUDE_PATH` or `claude` on PATH) is **111 MB**, which is basically the Bun runtime. So the sidecar's size floor is ~110 MB plus however the CLI gets shipped.

**Windows Smart App Control (was a blocker; the author turned it off on 2026-11-24).**
- Smart App Control is on in enforce mode. It blocks unsigned binaries without reputation:
  - Bun-compiled exes (blocked the slim sidecar; the embedded one happened to get through once).
  - **Rust proc-macro DLLs that cargo builds**, e.g. `target\debug\build\tauri-macros\...\tauri_macros-*.dll`, so `cargo build` of any Tauri app fails with `E0463: can't find crate for tauri_macros`. A plain `cargo new` hello world (no proc macros) did build and run.
- The signed `bun.exe` is allowed, so in development the sidecar runs as `bun slim.ts` rather than a compiled exe.
- Release builds will need code signing either way (end users with Smart App Control would be blocked too).
- Options for development: turn Smart App Control off (Windows Security → App & browser control; historically it can't be turned back on without reinstalling Windows), develop Tinkr in WSL2 (Linux build, WebKitGTK via WSLg, which also covers spike 4), or use another machine or VM.

**Tauri + sidecar (spike 3, under Tauri): works.** Code in `spikes/shell/` (Tauri 2.12, Vue 3, Vite 8). Built after Smart App Control was turned off.
- Verified end to end with `spikes/shell/e2e/cdp-check.ts`, which drives the real Tauri window over the DevTools protocol (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`) without touching mouse or keyboard:
  - Rust starts the sidecar at launch; the auth label shows "Claude Pro (Claude Code login)".
  - A prompt streams back through Rust events into the chat panel (first token ~1.9 s, ~4.4 s total).
  - "Restart sidecar" kills and respawns it; exactly one `bun slim.ts` process stays alive, parented to the app, and none are left after the app stops.
- App crashes don't orphan the sidecar on Windows: each sidecar is put in a Job Object with kill-on-close (`win32job` crate). Tested by force-killing `shell.exe`; the sidecar died with it. On Linux/macOS, `prctl(PR_SET_PDEATHSIG)` (Linux) or the sidecar exiting on stdin EOF (already implemented) covers it; not yet tested there.
- The spike window uses `"focus": false` so launching it doesn't steal focus.
- The computer-use tool can't drive a dev build (it only knows installed apps), so CDP is the way to test the UI in development.
- `src-tauri/src/sidecar.rs` is the sidecar manager: spawns `bun spikes/sidecar/slim.ts` with `CREATE_NO_WINDOW`, relays stdout lines as `sidecar://line` events (unparsed), stderr as `sidecar://log`, emits `sidecar://exit` with the pid, and exposes `sidecar_send` / `sidecar_restart` commands. It kills the sidecar on app exit. Plain `std::process`; no shell plugin needed.
- The frontend parses the protocol (`src/agent.ts`), so Rust never knows the message types.

**Shipping the CLI: decision (recommended, pending author sign-off).**
- Use the user's installed Claude Code CLI. Tinkr needs its login anyway, so the user already has it. Look for `claude` on PATH, then the installer's default location (`%USERPROFILE%\.local\bin`, `~/.local/bin`).
- Check `claude --version`. The SDK expects a CLI at least as new as the one it bundles (when you pass your own CLI path, it recommends updating it to "at least the bundled version" and setting `mcpServersDelivery: 'initialize'`). If it's older, show "update Claude Code" with the command, instead of failing in confusing ways.
- If no CLI is found, Tinkr can't work anyway (no login), so the onboarding screen explains how to install and sign in. No bundled CLI in v1.
- Result: installer = app + ~110 MB Bun sidecar instead of ~500 MB. If a fallback is ever needed: download the matching `@anthropic-ai/claude-agent-sdk-<platform>` package on first run and verify its npm `integrity` hash.
- The slim sidecar (`TINKR_CLAUDE_PATH` or PATH lookup) already implements the lookup half.

**Themes and backgrounds (spike 4): fine everywhere with a GPU; WebKitGTK needs a fallback.**
Benchmark: `spikes/shell/src/bench.ts`, run inside the page so every webview runs the same code (Windows: `bun e2e/blur-bench.ts` over CDP; Linux: `VITE_AUTOBENCH=1 bun run tauri dev`, results POSTed to a dev-only Vite endpoint). It animates a dockview split every frame over: no background, a 1920×1080 image, image + `backdrop-filter: blur(18px)` on translucent panels, an animated SMIL SVG, and SVG + blur. 1200×800 window.

| Webview | Setup | no bg | image | image+blur | SVG | SVG+blur |
|---|---|---|---|---|---|---|
| WebView2 (Edge 158) | Windows, 240 Hz monitor | 240 | 240 | 240 | 240 | 240 |
| WebKitGTK 2.52.6 | WSL2/WSLg, software rendering (default) | 62 | 60 | **34** (worst frame 248 ms) | 59 | **24** |
| WebKitGTK 2.52.6 | WSL2, `GALLIUM_DRIVER=d3d12` (GPU) | 61 | 61 | 61 | 60 | 61 |
| WebKitGTK 2.52.6 | WSL2, `WEBKIT_DISABLE_DMABUF_RENDERER=1` | 62 | 62 | 61 | 118* | 119* |

(fps; *rAF isn't vsync-locked in that path, so those numbers aren't real frames.)
- Backgrounds (image or animated SVG) are essentially free. **Blur is the only expensive effect, and only when WebKitGTK falls back to software rendering.** With either GPU setting it's smooth.
- `backdrop-filter` is supported in both webviews (WebKitGTK also accepts `-webkit-backdrop-filter`; set both).
- Plan: on Linux, set `WEBKIT_DISABLE_DMABUF_RENDERER=1` before the webview starts if DMA-BUF rendering is unavailable (a common Tauri-on-Linux fix). Add a "reduce effects" setting that turns blur off. Run a ~1 s frame-time probe on first launch and default blur off if the 95th-percentile frame time is over ~25 ms.
- Still untested: WKWebView (macOS; needs a Mac), and native Linux with real GPU drivers (WSL is a proxy).
- The WSL dev environment is set up: Ubuntu 24.04 with Rust, Bun and the Tauri prerequisites; the Linux build of the spike works (`~/tinkr-spikes` inside WSL).

**dockview + Vue 3 (spike 2): works.**
- `dockview-vue` 8.9.1 (official Vue 3 bindings). Panels are declared as scoped slots (`<template #panel-chat>`) and added with `api.addPanel({ component: 'chat' })`.
- Drag to stack/split worked, and `api.toJSON()` / `api.fromJSON()` round-tripped the layout through a reload. That covers saved layout presets.
- New splits come out with odd sizes; set them with `panel.api.setSize()` after adding.
- Hidden tabs (default `onlyWhenVisible` renderer): the panel's DOM is **detached but kept**. The same node comes back with its state intact (an unsent chat draft survived). The Vue component is not remounted. xterm.js will likely need a `fit()` when its tab becomes visible again; `renderer: 'always'` keeps it attached if that's a problem.
- Verified in both Chromium (Vite) and the real Tauri WebView2 window.

**Auth (spike 1): works with a subscription login, no extra config.**
- After `claude` → `/login` with a Claude Pro subscription (credentials saved to `~/.claude/.credentials.json`), both `bun index.ts` and the compiled exe authenticated on their own. `accountInfo()` returns `{ email, organization, subscriptionType: "Claude Pro", apiProvider: "firstParty" }`; the init message still says `apiKeySource: "none"` (that field only covers API keys). Tinkr's auth indicator should read `subscriptionType` first, then `apiKeySource`.
- Streaming with `includePartialMessages: true` delivered `text_delta` chunks; first token in about 1.7 to 4.2 s, a short reply in 4 to 7 s.
- `result.total_cost_usd` is filled in on a subscription too (about $0.007 per short prompt); it's an estimate, not a charge. Label it that way in the UI.
- Onboarding gotcha: on Windows the CLI installer put `claude.exe` in `%USERPROFILE%\.local\bin` but didn't add that folder to PATH. Tinkr's "not signed in" hint should give the full path or a fix.

Earlier, before signing in:
- With no login, `query().accountInfo()` returns `{ tokenSource: "none", apiProvider: "firstParty" }`, the init message has `apiKeySource: "none"`, and a prompt fails with `Not logged in · Please run /login`. That's enough to drive Tinkr's "which auth is active" indicator and a "sign in with Claude Code" hint.
- The Claude desktop app's sign-in is not shared with the CLI/SDK.
