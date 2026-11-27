# Tinkr: Design Spec

Modular agentic code editor. Claude Desktop + VSCode in Tauri. Ships minimal; everything else is a plugin, and Claude can write plugins live.

**Chat first.** Tinkr is primarily the author's replacement for Claude Desktop. The chat is the main window. The editor is secondary: it's there to view Claude's changes and to make changes by hand where needed, not to be the main workspace.

Personal open-source project (MIT) for a portfolio. The author is experienced in frontend, new to Rust. Keep Rust thin and explain Rust code clearly.

## Goals
- A chat that can replace Claude Desktop day to day: conversation history, chats with or without a project folder, attachments, and a model/effort picker.
- Watch Claude edit code live; accept, reject, comment on, or hand-edit changes.
- Select code anywhere and ask Claude about it or request changes to it (selection menu).
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
3. File watcher and plugin files (watching drives plugin hot reload; `plugins.rs` serves plugin modules to the webview over a `tinkr-plugin` URI scheme and opens the plugins folder to the fs scope)
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
- Layouts are saved presets (e.g. "Editor", "Agent"), switchable by hotkey. The default is chat-first (see "Layout").

## Selection menu ("Ask Claude")
- Selecting text in the editor (and in diffs) offers, via right-click and a small popup next to the selection: **Ask Claude** (a question about it) and **Request changes** (an instruction to edit it). Room for more actions later; plugins can add their own (an `action` in a `selection` slot).
- Either one puts a reference into the chat composer: file path, line range and the selected text, shown as a removable chip above the message box. The user types the question or instruction and sends it as usual; the reference is sent along with the message.
- "Request changes" needs Claude's file tools and the review flow, so it ships together with them.

## Layout
- Default: chat in the center as the main area. The editor opens as a side panel on demand (when a file is opened, or when Claude changes one) and can be closed again. File tree and terminal are collapsible.
- Docking (later milestone) keeps this as the default "Agent" preset, plus an "Editor" preset closer to a classic IDE.

## Plugin system (core of the project)
Location: `~/.config/tinkr/plugins/<name>/` with `plugin.json` and an ES module entry.

The manifest names the plugin and its entry module, and asks for permissions; contributions are registered in code (the manifest can list them for display). The full, documented API is `src/plugins/api.ts` (no imports, so it ships to plugin authors as-is).

```ts
export function activate(api: TinkrApi) {
  api.panels.register({ id: 'notes', title: 'Notes', location: 'right', mount(el, ctx) { /* any framework or vanilla */ return () => {} } })
  api.commands.register({ id: 'refresh', title: 'Notes: refresh', keybinding: 'Ctrl+Alt+R', run() {} })
  api.actions.register({ id: 'go', slot: 'titlebar', title: 'Notes', run: () => api.layout.show('notes.notes') })
}
```
- Panels use `mount(el, ctx) => cleanup`: framework-agnostic, no build step needed. `mount` runs once per registration; the dock moves the element, it never rebuilds it. Optional esbuild step for Vue/React plugins.
- Panels have a default `location` (left, right, bottom, center); the user can drag them anywhere. Action slots: titlebar, statusbar, chat toolbar, and the selection menu.
- Commands have optional keybindings and are listed in the command palette (Ctrl+Shift+P). A plugin's ids are prefixed with its name (`notes.refresh`); built-ins keep bare ids.
- Host API: workspace (files: permission `fs`), editor, agent (`agent`), terminal (`pty`), layout (incl. presets), settings (per plugin, in `~/.config/tinkr/settings.json`), notifications, log. Permissions limit what each plugin is handed; they're not a security boundary (plugins are trusted code in the same webview). Git is Milestone 10.
- Built-ins (Chat, Chats, Files, Editor with diff review, Terminal, Console, Plugins, and "core": the app's commands, shortcuts and buttons) are plugins using the same API.
- Hot reload on file change. Plugin load errors surface in the Console panel AND are fed to the agent ("Ask Claude to fix" puts the error and the plugin's folder in the message box).
- Plugins are trusted code. A plugin Tinkr hasn't seen before doesn't run until the user approves it in a dialog that says so; the answer is kept in settings.json.

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
1. Window, chat UI, sidecar streaming Claude responses. **Done** (see "Milestone 1 notes" below).
2. File tree + CodeMirror. **Done** (see "Milestone 2 notes" below).
3. Terminal. **Done** (see "Milestone 3 notes" below).
4. Claude edits files, with review: file tools and permission requests in `AgentProvider`, live diffs with accept/reject/comment, the selection menu ("Ask Claude" / "Request changes"), and the chat-first layout (editor opens on demand). **Done** (see "Milestone 4 notes" below).
5. Chat like Claude Desktop: conversation history (reopen and continue past chats), chats without a project folder, attachments (images and files), model and effort picker. **Done** (see "Milestone 5 notes" below).
6. Docking layout + saved layouts ("Agent" chat-first default, "Editor"). **Done** (see "Milestone 6 notes" below).
7. Plugin loader, slots, hot reload (move built-ins onto the plugin API). **Done** (see "Milestone 7 notes" below).
8. Themes and backgrounds.
9. In-app plugin authoring by Claude.
10. Git install for plugins.

Order changed after Milestone 3 (author's decision, 2026-11-25): Tinkr is meant to replace Claude Desktop first, so file editing with review and the Desktop chat features come before docking and plugins. Built-ins written before Milestone 7 move onto the plugin API then.

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

**Shipping the CLI: decided (author approved 2026-11-24). Implemented in Milestone 1.**
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

## Milestone 1 notes
What shipped, and decisions made along the way:
- **Layout:** Tauri app at the repo root (`src/`, `src-tauri/`), the sidecar as a Bun workspace (`sidecar/`), and `shared/protocol.ts` as the single definition of the JSON-lines protocol (`PROTOCOL_VERSION` 1).
- **Conversations:** each message is one SDK `query()`; follow-ups pass `resume: <sessionId>`, so Claude Code stores the history (nothing stored by Tinkr). Sessions are keyed by working directory, so all chats use the home folder until projects exist.
- **Chat only:** `tools: []` and `settingSources: []` (no file access, no user CLAUDE.md/settings) until the review model (Milestone 6) can show and approve changes. Permission requests are not yet part of `AgentProvider`. (Superseded by Milestone 4: Claude now has its tools, with review.)
- **Abort:** `interrupt()` first, then kill via `AbortController` after 3 s. The turn always ends with `turnFinished` (outcome `aborted`).
- **CLI:** found via `TINKR_CLAUDE_PATH`, PATH, then `~/.local/bin`. Minimum version = the SDK's bundled `claudeCodeVersion`, copied into `sidecar/src/sdkVersion.generated.ts` (a test fails if it goes stale). Uses `mcpServersDelivery: 'initialize'` as the SDK recommends for custom CLI paths.
- **Auth status:** read with a prompt stream that never yields, so checking login sends no message.
- **Sidecar launch:** debug builds run `bun sidecar/src/main.ts`; release builds run the compiled `tinkr-sidecar` (111 MB) placed next to the app by `externalBin` in `tauri.release.conf.json` (kept out of the base config so dev builds don't need the binary).
- **UI:** Markdown replies via markdown-it with raw HTML disabled; links open in the system browser. A setup panel covers a missing or outdated CLI, a failed CLI, being signed out, and a stopped agent. Styling uses only the CSS variables in `src/styles/tokens.css` (dark and light).
- **Tests:** unit tests for CLI lookup/version, auth mapping and the chat store; a live sidecar smoke test; and `e2e/chat.e2e.ts` covering status, streaming with Markdown, follow-up memory, Stop, New chat and Restart in the real window.

## Milestone 2 notes
- **Opening a project:** "Open folder" (Ctrl+O, native dialog) calls the Rust `open_project` command (`config.rs`, core module 1). It checks the folder, adds it to the fs plugin's scope (recursive), and saves it as `lastProject` + `recentProjects` in `<app config dir>/config.json`. The webview can only read and write inside opened folders. The last project reopens on launch; folders that no longer exist are dropped from the config when it's read.
- **File access:** the webview uses `tauri-plugin-fs` (readDir, readTextFile, writeTextFile, stat, watch) behind a small `FileSystem` interface (`src/workspace/fs.ts`) so the stores are testable. Capabilities grant only those commands, plus `dialog:allow-open`/`allow-ask`. Rust's `notify` arrives through the fs plugin's `watch` feature (SPEC module 3 for now; plugin hot reload will reuse it).
- **Tree:** folders load lazily when expanded; folders first, natural sort; `.git`, `node_modules`, `target` and similar are hidden. A recursive watcher (150 ms debounce) refreshes loaded folders.
- **Editor:** one CodeMirror 6 view with one `EditorState` per tab (undo history, cursor and scroll are kept per file). Grammars load on demand (TS/JS/JSX, JSON, CSS, HTML/Vue, Markdown, Python, Rust, YAML). Theme and syntax colors are CSS variables. Ctrl+S saves.
- **Changes on disk:** a clean tab reloads silently; a tab with unsaved edits shows a banner ("Use disk version" / "Keep mine") and is never overwritten. Our own saves are recognized and ignored. Files over 2 MB or containing NUL bytes open as a notice.
- **Unsaved changes:** closing a dirty tab, switching folders or closing the folder asks first (native dialog).
- **Chat per project:** turns run with `cwd` = the open folder (protocol: optional `cwd` on `send`). Claude Code keeps sessions per folder, so switching folders stops any running reply and starts a new chat; late events from the old turn are dropped. Claude still has no file tools (Milestone 6).
- **Layout:** fixed three columns (tree | editor | chat) with keyboard-accessible splitters; widths are remembered in localStorage. Real docking is Milestone 4.
- **Tests:** unit tests for path/tree helpers, language detection, the workspace store (lazy load, watcher, restore) and the editor store (dirty/save/reload/conflict/binary/close), using an in-memory fake fs. `e2e/editor.e2e.ts` drives the real window: tree, highlighting, typing + Ctrl+S to disk, external reload, conflict banner, new files appearing, and the chat's working directory.
- **Windows note:** freshly created files can stay locked by Search/Defender for minutes, so e2e cleanup of its temp folder is best-effort.

## Milestone 3 notes
- **Rust (`pty.rs`, core module 4):** `pty_spawn`, `pty_write`, `pty_resize`, `pty_kill`, using `portable-pty` 0.9 (ConPTY on Windows). Rust picks the shell and the webview only passes `cwd` and the size: `pwsh` if it's on PATH, otherwise Windows PowerShell (`-NoLogo`); `$SHELL` (or `/bin/sh`) on Linux/macOS, as a login shell (`-l`) on macOS so Dock-launched apps get the user's PATH. Sets `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=tinkr`.
- **Output:** each terminal gets its own Tauri `Channel`. Output goes as raw bytes (an `ArrayBuffer` in JS), not strings, because a read can end in the middle of a UTF-8 character; xterm.js decodes it. After the last output the same channel sends `{ exitCode }`. A channel is ordered, so the exit never overtakes output.
- **Threads:** a reader thread per terminal forwards output; a waiter thread owns the child process and blocks until it exits. Then it drops the session (on Windows, ConPTY keeps the output pipe open until the pseudo console is closed), waits for the reader, and sends the exit. Killing uses a separate `ChildKiller` handle, so it works while the waiter is blocked.
- **Lifetime:** closing a tab kills its shell; app exit kills all shells. Force-killing Tinkr on Windows also ended its shell (closing ConPTY ends the attached process), so terminals don't need the sidecar's Job Object. Not yet tested on Linux/macOS.
- **UI:** a bottom panel under the editor, toggled with Ctrl+` (or the titlebar "Terminal" button), height adjustable and remembered. Tabs per terminal (`pwsh`, `pwsh 2`, ...); all stay mounted (`v-show`), so hiding the panel or switching tabs keeps the screen and scrollback. A clean `exit` closes the tab (like VS Code); a non-zero exit keeps it with "[Process exited with code N]". Terminals belong to the open folder: switching or closing the folder closes them, after a confirmation if any are running.
- **Keys:** Ctrl+C copies when text is selected and otherwise interrupts; Ctrl+Shift+C copies; Ctrl+V / Ctrl+Shift+V paste through the browser's paste event. Ctrl+` and Ctrl+O pass through to the app. App shortcuts are now a `window` listener, so they work when nothing is focused. Ctrl/Cmd+click opens URLs in the system browser.
- **Colors:** xterm.js needs concrete color values, so `src/terminal/theme.ts` reads the CSS tokens (`--tk-bg`, `--tk-text`, the 16 `--tk-term-*` ANSI colors) and re-reads them when the system color scheme changes.
- **Focus fix:** the chat used to move focus to its input whenever a reply ended, even if the user had moved to the editor or terminal. It now does so only if focus was still in the chat.
- **Tests:** unit tests for the terminal store (spawn, I/O, resize, numbered titles, clean and failing exits, closing tabs and the closing-while-starting race, spawn failure) and the theme mapping, using a fake `PtyHost`. `e2e/terminal.e2e.ts` drives the real window: Ctrl+` opens a focused shell in the project folder, commands print, ANSI colors render, panel resize reaches the shell, Ctrl+C interrupts, hide/show keeps output, tabs have separate shells and closing one kills only it, `exit 3` keeps the tab, `exit` closes it, and closing all kills every shell (checked by process id).
- **Linux:** `cargo clippy --all-targets -D warnings` is clean in WSL Ubuntu 24.04, so the non-Windows shell code compiles, but terminals haven't been run there yet: the e2e drives the window over CDP, which WebKitGTK doesn't offer. macOS is untested.

## Milestone 7 notes
The plugin system; the built-in panels moved onto it.

- **Loading code:** the webview can't `import()` from disk, and the asset protocol can't make a hot reload fetch fresh copies of the files an entry imports. So Rust serves plugin files over a custom URI scheme (`src-tauri/src/plugins.rs`, part of core module 3): `tinkr-plugin://localhost/<plugin>/<version>/<path>` (`http://tinkr-plugin.localhost/...` on Windows). The version segment is ignored when reading and bumped on every reload, so every file of the plugin is new to the browser and relative imports work. Only plain path segments are accepted (no `..`, roots or drive letters; Rust unit tests); responses carry CORS (module imports cross origins) and `no-store`.
- **Folder and settings:** Rust creates `~/.config/tinkr/plugins` and adds `~/.config/tinkr` to the fs scope at startup, so the webview lists plugins, reads `plugin.json`, watches the folder and writes `settings.json` there (approvals and per-plugin settings, written 300 ms after a change; an unparsable file is left alone).
- **Registry and API:** `src/stores/plugins.ts` holds plugins, panels, commands, actions, layout presets and the Console log. `src/plugins/host.ts` builds each plugin's `TinkrApi`: ids prefixed with the plugin name, everything registered tracked and undone on unload, `agent`/`fs`/`pty` parts replaced by functions that throw "needs X in permissions" unless plugin.json asks for them. File access refuses paths outside the open folder and any `..`.
- **Panels are mounted once** into a persistent element (`.tk-panel-root`, a flex column); `PanelHost` moves it into the dock and back to a hidden parking box. Built-in Vue panels each run as a small Vue app sharing the Pinia instance (`src/pinia.ts`). Milestone 6's Teleports are gone. Dock panels all use one dockview component (`host`, the panel id in params); the old per-panel component names still load saved layouts.
- **Loader** (`src/plugins/loader.ts`, disk access behind `PluginSource`): built-ins first, then plugins on disk; the dock waits for both before laying out the saved arrangement (so plugin panels keep their places across restarts). New plugins found at startup are asked about after the window is laid out; later ones right away. The watcher reloads a plugin 250 ms after its files stop changing (one reload per burst), loads new folders, unloads deleted ones. During a reload the plugin's panels keep their place in the dock; panels it no longer registers are closed. One operation per plugin at a time.
- **Shell:** App.vue is just the titlebar (the `titlebar` action slot + Layout menu), the dock, the status bar (`statusbar` slot), the command palette and toasts. Keyboard shortcuts are command keybindings; the terminal lets through Ctrl+`, Ctrl+O and bindings with Shift or Alt, and keeps plain Ctrl+<letter> for the shell. The folder actions moved to `src/app/workspace.ts`; the message box draft moved into the chat store (so `api.agent.setDraft` and "Ask Claude to fix" can fill it).
- **New panels:** Console (plugin logs and errors, "Ask Claude to fix") and Plugins (state, turn on/off, reload, open the folder). Status bar buttons open them; the Console button lights up while there are errors.
- **Example:** `examples/plugins/word-count` (panel, selection action, command with keybinding, settings, a relative import, agent).
- **Fixed along the way:** spreading a permission-guarded object read every property, so with a throwing proxy every plugin without `fs` failed to load (caught by the unit tests; now plain functions that throw when called). Built-in panels didn't fill their panel once they were separate Vue apps (`tk-fill`). In e2e scripts, a `\r` inside `Input.insertText` doesn't press Enter.
- **Not done yet:** layouts are still in localStorage (settings.json is ready for them); a plugin's settings have no UI; `api.git` waits for Milestone 10; themes are Milestone 8.
- **Tests:** unit tests for the loader (approval asked once and remembered, deferred at startup, refusals, load errors undone, bad manifests, half-written folders, hot reload with one reload per burst, panels kept or removed, deleted folders, built-ins), the API (prefixes, duplicates, disposal, permissions, file access limits, settings, panel mount/visibility/cleanup, a throwing mount) and keybindings/URLs; Rust tests for the path rules. `e2e/plugins.e2e.ts` (free) writes real plugins into the plugins folder and covers the palette, loading, buttons in every slot, keybindings, settings, hot reload of an imported file, the error/Console/"Ask Claude to fix" path, recovery, permissions, a plugin left off, and deleting one; it removes them and their settings afterwards.

## Milestone 6 notes
Docking and layout presets, with `dockview-vue` 8.10 (spike 2 used 8.9).

- **Panels:** Chats, Files, Chat, Editor, Terminal, each a dock panel you can drag to split or stack. The chat has no close button (a `#tab-pinned` slot); the others can be closed and come back with their shortcuts.
- **Content is created once.** Dockview rebuilds a panel's content when a layout is restored or a panel moves between layouts, which would lose the chat draft, the shells' screens and the editor's undo history. So each panel's dockview content is just an empty `PanelHost` box that registers itself in the layout store, and App.vue `<Teleport>`s the real component into it (or into a hidden "parking" box while the panel isn't in the layout). Changing a Teleport's target moves the DOM without remounting, so nothing is rebuilt. Checked in the e2e: a draft, an unsaved edit with its undo history and a shell's output all survive a preset switch.
- **Hiding keeps the place.** Hiding a panel hides its whole group (`group.api.setVisible(false)`); dockview keeps its slot and saves the hidden flag in its JSON. A panel stacked in the chat's group is closed instead (the chat can't be hidden) and comes back at its home position. A group that comes back below a usable size (dockview squeezes hidden groups to its 100px minimum) gets its default size.
- **Presets:** "Agent" (default): Chats and Files stacked on the left, the chat in the middle, the editor on the right when a file is open, the terminal along the bottom. "Editor": Files and Chats on the left, the editor in the middle, the chat on the right, the terminal under the editor. Each preset remembers its last arrangement (saved 300 ms after a change; a pending save is written when the window closes). "Reset" goes back to the preset's starting arrangement. "Save layout as…" (Layout menu) adds a preset whose start is the arrangement at the time; saved presets can be deleted. Ctrl+Alt+1..9 switch presets in menu order.
- **Stores stay in charge of "wanted":** the editor and terminal stores still say whether they want to be seen (a file opened, Ctrl+`); App.vue shows or hides their panel. Closing a panel's tab in the dock sets the store back to hidden. After any preset is laid out, editor and terminal visibility is re-applied (an arrangement may include an editor with no file open).
- **Shortcuts:** Ctrl+B hides or shows Chats and Files together; Ctrl+Shift+E the editor; Ctrl+` the terminal; Ctrl+Alt+<n> presets. Opening a folder yourself brings Files to the front.
- **Theme:** `dockview-theme-tinkr` (src/styles/dock.css) maps dockview's `--dv-*` variables to Tinkr's `--tk-*` tokens; no colors of its own.
- **Storage:** localStorage (`tinkr.layout.*`), like the old panel sizes. Settings move to JSON in the config folder with the settings API (Milestone 7).
- **Gotchas:** `DockviewVue` doesn't pass `class` through (`inheritAttrs: false`), so the dock needs a wrapper with the size; without it dockview falls back to 100px and the saved layout gets squeezed. CDP can't return a Vue reactive proxy by value (it arrives as `{}`): e2e scripts read store objects as JSON.
- **Not done yet:** panels can't be resized from the keyboard any more (the old splitters could; dockview's drag handles don't take focus). Floating and pop-out windows are left off for now.
- **Tests:** unit tests for the layout store with a fake dock (first launch, restore, unusable saved layouts, switching, reset, save as/delete, toggle, the "applied" hook). `e2e/layout.e2e.ts` (free) drives the real window through presets, shortcuts, content surviving switches, hide/show sizes, a panel stacked with the chat, and saving/reloading/resetting/deleting a preset; it saves the user's layouts first and puts them back. The other e2e checks were updated for the dock, and now delete the chats they create and close their temporary folders (they used to leave both behind).

## Milestone 5 notes
Desktop-style chat. A live spike first (SDK 0.3.331, CLI 2.1.332) showed the SDK covers all of it:
- `listSessions({ dir })`, `getSessionMessages`, `renameSession`, `deleteSession` read and change Claude Code's stored chats. `listSessions()` without `dir` returns every session on the machine (321 here, in 15 folders).
- Titles: `customTitle` is set by rename *and* by Claude Code's own generated title (e.g. "Image color and file password"), usually after the first turn. `summary` falls back to the **latest** prompt, so it makes a poor title; Tinkr uses `customTitle`, then `firstPrompt`.
- Transcripts keep the user's content blocks as sent (image and document data included). Assistant replies are stored one block per entry (thinking, text, tool_use); tool results come back as "user" entries. Plain-string prompts may be stored as a string or as one text block.
- `query().supportedModels()` lists the account's models (14 on Claude Pro, including "default"), each with `supportedEffortLevels`. It works in the same no-prompt query that reads the login.
- `query()` takes `model` and `effort`. A resumed chat can switch models between turns.
- Attachments: a prompt given as a stream of `SDKUserMessage`s takes Messages API blocks. Images (base64), PDFs (base64 document) and plain-text documents (`source.type: 'text'`, `title` = file name) all worked.

Where other tools' sessions live (checked on the author's machine):
- The CLI, Desktop's **Code** tab and Tinkr all store transcripts in `~/.claude/projects/<folder>/`, so Tinkr lists all of them (307 of the recent sessions came from Desktop). Each transcript entry records its `entrypoint` (`claude-desktop`, `cli`, `sdk-cli`, `sdk-ts`).
- Desktop's Code tab lists only sessions it has its own record for (`%APPDATA%\Claude\claude-code-sessions\...\local_<id>.json`, pointing at the transcript by `cliSessionId`). Tinkr's sessions don't appear there, and writing those private, undocumented files isn't safe, so Desktop doesn't see Tinkr's chats.
- Desktop's regular chats are on claude.ai, not on disk. Reading them would need a claude.ai login, which this spec rules out.

How it works:
- **Chats without a folder** run in the home folder (author's decision, 2026-11-25), like the CLI started there: `claude --resume` from home lists them, and Tinkr's no-folder list shows the CLI's and Desktop's home-folder sessions. (Briefly a Tinkr-only folder was used; it kept them apart from other tools, which turned out to be the opposite of what's wanted.) They still get no edit tools.
- **Protocol v3:** `send` gains `model`, `effort` and `attachments` (name, media type, base64). `status` carries `models`. History requests `listChats` (per folder or `allFolders`), `loadChat`, `renameChat`, `deleteChat` carry a `requestId`; the sidecar answers with `chatList`, `chatHistory` or `requestDone` (with `error` on failure). The provider matches answers to requests and rejects waiting ones if the sidecar exits or restarts. `AgentProvider` gained `listChats`, `loadChat`, `renameChat`, `deleteChat`.
- **Turns** always send the message as a one-item stream (the form that takes content blocks), kept open until the turn ends so permission answers still reach the CLI. The review e2e (permission card, Allow) passes this way; Stop still ends a turn within ~20 ms.
- **History (sidecar `history.ts`):** turns a transcript into rows (user text with attachments, Claude's text with consecutive blocks joined, tool calls with their error state). Sub-agent work, thinking and Claude Code's bookkeeping messages (slash-command echoes, "[Request interrupted by user]") are left out. In the webview, `parsePrompt` turns `<selection>` blocks back into chips.
- **Chats tab:** the sidebar has Chats | Files tabs. Chats lists the current folder's chats (or the no-folder ones), newest first, with search once there are more than 6. "All folders" lists every stored chat with its folder; opening one from another folder opens that folder first (asking about unsaved edits and running terminals as usual), then the chat. Rename = double-click or ✎; delete asks first and removes the transcript for good. The list reloads after every turn. Opening a folder yourself switches to the Files tab; opening one from the list keeps Chats.
- **Attachments** are read in the webview as browser `File`s (paste, drop anywhere on the chat, or an `<input type=file>` behind the Attach button), so the fs scope stays limited to opened folders. Tauri's own drag-and-drop is turned off (`dragDropEnabled: false`) so drops reach the webview. Images (PNG/JPEG/GIF/WebP, ≤ 5 MB), PDFs (≤ 20 MB) and UTF-8 text without NUL bytes (≤ 2 MB) are accepted, ≤ 30 MB per message; anything else is refused with a message. They go to Claude before the text. Sent messages and reopened chats show image thumbnails and chips for the rest.
- **Model and effort:** pickers in the composer, remembered in localStorage. "Default" sends no `model`, so Claude Code's own default (and the user's settings) apply; effort is only sent when the model offers that level. Each turn's summary line names the model it ran on.
- **Typing cursor:** only the message still receiving text shows it (`streamingId`), not replies from history, text before a tool call, or a turn cut off by a crash.
- **Tests:** unit tests for transcript conversion and titles, attachment blocks, folder comparison (sidecar), and in the chat store: models/effort, attachments (accepted, refused, removed), history (per folder, all folders, open, failed open, rename, delete, double folder switch), `parsePrompt`, and the typing cursor. The sidecar smoke test adds the model list, an image with a picked model and effort, and list/load/rename/delete/all folders. `e2e/history.e2e.ts` (a few cents, Haiku) covers the pickers, dropping an image and picking a text file (Claude reads both), the list, reopening and continuing, renaming, deleting, and opening a Desktop session of another folder from "All folders".
- **Later:** source labels (Desktop / CLI / Tinkr, from each transcript's `entrypoint`), as a plugin or a setting; archiving instead of deleting (the SDK has `archiveSession`); a no-folder chat while a folder stays open.

## Milestone 4 notes
Claude edits files, with review. Verified with a live spike first (SDK 0.3.331, CLI 2.1.332):
- In `acceptEdits` mode Claude Code auto-approves edits *and* file commands like `mkdir` in the working folder, so `canUseTool` never sees them. In `default` mode every edit and every non-read-only command reaches `canUseTool`; read-only tools and safe commands (`echo`, `ls`) still run without asking.
- A `PreToolUse` hook runs **before** the permission check, so it's the place to snapshot a file before an edit.
- Claude Code's "always allow" suggestions target `.claude/settings.local.json`.

How it works:
- **Agent options (sidecar):** Claude Code's full toolset (`tools` preset), the user's settings and CLAUDE.md files (`settingSources: user, project, local`), Claude Code's system prompt plus a short Tinkr addition (`TINKR_PROMPT`: edits are reviewed as diffs; what `<selection>` blocks mean), and `permissionMode: 'default'`.
- **Permission policy** (`sidecar/src/tools.ts`, `decide`): edits inside the open project are allowed and reviewed afterwards; edits outside it are denied with a reason Claude sees; everything else is asked in the chat (Allow / Allow for this chat / Deny). "Allow for this chat" passes Claude Code's suggestions back with `destination: 'session'`, so Tinkr never writes the user's settings files. A chat with no folder open gets no edit tools (`disallowedTools`), because there's nowhere to review them. Stopping a turn cancels its pending requests.
- **Protocol v2:** `toolUse` / `toolResult` (shown as rows in the chat; sub-agent tool calls and text are left out), `fileWillChange` (path + text before the edit, or null for a new file; files over 2 MB or binary are skipped), `fileChanged` (sent when that edit's tool result arrives), `permissionRequest` / `permissionCancelled`, and the `permissionResponse` request. `AgentProvider` gained `respondToPermission`.
- **Review store** (`src/stores/review.ts`): the first "before" text per file is its *baseline*, kept across turns until the file is reviewed. A file is listed while its text on disk differs from the baseline, with git-style line counts. Accept = drop the baseline (or move it forward for one chunk); reject = write the baseline back, or delete a file Claude created. User saves and disk changes refresh it. Changes made by shell commands (`Bash`) aren't tracked: only the edit tools are. Switching folders clears it.
- **Diffs in the editor:** files under review show `@codemirror/merge`'s unified diff against the baseline, with Accept/Reject on each chunk. Accepting a chunk moves the baseline; rejecting one reverts it in the document and saves the file right away (it's a review decision, not a draft). An "Accept all / Reject all" bar sits above the file. When Claude edits a file it opens in the editor and jumps to the first change, without taking the keyboard focus from the chat box or a terminal.
- **Changes bar:** above the chat box while anything is unreviewed: file count, +/− totals, Accept all / Reject all (with a confirmation), and per file: open, accept, reject.
- **Selection menu:** a small popup on any selection, Ctrl+L / Ctrl+Shift+L (these replace CodeMirror's "select line" / "select matches"), and a right-click menu (Ask Claude, Request changes, Cut, Copy, Paste) all add a chip to the composer. On send, each becomes a `<selection file lines purpose>` block before the text; the chat shows the chip, not the raw block. A reference with no text still sends ("Explain the selected code." / "Improve the selected code."). This is also how to comment on a diff hunk: select it and Ask or Request changes.
- **Layout:** chat in the center; the file tree is a collapsible sidebar (Ctrl+B) that shows the open-folder screen when no folder is open; the editor panel opens on the right when a file opens and hides with its ⟩ button or Ctrl+Shift+E (default width 40% of the window); the terminal spans the bottom. The window itself never scrolls.
- **Tests:** unit tests for the policy and helpers (sidecar), the chat store (text segments around tool calls, permission answers and cancellation, file events, references and prompt format), the review store (baselines across edits, no-op edits, accept/reject, created files, chunk accept, disk changes), line counts, and selection-to-reference. `e2e/review.e2e.ts` drives real Claude turns (about $0.60): layout, popup + Ctrl+L + right-click menu, a two-chunk edit shown as a diff with one chunk rejected and one accepted (checked on disk), a permission card for `mkdir` that runs on Allow, and a created file deleted on reject.
- **Not done yet:** tracking changes made by shell commands (would need a git-based snapshot), and a per-hunk comment button (selecting the hunk covers it for now).
