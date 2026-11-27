# Writing Tinkr plugins

<!-- Written by Tinkr, and replaced when Tinkr updates it. To keep your own changes, delete this comment. -->

This folder holds the user's Tinkr plugins. Tinkr is a desktop app (a chat with Claude, an
editor and a terminal) that runs in a webview, and plugins are how it's extended: panels,
commands, buttons, layout presets and themes. If `CLAUDE.local.md` exists here, read it too.

## What's here

| File | What |
|---|---|
| `tinkr-api.d.ts` | The whole plugin API, documented. Read it before using anything you're unsure of. |
| `tinkr-tokens.css` | Every theme color and size (`--tk-...`). Reference only; editing it does nothing. |
| `.claude/skills/tinkr-plugin/` | A skill with an example of each thing a plugin can add. |
| `<name>/` | One plugin per folder. |

## How to write or change a plugin

1. Create `<name>/plugin.json` and `<name>/index.js` (or edit the existing files). The folder
   name may use letters, digits, `-`, `_` and `.`, and must equal `"name"` in `plugin.json`.
2. Call the `reload_plugin` tool with the folder name. It loads the plugin and reports its
   state, what it registered and every error. (Without that tool, for example in a terminal,
   Tinkr reloads the plugin when its files change and shows errors in its Console panel.)
3. Fix what it reports and call it again until the plugin is on with no errors.
4. If the user says something misbehaves while they use it, call `plugin_status` to see the
   errors logged since.

Tell the user what you added and where to find it (which panel, button, command or
shortcut). A load without errors doesn't prove the plugin looks or behaves right, and you
can't see the window, so say what they should check.

What the user controls:
- A plugin Tinkr hasn't seen before runs only after the user approves it in a dialog. This
  can appear as soon as `plugin.json` is written.
- If the user turned a plugin off, leave it off and ask them to turn it on (Plugins panel).
- Tinkr asks the user before you edit files here, because plugin code runs inside Tinkr.
- Don't edit `../settings.json`; Tinkr manages it.

## A complete plugin

`notes/plugin.json`:

```json
{
  "name": "notes",
  "displayName": "Notes",
  "version": "0.1.0",
  "description": "A scratchpad panel.",
  "main": "index.js"
}
```

`notes/index.js`:

```js
/** @param {import('../tinkr-api').TinkrApi} api */
export function activate(api) {
  api.panels.register({
    id: 'panel',
    title: 'Notes',
    location: 'right',
    icon: 'M5 4h14v16H5zM8 9h8M8 13h8',
    mount(el) {
      const box = document.createElement('textarea')
      box.className = 'tk-fill'
      box.value = api.settings.get('text', '')
      box.style.cssText = 'border: 0; resize: none; padding: 12px; background: transparent'
      box.addEventListener('input', () => api.settings.set('text', box.value))
      el.append(box)
      return () => box.remove()
    },
  })

  api.commands.register({
    id: 'open',
    title: 'Notes: open',
    keybinding: 'Ctrl+Alt+N',
    run: () => api.layout.show('notes.panel'),
  })
}
```

## Rules that matter

- **Plain ES modules, no build step.** Imports must be relative paths to files in the plugin
  (`./lib/a.js`). A bare import like `'vue'` fails. No TypeScript or JSX; use JSDoc for
  types. There is no Node.js: no `fs`, `path`, `process` or `require`.
- **Use the API for the app.** Files, Claude, the terminal, settings and notifications go
  through `api`. `api.agent` needs `"agent"` in `permissions`, `api.terminal` needs `"pty"`,
  and file access through `api.workspace` needs `"fs"`. Ask only for what the plugin uses.
- **Ids** you register are prefixed with the plugin name: panel `panel` in `notes` is
  `notes.panel`. Pass the full id to `api.layout.show`.
- **Reloads must leave nothing behind.** Everything registered through `api` is removed for
  you. Timers, listeners on `window` or `document`, observers and added `<style>` tags are
  not: remove them in the function `mount` returns, or in `export function deactivate()`.
- **`mount` runs once per load.** The element is moved when the layout changes, not rebuilt.
- **Colors come from tokens:** `var(--tk-text)`, `var(--tk-surface)`, `var(--tk-accent)`...
  so the panel follows every theme. Ready-made classes: `tk-button` (add `primary`),
  `tk-icon-button`, and `tk-fill` (take the rest of the panel; a panel is a flex column).
- **Styles are global.** Prefix your class names with the plugin name.
- **Never put untrusted text into `innerHTML`** (file contents, replies, anything fetched).
  Use `textContent`: markup that runs in this window can do whatever Tinkr can.
- Show failures to the user with `api.notifications` and details with `api.log`.
