# Next changes (handoff, 2026-11-27)

Work moved to another machine in the middle of a round of small changes. This file records
what was asked for and where things stand. Delete it once everything here is built and
recorded in `SPEC.md`.

The author asked for these changes **before** starting Milestone 11 (git install for
plugins). Done so far: a working indicator in the chat, and plugins being able to run
programs. Still to do: chat modes and app settings.

## The request, in the author's words

> You should add modes to the chats (open, plan, auto). And there needs to be a way to
> modify settings for the app too, like I don't like having the editor auto open when it
> makes changes for a plugin

No code has been written for either one. Only the research below was done.

## 1. Chat modes: open, plan, auto

Each chat gets a mode that controls how much Claude may do without asking. The natural
place for the picker is the message box, beside the model and effort pickers
(`ChatView.vue`).

### Ask before building

**It isn't settled what "open" means.** Ask the author first, because it decides how much
Claude can do unasked. The two likely readings:

- **Today's behaviour:** Claude edits project files (reviewed as diffs) and asks before
  commands and other risky things.
- **No restrictions:** Claude does everything without asking.

"Plan" is presumably Claude Code's plan mode (look and propose, change nothing, until the
user approves the plan). "Auto" is presumably Claude Code's auto mode (a model classifier
approves or denies permission prompts). Confirm both while asking.

### What the SDK offers

Agent SDK 0.3.331 (CLI 2.1.332 was installed on the machine used):

- `PermissionMode` is `'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'`.
- `bypassPermissions` also needs `allowDangerouslySkipPermissions: true`.
- A running query has `setPermissionMode()`. There's a `planModeInstructions` option.
- Not checked yet: whether `auto` is available for every model and login.

### How Tinkr works today

- `sidecar/src/agent.ts` (`turnOptions`) always sends `permissionMode: 'default'`.
- `canUseTool` there applies `decide()` from `sidecar/src/tools.ts`: project edits are
  allowed, edits elsewhere and to Tinkr's `settings.json` are denied, plugin edits and
  everything else are asked about.
- A `PreToolUse` hook sends review baselines, and forces `ask` for anything in Tinkr's
  config folder so that accept-edits mode and allow rules can't skip the plugin question
  (checked live on 2026-11-27).

### What the change involves

- A `mode` field on the `send` request (`shared/protocol.ts`; bump `PROTOCOL_VERSION`),
  in `SendOptions` (`src/agent/types.ts`), `claudeSidecar.ts` and the chat store.
- Decide whether the mode is remembered per chat or app-wide.
- **Keep Tinkr's protections in every mode.** The rules in `decide()` only run when the
  CLI asks for permission. In a mode that approves things itself, edits outside the
  project might never reach it. Enforcing `decide()`'s denials in the `PreToolUse` hook
  would cover that. Whether the hook's forced `ask` still reaches the user in `auto` and
  `bypassPermissions` is **unverified**: test it live (extend
  `sidecar/scripts/plugin-smoke.ts`), including that `settings.json` stays unwritable.
- In any mode that runs commands unasked, changes made by shell commands aren't reviewed
  (only the edit tools are). Say so in the UI and the docs.
- Plan mode ends with the `ExitPlanMode` tool. It needs a card that shows the plan
  (Markdown) with approve and reject, and the mode picker has to follow the change. Check
  that the plugin-folder hook doesn't weaken plan mode.
- The working indicator (`chat.activity`) may want a label for planning.

## 2. App settings

There's no place to change how Tinkr behaves, apart from the Appearance panel. The
example given: the editor shouldn't open by itself when Claude changes files for a plugin.

### Why the editor opens today

`src/main.ts` calls `editor.open(path)` from `review.onChanged`, for every file Claude
changes. Opening a file sets `editor.panelOpen`, and the "core" built-in
(`src/builtins/core.ts`, `editorWanted`) then shows the editor panel.

### Suggested shape

- A Settings panel (a built-in plugin, like Appearance), also reachable from the command
  palette and a shortcut such as Ctrl+,.
- Values saved with `useSettings().setAppValue` (`~/.config/tinkr/settings.json`).
- First setting, "Open the editor when Claude changes a file": **Always** / **Not for
  plugin files** / **Never**. The changes bar still lists the files and opens them on
  click. Even when the panel stays shut, an open tab has to refresh from disk.
- Plugin files are the ones under `usePlugins().dir`.
- Other candidates (not requested): the default chat mode, model and effort.

## Done in this round, but not checked in the running app

- **Working indicator** (`WorkingIndicator.vue`, `chat.activity`): unit-tested; nobody
  has said how it looks yet.
- **Plugins running programs** (`api.programs.run`, `src-tauri/src/programs.rs`,
  permission `run:<program>`): typecheck, unit tests, Clippy and Rust tests pass. The
  call from the window into Rust and the approval dialog haven't been tried. The check
  planned: in a Tinkr chat, ask Claude to change a GitHub pull request plugin from a
  pasted token to the `gh` login, then approve `gh` in the dialog. That plugin lives in
  the plugins folder of the first machine, so on another one ask Claude to make it anew.

## Moving machines

Run `bun install` after pulling. Chats, plugins and Tinkr's settings are stored per
machine and don't come along. See `CLAUDE.md` for the notes on WSL and Windows setup.
