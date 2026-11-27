// End-to-end check of Milestone 10 (Claude writing plugins) in the real Tauri window, over
// CDP. Uses your real Claude Code login: one turn on Haiku, a few cents. Launch the app as
// described in e2e/chat.e2e.ts, then:
//   bun e2e/authoring.e2e.ts
//
// Covers: the authoring files in the plugins folder; "New plugin with Claude"; Claude
// writing a plugin named "e2e-authored" after one "Allow for this chat", loading it with
// reload_plugin; the files under review as "plugins/..."; and rejecting them, which
// unloads the plugin. The plugin is approved through the settings store first (the native
// dialog can't be driven over CDP), and removed with its chat at the end.

import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { connect, deleteTestChats, sleep } from './cdp'

const cdp = await connect(Number(process.argv[2] ?? 9222))
const js = <T = unknown>(expr: string) => cdp.evaluate<T>(expr)
const store = (name: string) => `window.__tinkr.pinia._s.get('${name}')`
const chat = store('chat')
const plugins = store('plugins')
const review = store('review')
const settings = store('settings')
const layout = store('layout')
const results: string[] = []
const pass = (s: string) => (results.push('PASS ' + s), console.log('PASS', s))
async function until(label: string, expr: string, timeoutMs = 10_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await js<boolean>(expr)) return
    await sleep(150)
  }
  throw new Error(`timed out waiting for: ${label}\n  log: ${await js(`JSON.stringify(${plugins}.log.slice(-5).map(l => l.plugin + ': ' + l.text.slice(0, 300)))`)}`)
}

const root = join(homedir(), '.config', 'tinkr', 'plugins')
const NAME = 'e2e-authored'
const mine = `${review}.files.filter(f => f.relPath.startsWith('plugins/${NAME}/'))`

await until('agent ready', `!!window.__tinkr && ${chat}.cli?.state === 'ok' && ${chat}.models.length > 0 && !${chat}.busy`, 30_000)

// 1. The authoring files.
for (const file of ['CLAUDE.md', 'tinkr-api.d.ts', 'tinkr-tokens.css', '.claude/skills/tinkr-plugin/SKILL.md'])
  if (!existsSync(join(root, file))) throw new Error(`missing in the plugins folder: ${file}`)
pass('the plugins folder has CLAUDE.md, the typed API, the tokens and the skill')

const savedModel = await js<string>(`${chat}.model`)
const savedDraft = await js<string>(`${chat}.draft`)
let session: string | null = null
try {
  // 2. "New plugin with Claude".
  await js(`${chat}.draft = ''; ${layout}.show('plugins')`)
  await until('button', `!!document.querySelector('[data-testid=plugins-panel] .bar button.primary')`)
  await js(`document.querySelector('[data-testid=plugins-panel] .bar button.primary').click()`)
  await until('draft', `${chat}.draft.startsWith('Make me a Tinkr plugin') && ${layout}.shown.chat`)
  pass('"New plugin with Claude" starts the request in the message box')

  // 3. A real turn.
  await js(`${settings}.setApproval('${NAME}', true); ${chat}.draft = ''; ${chat}.newChat(); ${chat}.setModel('haiku')`)
  await js(
    `${chat}.send('Make a Tinkr plugin called ${NAME}: one panel titled "E2E" that shows the text "written by Claude". Keep it minimal and check it with reload_plugin.')`,
  )
  let asked = 0
  const t0 = Date.now()
  while (await js<boolean>(`${chat}.busy`)) {
    if (Date.now() - t0 > 180_000) throw new Error('the turn did not finish')
    // Allow edits to the test plugin; refuse anything else.
    asked += await js<number>(`(() => {
      const c = ${chat}
      let n = 0
      for (const m of c.messages) {
        const p = m.permission
        if (p?.state !== 'pending') continue
        const ours = p.pluginEdit?.plugin === '${NAME}'
        if (ours) n++
        c.respondToPermission(p.requestId, ours ? 'allowForChat' : 'deny')
      }
      return n
    })()`)
    await sleep(300)
  }
  session = await js<string | null>(`${chat}.sessionId`)
  if (asked !== 1) throw new Error(`asked ${asked} times about the plugin; expected once`)
  pass('asked once before editing the plugin')
  if (!(await js<boolean>(`${chat}.messages.some(m => m.tool?.name === 'mcp__tinkr__reload_plugin' && m.tool.status === 'done')`)))
    throw new Error('no successful reload_plugin call')
  await until('active', `${plugins}.record('${NAME}')?.state === 'active'`)
  await js(`${layout}.show([...${plugins}.panels.keys()].find(id => id.startsWith('${NAME}.')))`)
  await until('panel', `document.querySelector('[data-panel^="${NAME}."]')?.textContent.includes('written by Claude')`)
  pass('Claude wrote the plugin and loaded it with reload_plugin; its panel shows')

  // 4. Review, and rejecting it all.
  await until('under review', `${mine}.length >= 2`)
  pass('its files are under review, named from the plugins folder')
  await js(`(async () => { for (const f of [...${mine}]) await ${review}.reject(f.path) })()`)
  await until('unloaded', `!${plugins}.record('${NAME}') && ![...${plugins}.panels.keys()].some(id => id.startsWith('${NAME}.'))`)
  pass('rejecting the files unloads the plugin')
  console.log(`\n${results.length} checks passed.`)
} finally {
  await js(`(async () => { for (const f of [...${mine}]) await ${review}.reject(f.path) })()`).catch(() => {})
  rmSync(join(root, NAME), { recursive: true, force: true })
  await sleep(600) // let the watcher notice
  await deleteTestChats(js, { ids: [session] }).catch(() => {})
  await js(`(() => { ${chat}.setModel(${JSON.stringify(savedModel)}); ${chat}.draft = ${JSON.stringify(savedDraft)}; ${layout}.hide('plugins'); const s = ${settings}; s.forgetPlugin('${NAME}'); return s.flush() })()`).catch(() => {})
  cdp.close()
}
process.exit(0)
