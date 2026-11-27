---
name: tinkr-plugin
description: Write or change a plugin for Tinkr, the app this chat runs in - a new panel, command, keyboard shortcut, button, selection-menu action, layout preset or theme. Use when the user asks to add to Tinkr, customize it, theme it, or fix one of its plugins.
---

<!-- Written by Tinkr, and replaced when Tinkr updates it. To keep your own changes, delete this comment. -->

# What a Tinkr plugin can add

Plugins live in Tinkr's plugins folder (three folders up from this file). Read `CLAUDE.md`
there first: it has the folder layout, the rules and the reload loop. `tinkr-api.d.ts`
beside it is the full API. After any change, call `reload_plugin` with the folder name.

Register everything inside `export function activate(api)`.

## Panels

A dockable card the user can drag anywhere; it appears in the "+" panel list and can be
pinned to the side rail.

```js
api.panels.register({
  id: 'panel',
  title: 'Build status',
  location: 'bottom', // left | right | bottom | center; only where it first appears
  icon: 'M4 6h16M4 12h16M4 18h9', // SVG path data on a 24x24 grid, or an .svg file's path
  badge: () => failed, // a dot on the rail icon
  isEnabled: () => !!api.workspace.root(), // false dims the icon
  mount(el, ctx) {
    // Build the content in `el` (a flex column). ctx.visible / ctx.onDidChangeVisibility
    // say when it's on screen: pause polling while it isn't.
    const timer = setInterval(() => ctx.visible && refresh(), 5000)
    return () => clearInterval(timer)
  },
})
```

## Commands

Listed in the command palette (Ctrl+Shift+P). Don't reuse Tinkr's shortcuts: Ctrl+N, O, B,
L, S; Ctrl+Shift+B, E, L, P; Ctrl+backquote; Ctrl+Alt+1 to 9. In the terminal, only
shortcuts with Shift or Alt reach commands.

```js
api.commands.register({ id: 'refresh', title: 'Build status: refresh', keybinding: 'Ctrl+Alt+R', run: refresh })
```

## Actions (buttons and menu items)

`slot` is `titlebar`, `statusbar` (bottom of the rail), `chat-toolbar` (in the message
box) or `selection` (the menu on selected code, whose `run` gets the selection).

```js
api.actions.register({
  id: 'explain',
  slot: 'selection',
  title: 'Explain like I am new',
  icon: 'M12 3v18M3 12h18',
  // selection: { path, fromLine, toLine, text }
  run(selection) {
    api.agent.addReference({ ...selection, purpose: 'question' }) // needs "agent"
    api.agent.setDraft('Explain this as if I have never seen the codebase.')
  },
})
```

`isActive`, `isEnabled` and `isVisible` are read on every redraw, so keep them cheap.

## Themes

A theme needs no code. List JSON files in `plugin.json` and leave `main` out:

```json
{ "name": "harbor-theme", "displayName": "Harbor", "themes": ["harbor.json"] }
```

```json
{
  "id": "harbor",
  "name": "Harbor",
  "kind": "dark",
  "tokens": { "bg": "#0b1a24", "surface": "#10232f", "surface-2": "#163040", "border": "#21445a", "accent": "#3fb0c9", "accent-hover": "#62c3d8", "on-accent": "#04161d" },
  "background": { "image": "img/waves.svg", "size": "tile" },
  "translucency": 0.3,
  "blur": 8,
  "cssFile": "harbor.css"
}
```

`kind` picks the base colors the tokens override (names are in `tinkr-tokens.css`, with or
without `--tk-`). `background`, `translucency` (0 to 0.9, needs a picture), `blur` and
`cssFile` are optional. Backgrounds may be PNG, JPEG, WebP, GIF or SVG, animated ones too.
From code, use `api.themes.register` with `css` instead of `cssFile`. The user picks the
theme in the Appearance panel.

## Layout presets

An arrangement offered in the Layout menu. The `layout` is JSON that's hard to write by
hand: ask the user to arrange the panels, run "Layout: copy as JSON" and paste it.

```js
api.layout.registerPreset({ id: 'writing', name: 'Writing', layout: savedJson })
```

## Using the app

```js
const root = api.workspace.root() // the open folder, or null
const text = await api.workspace.readText('README.md') // "fs"; only inside the open folder
api.workspace.onDidChangeFiles((paths) => {})
await api.editor.open('src/main.ts')
await api.agent.send('Run the tests') // "agent"; false if Claude is busy
api.agent.onDidReceive((e) => {}) // { type: 'text', text } or { type: 'done', outcome }
await api.terminal.create() // "pty"
await api.terminal.sendText('npm test\r')
api.settings.set('key', value) // per plugin, survives restarts
api.notifications.info('Done')
api.log.warn('details for the Console panel')
api.plugin.url('img/logo.png') // a URL for a file in this plugin
```
