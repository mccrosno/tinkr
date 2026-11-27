// Turning a theme into the page's look (SPEC.md "Theming"): which base color set
// (dark/light), the token overrides, see-through panels over a background picture, blur
// behind them, and the theme's extra CSS.
//
// `themeVars` is the pure part (unit-tested): a theme in, CSS variables out.
// `applyTheme` puts them on <html> and removes the previous theme's.

/** A theme as the app uses it: a plugin's ThemeDefinition with its picture resolved to a URL. */
export interface ResolvedTheme {
  id: string
  /** The plugin it came from ("themes" for the built-in ones). */
  plugin: string
  name: string
  /** null = follow the OS (the "System" theme). */
  kind: 'dark' | 'light' | null
  tokens: Record<string, string>
  background: { url: string; size: 'cover' | 'contain' | 'tile'; position: string; opacity: number } | null
  translucency: number
  blur: number
  css: string
}

/** Panels and bars that turn see-through over a background (menus use --tk-popup and stay opaque). */
export const SEE_THROUGH_TOKENS = ['--tk-bg', '--tk-surface', '--tk-surface-2', '--tk-code-bg'] as const

export const MAX_TRANSLUCENCY = 0.9

/** "accent" -> "--tk-accent"; "--tk-accent" stays. */
export const tokenName = (name: string) => (name.startsWith('--') ? name : `--tk-${name.replace(/^tk-/, '')}`)

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo))

export interface ThemeVars {
  /** data-tk-scheme on <html>; null = follow the OS. */
  scheme: 'dark' | 'light' | null
  /** CSS variables to set on <html>. */
  vars: Record<string, string>
  /** Blur in px for see-through panels, 0 = none. */
  blur: number
}

/**
 * The CSS variables for a theme. `base(name)` gives a token's value in the theme's base
 * color set (read from the page in the app), used when a see-through token isn't
 * overridden. `reduceEffects` turns blur off.
 */
export function themeVars(theme: ResolvedTheme, base: (name: string) => string, reduceEffects: boolean): ThemeVars {
  const vars: Record<string, string> = {}
  for (const [name, value] of Object.entries(theme.tokens)) {
    // A value that could end the declaration (`;`, `{`) isn't a value; skip it.
    if (/[;{}]/.test(value)) continue
    vars[tokenName(name)] = value.trim()
  }
  // The opaque colors follow the theme's own bg/surface unless it sets them itself:
  // the window around the panel cards (darker than bg, so the cards stand out), and
  // menus/popups.
  const darken = theme.kind === 'light' ? 93 : 65
  if (vars['--tk-bg']) vars['--tk-window'] ??= `color-mix(in srgb, ${vars['--tk-bg']} ${darken}%, black)`
  if (vars['--tk-surface']) vars['--tk-popup'] ??= vars['--tk-surface']

  const t = theme.background ? clamp(theme.translucency, 0, MAX_TRANSLUCENCY) : 0
  if (t > 0) {
    const keep = Math.round((1 - t) * 100)
    for (const name of SEE_THROUGH_TOKENS) {
      const color = vars[name] ?? base(name)
      vars[name] = `color-mix(in srgb, ${color} ${keep}%, transparent)`
    }
  }
  const blur = t > 0 && !reduceEffects ? clamp(theme.blur, 0, 60) : 0
  if (blur) vars['--tk-blur'] = `${blur}px`
  return { scheme: theme.kind, vars, blur }
}

let applied: string[] = []

/** Apply a theme to the page (the previous one's variables are removed first). */
export function applyTheme(theme: ResolvedTheme, reduceEffects: boolean, root: HTMLElement = document.documentElement) {
  for (const name of applied) root.style.removeProperty(name)
  applied = []
  if (theme.kind) root.dataset.tkScheme = theme.kind
  else delete root.dataset.tkScheme
  // Base values are read after the scheme is set and the old overrides are gone.
  const computed = getComputedStyle(root)
  const { vars, blur } = themeVars(theme, (name) => computed.getPropertyValue(name).trim(), reduceEffects)
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value)
    applied.push(name)
  }
  root.classList.toggle('tk-glass', blur > 0)
  root.classList.toggle('tk-has-background', !!theme.background)

  let style = document.getElementById('tk-theme-css') as HTMLStyleElement | null
  if (theme.css) {
    if (!style) {
      style = document.createElement('style')
      style.id = 'tk-theme-css'
      document.head.append(style)
    }
    style.textContent = theme.css
  } else style?.remove()
}

/** The "System" theme: Tinkr's own colors, light or dark as the OS says. */
export const SYSTEM_THEME: ResolvedTheme = {
  id: 'system',
  plugin: 'themes',
  name: 'System',
  kind: null,
  tokens: {},
  background: null,
  translucency: 0,
  blur: 0,
  css: '',
}
