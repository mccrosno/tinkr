// End-to-end check of Milestone 7 (plugins) in the real Tauri window, over CDP. Free (no
// Claude turns). Launch the app as described in e2e/chat.e2e.ts, then:
//   bun e2e/plugins.e2e.ts
//
// Writes test plugins named "e2e-..." into the real plugins folder
// (~/.config/tinkr/plugins), approves them through the settings store first (the native
// approval dialog can't be driven over CDP), and removes them and their settings at the
// end. Covers: built-ins running as plugins; the command palette; a plugin on disk
// loading over the tinkr-plugin scheme with a relative import; its panel, command (and
// keybinding), titlebar/statusbar/chat-toolbar buttons and settings; hot reload of an
// imported file (the panel keeps its place); a load error in the Console with "Ask
// Claude to fix"; recovery; permissions; a plugin left off; deleting a plugin.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { connect, sleep } from './cdp'

const cdp = await connect(Number(process.argv[2] ?? 9222))
const js = <T = unknown>(expr: string) => cdp.evaluate<T>(expr)
const store = (name: string) => `window.__tinkr.pinia._s.get('${name}')`
const plugins = store('plugins')
const settings = store('settings')
const dock = 'window.__tinkrDock'
const results: string[] = []
const pass = (s: string) => (results.push('PASS ' + s), console.log('PASS', s))
async function until(label: string, expr: string, timeoutMs = 10_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await js<boolean>(expr)) return
    await sleep(100)
  }
  throw new Error(`timed out waiting for: ${label}\n  plugins: ${await js(`JSON.stringify(${plugins}.plugins.filter(p => p.name.startsWith('e2e-')))`)}\n  log: ${await js(`JSON.stringify(${plugins}.log.slice(-5).map(l => l.plugin + ': ' + l.text.slice(0, 300)))`)}`)
}
const key = async (key: string, code: string, vk: number, modifiers = 0) => {
  for (const type of ['keyDown', 'keyUp'] as const)
    await cdp.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, modifiers })
}
const ALT = 1
const CTRL = 2
const SHIFT = 8

const root = join(homedir(), '.config', 'tinkr', 'plugins')
const SAMPLE = 'e2e-sample'
const OFF = 'e2e-off'
const NOPERM = 'e2e-noperm'
const ours = [SAMPLE, OFF, NOPERM]
const dir = (name: string) => join(root, name)

function write(name: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    const path = join(dir(name), file)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
  }
}

const SAMPLE_INDEX = `import { message } from './lib/message.js'
export function activate(api) {
  api.panels.register({
    id: 'main', title: 'Sample', location: 'right',
    mount(el, ctx) {
      el.innerHTML = '<p class="sample-text"></p><p class="sample-visible"></p>'
      el.querySelector('.sample-text').textContent = message
      const vis = el.querySelector('.sample-visible')
      ctx.onDidChangeVisibility((v) => (vis.textContent = v ? 'visible' : 'hidden'))
    },
  })
  api.commands.register({ id: 'count', title: 'Sample: count', keybinding: 'Ctrl+Alt+Shift+K', run: () => api.settings.set('count', api.settings.get('count', 0) + 1) })
  api.actions.register({ id: 'top', slot: 'titlebar', title: 'Sample', run: () => api.commands.execute('e2e-sample.count') })
  api.actions.register({ id: 'bottom', slot: 'statusbar', title: 'Sample status', run() {} })
  api.actions.register({ id: 'composer', slot: 'chat-toolbar', title: 'Sample tool', run() {} })
  api.log.info('sample is up:', message)
}
`

try {
  if (!existsSync(root)) throw new Error(`no plugins folder at ${root}`)
  // Approve the test plugins (and leave one off) before they exist, so no dialog appears.
  await js(`${settings}.setApproval('${SAMPLE}', true); ${settings}.setApproval('${NOPERM}', true); ${settings}.setApproval('${OFF}', false)`)

  // 1. The built-in panels, commands and buttons come from built-in plugins.
  const builtIns = await js<string[]>(`${plugins}.plugins.filter(p => p.builtIn && p.state === 'active').map(p => p.name)`)
  for (const n of ['core', 'chat', 'files', 'editor', 'terminal', 'console', 'plugins']) if (!builtIns.includes(n)) throw new Error('built-in not active: ' + n)
  if (!(await js<boolean>(`!!document.querySelector('[data-panel=chat] .chat textarea') && !!document.querySelector('.titlebar [data-action=openFolder]')`)))
    throw new Error('built-in panel or button missing')
  pass(`built-ins run as plugins (${builtIns.length}); the chat panel and titlebar buttons come from them`)

  // 2. The command palette lists commands and runs the chosen one.
  await key('P', 'KeyP', 80, CTRL | SHIFT)
  await until('palette', `!!document.querySelector('[data-testid=palette] input')`)
  await cdp.send('Input.insertText', { text: 'view console' })
  await until('filtered', `[...document.querySelectorAll('[data-testid=palette] li[data-command]')].map(l => l.dataset.command).join() === 'view.console'`)
  await key('Enter', 'Enter', 13)
  await until('console shown', `${store('layout')}.shown.console && !document.querySelector('[data-testid=palette]')`)
  pass('Ctrl+Shift+P opens the palette; typing filters; Enter runs "View: Console"')

  // 3. A plugin on disk: loaded over the tinkr-plugin scheme, with a relative import.
  write(SAMPLE, {
    'plugin.json': JSON.stringify({ name: SAMPLE, displayName: 'E2E sample', version: '1.0.0', main: 'index.js' }),
    'lib/message.js': `export const message = 'sample v1'\n`,
    'index.js': SAMPLE_INDEX,
  })
  await until('sample active', `${plugins}.record('${SAMPLE}')?.state === 'active'`)
  await js(`${store('layout')}.show('${SAMPLE}.main')`)
  await until('panel content', `document.querySelector('[data-panel="${SAMPLE}.main"] .sample-text')?.textContent === 'sample v1'`)
  await until('told it is visible', `document.querySelector('[data-panel="${SAMPLE}.main"] .sample-visible')?.textContent === 'visible'`)
  for (const sel of ['.titlebar [data-action="e2e-sample.top"]', '.statusbar [data-action="e2e-sample.bottom"]', '.composer [data-action="e2e-sample.composer"]'])
    if (!(await js<boolean>(`!!document.querySelector(${JSON.stringify(sel)})`))) throw new Error('missing button ' + sel)
  pass('a plugin on disk loads (relative import works); its panel, titlebar, statusbar and composer buttons appear')

  // 4. Its command runs from its keybinding and from its button; settings persist.
  await key('K', 'KeyK', 75, CTRL | ALT | SHIFT)
  await js(`document.querySelector('.titlebar [data-action="e2e-sample.top"]').click()`)
  await until('count = 2', `${settings}.pluginValue('${SAMPLE}', 'count', 0) === 2`)
  pass('its command runs by keybinding (Ctrl+Alt+Shift+K) and from its titlebar button; its settings are stored')

  // 5. Hot reload: changing only the imported file reloads it; the panel stays where it is.
  const groupBefore = await js<string>(`${dock}.getPanel('${SAMPLE}.main').group.id`)
  write(SAMPLE, { 'lib/message.js': `export const message = 'sample v2'\n` })
  await until('reloaded text', `document.querySelector('[data-panel="${SAMPLE}.main"] .sample-text')?.textContent === 'sample v2'`)
  if ((await js<string>(`${dock}.getPanel('${SAMPLE}.main')?.group.id`)) !== groupBefore) throw new Error('panel moved on reload')
  pass('changing a file the plugin imports reloads it; the panel keeps its place')

  // 6. A broken plugin: the error is in the Console, and "Ask Claude to fix" fills the message box.
  write(SAMPLE, { 'index.js': `export function activate(api) { api.panels.register({ id: 'main', title: 'Sample', mount() {} }); undefinedThing.call() }\n` })
  await until('error state', `${plugins}.record('${SAMPLE}')?.state === 'error'`)
  await js(`${store('layout')}.show('console')`)
  await until('console error', `[...document.querySelectorAll('[data-testid=console] li.error[data-plugin="${SAMPLE}"]')].some(l => l.textContent.includes('undefinedThing'))`)
  await js(`[...document.querySelectorAll('[data-testid=console] li.error[data-plugin="${SAMPLE}"] .fix')].at(-1).click()`)
  await until('draft filled', `${store('chat')}.draft.includes('${SAMPLE}') && ${store('chat')}.draft.includes('undefinedThing') && ${store('layout')}.shown.chat`)
  if (!(await js<boolean>(`${store('chat')}.draft.includes(${JSON.stringify(dir(SAMPLE))})`))) throw new Error('draft lacks the plugin folder')
  await js(`${store('chat')}.draft = ''`)
  pass('a broken plugin shows its error in the Console; "Ask Claude to fix" puts it (with the folder) in the message box')

  // 7. Fixed again: back to active.
  write(SAMPLE, { 'index.js': SAMPLE_INDEX })
  await until('recovered', `${plugins}.record('${SAMPLE}')?.state === 'active'`)
  pass('fixing the file brings it back')

  // 8. Permissions: using api.agent without asking for it fails with a clear message.
  write(NOPERM, {
    'plugin.json': JSON.stringify({ name: NOPERM, main: 'index.js' }),
    'index.js': `export function activate(api) { api.agent.busy() }\n`,
  })
  await until('noperm error', `${plugins}.record('${NOPERM}')?.state === 'error'`)
  const permError = await js<string>(`${plugins}.record('${NOPERM}').error`)
  if (!permError.includes('"agent"') || !permError.includes('permissions')) throw new Error('unclear permission error: ' + permError)
  pass('api.agent without "agent" in permissions fails with a message saying what to add')

  // 9. A plugin the user said no to stays off, shown in the Plugins panel with "Turn on".
  write(OFF, { 'plugin.json': JSON.stringify({ name: OFF, main: 'index.js' }), 'index.js': `export function activate() { throw new Error('should not run') }\n` })
  await until('off', `${plugins}.record('${OFF}')?.state === 'disabled'`)
  await js(`${store('layout')}.show('plugins')`)
  await until('listed', `[...document.querySelectorAll('[data-testid=plugins-panel] li[data-plugin="${OFF}"] button')].some(b => b.textContent.trim() === 'Turn on')`)
  pass('a plugin that was turned down stays off (its code never runs) and offers "Turn on"')

  // 10. Deleting a plugin's folder unloads it and closes its panel.
  rmSync(dir(SAMPLE), { recursive: true, force: true })
  await until('unloaded', `!${plugins}.record('${SAMPLE}') && !${dock}.getPanel('${SAMPLE}.main') && !document.querySelector('.titlebar [data-action="e2e-sample.top"]')`)
  pass('deleting the folder unloads the plugin: panel, buttons and commands are gone')

  console.log(`\n${results.length} checks passed.`)
} finally {
  for (const name of ours) rmSync(dir(name), { recursive: true, force: true })
  await sleep(600) // let the watcher unload them
  await js(`(() => { const s = ${settings}; for (const n of ${JSON.stringify(ours)}) s.forgetPlugin(n); return s.flush() })()`).catch(() => {})
  await js(`${store('layout')}.hide('console'); ${store('layout')}.hide('plugins')`).catch(() => {})
  cdp.close()
}
process.exit(0)
