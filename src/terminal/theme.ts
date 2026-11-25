// xterm.js colors from Tinkr's CSS variables (src/styles/tokens.css). xterm.js needs
// actual color values rather than `var(...)`, so this reads the computed values; call
// it again when the color scheme changes.

import type { ITheme } from '@xterm/xterm'

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const

/** Build an xterm.js theme. `read` looks up a variable (injectable for tests). */
export function terminalTheme(read: (name: string) => string = cssVar): ITheme {
  const theme: ITheme = {
    background: read('--tk-bg'),
    foreground: read('--tk-text'),
    cursor: read('--tk-accent'),
    cursorAccent: read('--tk-bg'),
    selectionBackground: read('--tk-selection'),
  }
  // "red" -> theme.red from --tk-term-red, theme.brightRed from --tk-term-bright-red.
  // The casts are needed because TypeScript can't check keys built from strings.
  for (const name of ANSI) {
    const bright = `bright${name[0].toUpperCase()}${name.slice(1)}` as keyof ITheme
    ;(theme as Record<string, string>)[name] = read(`--tk-term-${name}`)
    ;(theme as Record<string, string>)[bright] = read(`--tk-term-bright-${name}`)
  }
  return theme
}

/** The terminal font: the same monospace stack as the editor. */
export const terminalFont = () => cssVar('--tk-font-mono')

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
