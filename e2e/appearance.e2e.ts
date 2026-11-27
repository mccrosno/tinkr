// End-to-end check of Milestone 8 (themes and backgrounds) in the real Tauri window,
// over CDP. Free (no Claude turns). Launch the app as described in e2e/chat.e2e.ts, then:
//   bun e2e/appearance.e2e.ts
//
// Covers: choosing themes in the Appearance panel (scheme, tokens, see-through panels,
// the picture behind them, blur); a theme-only plugin on disk (JSON + CSS + an SVG
// picture served from its folder, no code); "Reduce effects"; the one-time blur check;
// the terminal following the theme; a theme whose plugin is deleted falling back to
// System. The user's appearance settings are saved first and put back.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { connect, sleep } from './cdp'

const cdp = await connect(Number(process.argv[2] ?? 9222))
const js = <T = unknown>(expr: string) => cdp.evaluate<T>(expr)
const store = (name: string) => `window.__tinkr.pinia._s.get('${name}')`
const appearance = store('appearance')
const settings = store('settings')
const results: string[] = []
const pass = (s: string) => (results.push('PASS ' + s), console.log('PASS', s))
async function until(label: string, expr: string, timeoutMs = 10_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await js<boolean>(expr)) return
    await sleep(100)
  }
  throw new Error('timed out waiting for: ' + label)
}
const root = `document.documentElement`
const cssVar = (name: string) => js<string>(`getComputedStyle(${root}).getPropertyValue('${name}').trim()`)
const card = (id: string) => `document.querySelector('[data-testid=appearance] [data-theme="${id}"]')`

const PLUGIN = 'e2e-theme'
const dir = join(homedir(), '.config', 'tinkr', 'plugins', PLUGIN)
const THEME = `${PLUGIN}.harbor`

// The user's own settings, to put back.
const saved = await js<Record<string, unknown>>(`JSON.parse(JSON.stringify(${settings}.data.app ?? {}))`)

try {
  // 1. The Appearance panel lists the themes; picking one applies it.
  await js(`${store('layout')}.show('appearance')`)
  await until('panel', `!!${card('system')} && !!${card('dusk')}`)
  await js(`${card('tinkr-light')}.click()`)
  await until('light', `${root}.dataset.tkScheme === 'light' && ${appearance}.theme.id === 'tinkr-light'`)
  if ((await cssVar('--tk-bg')) !== '#f6f5f2') throw new Error('light colors not applied: ' + (await cssVar('--tk-bg')))
  await js(`${card('midnight')}.click()`)
  await until('midnight', `${root}.dataset.tkScheme === 'dark' && getComputedStyle(${root}).getPropertyValue('--tk-accent').trim() === '#58a6ff'`)
  if ((await js<string | null>(`${settings}.appValue('appearance.theme', null)`)) !== 'midnight') throw new Error('choice not saved')
  pass('the Appearance panel switches themes (light set, token overrides) and remembers the choice')

  // 2. A picture with see-through, blurred panels (Dusk), unless effects are reduced.
  await js(`${settings}.setAppValue('appearance.reduceEffects', false)`)
  await js(`${card('dusk')}.click()`)
  await until('dusk', `!!document.querySelector('[data-testid=background]') && ${root}.classList.contains('tk-glass')`)
  if (!(await cssVar('--tk-bg')).startsWith('color-mix(')) throw new Error('panels not see-through')
  const blur = await js<string>(`getComputedStyle(document.querySelector('.dv-groupview')).backdropFilter`)
  if (!blur.includes('blur(18px)')) throw new Error('no blur on panels: ' + blur)
  const popup = await cssVar('--tk-popup')
  if (popup.includes('color-mix')) throw new Error('popups should stay opaque')
  await js(`document.querySelector('[data-testid=reduce-effects]').click()`)
  await until('no glass', `!${root}.classList.contains('tk-glass') && ${appearance}.reduceEffects === true`)
  pass('Dusk: animated SVG behind see-through panels with blur; "Reduce effects" turns the blur off (menus stay opaque)')

  // 3. The one-time blur check: with the setting undecided, it measures and decides.
  await js(`${settings}.setAppValue('appearance.reduceEffects', undefined); ${settings}.setAppValue('appearance.blurProbe', undefined)`)
  await js(`${appearance}.probeIfNeeded()`)
  await until('probed', `${appearance}.reduceEffects !== null && !!${settings}.appValue('appearance.blurProbe', null)`, 5000)
  const probe = await js<{ p95: number }>(`JSON.parse(JSON.stringify(${settings}.appValue('appearance.blurProbe', null)))`)
  pass(`the blur check measured ${probe.p95} ms per frame and ${probe.p95 > 25 ? 'turned blur off' : 'kept blur on'}`)

  // 4. A theme-only plugin on disk: JSON, CSS and an SVG picture, no code.
  mkdirSync(join(dir, 'img'), { recursive: true })
  writeFileSync(
    join(dir, 'img', 'waves.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#0b2233"/><path d="M0 10 Q10 0 20 10 T40 10" stroke="#1e5a7a" fill="none"/></svg>`,
  )
  writeFileSync(join(dir, 'harbor.css'), `.titlebar { letter-spacing: 0.02em; }\n`)
  writeFileSync(
    join(dir, 'harbor.json'),
    JSON.stringify({ id: 'harbor', name: 'Harbor', kind: 'dark', tokens: { accent: '#3fb0c9' }, background: { image: 'img/waves.svg', size: 'tile' }, translucency: 0.3, cssFile: 'harbor.css' }),
  )
  await js(`${settings}.setApproval('${PLUGIN}', true)`)
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ name: PLUGIN, displayName: 'E2E theme', themes: ['harbor.json'] }))
  await until('theme card', `!!${card(THEME)}`)
  await js(`${card(THEME)}.click()`)
  await until('applied', `${appearance}.theme.id === '${THEME}' && getComputedStyle(${root}).getPropertyValue('--tk-accent').trim() === '#3fb0c9'`)
  const url = await js<string>(`${appearance}.theme.background.url`)
  if (!/tinkr-plugin/.test(url) || !url.endsWith('/img/waves.svg')) throw new Error('picture URL: ' + url)
  const loaded = await js<boolean>(`new Promise((ok) => { const i = new Image(); i.onload = () => ok(true); i.onerror = () => ok(false); i.src = ${JSON.stringify(url)} })`)
  if (!loaded) throw new Error('the picture did not load from the plugin folder')
  if ((await js<string>(`getComputedStyle(document.querySelector('.titlebar')).letterSpacing`)) === 'normal') throw new Error("the theme's CSS file was not applied")
  pass('a theme-only plugin (JSON + CSS + SVG from its folder, no code) shows up, applies, and its picture loads')

  // 5. The terminal's colors follow the theme (xterm needs real colors, even from color-mix).
  const termBg = await js<string>(`(() => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = getComputedStyle(${root}).getPropertyValue('--tk-bg').trim(); c.fillRect(0, 0, 1, 1); return c.getImageData(0, 0, 1, 1).data.join(',') })()`)
  if (!/,\d+$/.test(termBg) || termBg.endsWith(',255')) throw new Error('see-through bg should resolve to a translucent color: ' + termBg)
  pass(`see-through colors resolve to real values for the terminal (rgba ${termBg})`)

  // 6. Deleting the plugin: System is shown, the choice is kept for when it's back.
  rmSync(dir, { recursive: true, force: true })
  await until('fell back', `${appearance}.theme.id === 'system' && ${appearance}.selectedId === '${THEME}' && !${root}.dataset.tkScheme`)
  if (await js<boolean>(`!!document.getElementById('tk-theme-css')`)) throw new Error("the theme's CSS stayed")
  pass("deleting the theme's plugin falls back to System (its CSS is removed); the choice is kept")

  console.log(`\n${results.length} checks passed.`)
} finally {
  rmSync(dir, { recursive: true, force: true })
  await sleep(600)
  await js(`(() => {
    const s = ${settings}
    s.forgetPlugin('${PLUGIN}')
    for (const k of ['appearance.theme', 'appearance.reduceEffects', 'appearance.blurProbe']) s.setAppValue(k, undefined)
    for (const [k, v] of Object.entries(${JSON.stringify(saved)})) s.setAppValue(k, v)
    ${store('layout')}.hide('appearance')
    return s.flush()
  })()`).catch(() => {})
  cdp.close()
}
process.exit(0)
