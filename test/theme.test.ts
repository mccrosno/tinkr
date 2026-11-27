import { beforeEach, describe, expect, test } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'
import { useAppearance } from '../src/stores/appearance'
import { usePlugins } from '../src/stores/plugins'
import { useSettings } from '../src/stores/settings'
import { SYSTEM_THEME, themeVars, tokenName, type ResolvedTheme } from '../src/theme/apply'
import { percentile95 } from '../src/theme/probe'
import { FakeFs } from './fakeFs'

const base = (name: string) => ({ '--tk-bg': '#111111', '--tk-surface': '#222222', '--tk-surface-2': '#333333', '--tk-code-bg': '#000000', '--tk-popup': '#222222' })[name] ?? ''
const theme = (over: Partial<ResolvedTheme> = {}): ResolvedTheme => ({ ...SYSTEM_THEME, id: 't', name: 'T', kind: 'dark', ...over })

describe('themeVars', () => {
  test('token names may be short or full; values that could break out of CSS are dropped', () => {
    expect(tokenName('accent')).toBe('--tk-accent')
    expect(tokenName('--tk-accent')).toBe('--tk-accent')
    const { vars, scheme } = themeVars(theme({ tokens: { accent: '#f00', '--tk-text': ' #eee ', bg: 'red; } body { display: none' } }), base, false)
    expect(scheme).toBe('dark')
    expect(vars).toEqual({ '--tk-accent': '#f00', '--tk-text': '#eee' })
  })

  test("the window and popup colors follow the theme's bg and surface", () => {
    const { vars } = themeVars(theme({ tokens: { bg: '#123456', surface: '#abcdef' } }), base, false)
    expect(vars['--tk-window']).toBe('color-mix(in srgb, #123456 65%, black)') // darker, around the cards
    expect(vars['--tk-popup']).toBe('#abcdef')
    expect(themeVars(theme({ kind: 'light', tokens: { bg: '#ffffff' } }), base, false).vars['--tk-window']).toBe('color-mix(in srgb, #ffffff 93%, black)')
    expect(themeVars(theme({ tokens: { bg: '#123456', window: '#000000' } }), base, false).vars['--tk-window']).toBe('#000000')
  })

  test('see-through panels only with a background; overridden colors are the ones mixed', () => {
    expect(themeVars(theme({ translucency: 0.4 }), base, false).vars['--tk-bg']).toBeUndefined()
    const bg = { url: 'x.svg', size: 'cover' as const, position: 'center', opacity: 1 }
    const { vars, blur } = themeVars(theme({ background: bg, translucency: 0.4, blur: 12, tokens: { surface: '#abcdef' } }), base, false)
    expect(vars['--tk-bg']).toBe('color-mix(in srgb, #111111 60%, transparent)')
    expect(vars['--tk-surface']).toBe('color-mix(in srgb, #abcdef 60%, transparent)')
    expect(vars['--tk-popup']).toBe('#abcdef') // menus stay opaque
    expect(blur).toBe(12)
    expect(vars['--tk-blur']).toBe('12px')
  })

  test('reduce effects: no blur, but still see-through', () => {
    const bg = { url: 'x.svg', size: 'cover' as const, position: 'center', opacity: 1 }
    const r = themeVars(theme({ background: bg, translucency: 0.4, blur: 12 }), base, true)
    expect(r.blur).toBe(0)
    expect(r.vars['--tk-blur']).toBeUndefined()
    expect(r.vars['--tk-bg']).toContain('color-mix')
  })

  test('the System theme follows the OS and changes nothing', () => {
    expect(themeVars(SYSTEM_THEME, base, false)).toEqual({ scheme: null, vars: {}, blur: 0 })
  })

  test('p95 of frame times', () => {
    expect(percentile95([])).toBe(0)
    expect(percentile95([...Array(19).fill(16), 80])).toBe(80)
    expect(percentile95([...Array(100).fill(16)])).toBe(16)
  })
})

describe('appearance store', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await useSettings().load(new FakeFs({ '/cfg': null }), '/cfg/settings.json')
  })

  test('System by default; a chosen theme is remembered in settings', () => {
    const a = useAppearance()
    usePlugins().registerTheme('themes', 'midnight', { id: 'midnight', name: 'Midnight', kind: 'dark' }, (p) => p)
    expect(a.theme.id).toBe('system')
    a.select('midnight')
    expect(a.theme.id).toBe('midnight')
    expect(useSettings().appValue<string | null>('appearance.theme', null)).toBe('midnight')
    a.select('system')
    expect(useSettings().appValue('appearance.theme', null)).toBeNull()
  })

  test("a chosen theme whose plugin is gone shows System, and comes back with the plugin", () => {
    const a = useAppearance()
    a.select('sunset.sunset')
    expect(a.theme.id).toBe('system')
    const d = usePlugins().registerTheme('sunset', 'sunset.sunset', { id: 'sunset', name: 'Sunset', kind: 'dark' }, (p) => p)
    expect(a.theme.id).toBe('sunset.sunset')
    d.dispose()
    expect(a.theme.id).toBe('system')
    expect(a.selectedId).toBe('sunset.sunset') // still the user's choice
  })

  test('reduce effects is undecided until set', () => {
    const a = useAppearance()
    expect(a.reduceEffects).toBeNull()
    a.setReduceEffects(true)
    expect(a.reduceEffects).toBe(true)
  })
})
