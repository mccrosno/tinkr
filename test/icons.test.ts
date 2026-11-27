import { describe, expect, test } from 'bun:test'
import { iconLetter, resolveIcon } from '../src/plugins/icons'

const url = (p: string) => `plugin/${p}`

describe('icons', () => {
  test('path data, in either case and with a leading space', () => {
    expect(resolveIcon('M4 6h16M4 12h16', url)).toEqual({ path: 'M4 6h16M4 12h16' })
    expect(resolveIcon(' m-1.5,2 l3 3', url)).toEqual({ path: ' m-1.5,2 l3 3' })
  })

  test(".svg files: relative ones are the plugin's, URLs are kept", () => {
    expect(resolveIcon('icon.svg', url)).toEqual({ url: 'plugin/icon.svg' })
    // A file name that starts like path data is still a file.
    expect(resolveIcon('menu.SVG', url)).toEqual({ url: 'plugin/menu.SVG' })
    expect(resolveIcon('/src/assets/a.svg', url)).toEqual({ url: '/src/assets/a.svg' })
    expect(resolveIcon('data:image/svg+xml;base64,AAAA', url)).toEqual({ url: 'data:image/svg+xml;base64,AAAA' })
  })

  test('nothing, or something else, is no icon', () => {
    for (const v of [undefined, '', '  ', 'picture.png', '<svg></svg>', 'Mail', 42]) expect(resolveIcon(v, url)).toBeNull()
  })

  test('the stand-in letter', () => {
    expect(iconLetter('  word count')).toBe('W')
    expect(iconLetter('🎨 Paint')).toBe('🎨')
    expect(iconLetter('')).toBe('?')
  })
})
