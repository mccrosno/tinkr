// xterm.js colors from Tinkr's CSS variables (src/styles/tokens.css). xterm.js needs
// actual color values rather than `var(...)` or `color-mix(...)` (which a see-through
// theme uses), so each one is resolved to rgba(); call it again when the theme or the
// color scheme changes.

import type { ITheme } from '@xterm/xterm'

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const

/** Build an xterm.js theme. `read` looks up a variable (injectable for tests). */
export function terminalTheme(read: (name: string) => string = cssColor): ITheme {
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

let pixel: CanvasRenderingContext2D | null = null

/**
 * A token's color as rgba(), whatever CSS syntax it's written in: paint one pixel with
 * it and read the pixel back (works for color-mix() in every engine).
 */
function cssColor(name: string) {
  const value = cssVar(name)
  pixel ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!pixel || !value) return value
  pixel.clearRect(0, 0, 1, 1)
  pixel.fillStyle = '#000'
  pixel.fillStyle = value // an invalid color leaves the black in place
  pixel.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = pixel.getImageData(0, 0, 1, 1).data
  return `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`
}
