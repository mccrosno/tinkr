// A panel's or button's icon (`icon` in the plugin API). A plugin writes one string:
// either SVG path data on a 24x24 grid ("M4 6h16M4 12h16"), or the path of an .svg
// file in its folder. AppIcon.vue draws both in the theme's text color.

export type Icon = { path: string } | { url: string }

/** Already a URL (built-ins import their files and pass those). */
const IS_URL = /^(https?:|data:|blob:|tinkr-plugin:|\/)/
/** Path data starts with a "move to" command followed by a number. */
const PATH_DATA = /^\s*[Mm]\s*[-+.\d]/

/**
 * The icon a plugin's `icon` string stands for, or null if there is none or it's
 * neither form. `fileUrl` turns a path inside the plugin's folder into a URL.
 */
export function resolveIcon(icon: unknown, fileUrl: (path: string) => string): Icon | null {
  if (typeof icon !== 'string' || !icon.trim()) return null
  if (PATH_DATA.test(icon)) return { path: icon }
  const value = icon.trim()
  if (value.startsWith('data:image/svg+xml')) return { url: value }
  if (!/\.svg$/i.test(value)) return null
  return { url: IS_URL.test(value) ? value : fileUrl(value) }
}

/** What stands in for a missing icon: the title's first letter (or emoji). */
export const iconLetter = (title: string) => ([...title.trim()][0] ?? '?').toUpperCase()
