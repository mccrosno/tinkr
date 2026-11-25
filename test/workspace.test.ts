import { beforeEach, describe, expect, test } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkspace } from '../src/stores/workspace'
import { baseName, joinPath, parentOf, samePath } from '../src/workspace/fs'
import { flattenTree, sortEntries } from '../src/workspace/tree'
import { languageOf } from '../src/editor/languages'
import { FakeFs, FakeHost } from './fakeFs'

describe('path helpers', () => {
  test('join keeps the root separator', () => {
    expect(joinPath('C:\\proj', 'a.ts')).toBe('C:\\proj\\a.ts')
    expect(joinPath('/home/me/proj', 'a.ts')).toBe('/home/me/proj/a.ts')
    expect(joinPath('/home/me/proj/', 'a.ts')).toBe('/home/me/proj/a.ts')
  })
  test('parent and base name', () => {
    expect(parentOf('C:\\proj\\src\\a.ts')).toBe('C:\\proj\\src')
    expect(baseName('/p/src/a.ts')).toBe('a.ts')
  })
  test('Windows paths compare case-insensitively, either slash', () => {
    expect(samePath('C:\\Proj\\A.ts', 'c:/proj/a.ts')).toBe(true)
    expect(samePath('/p/A.ts', '/p/a.ts')).toBe(false)
  })
})

describe('tree helpers', () => {
  const e = (name: string, isDir = false) => ({ name, path: `/r/${name}`, isDir })
  test('folders first, natural order, noise hidden', () => {
    const sorted = sortEntries([e('b.ts'), e('file10.ts'), e('src', true), e('node_modules', true), e('file2.ts'), e('.git', true), e('A.md')])
    expect(sorted.map((x) => x.name)).toEqual(['src', 'A.md', 'b.ts', 'file2.ts', 'file10.ts'])
  })
  test('flatten walks only expanded folders', () => {
    const children = new Map([
      ['/r', [e('src', true), e('x.ts')]],
      ['/r/src', [{ name: 'a.ts', path: '/r/src/a.ts', isDir: false }]],
    ])
    expect(flattenTree('/r', children, new Set()).map((r) => r.entry.name)).toEqual(['src', 'x.ts'])
    const open = flattenTree('/r', children, new Set(['/r/src']))
    expect(open.map((r) => [r.entry.name, r.depth])).toEqual([['src', 0], ['a.ts', 1], ['x.ts', 0]])
  })
  test('language detection', () => {
    expect(languageOf('App.vue')).toBe('html')
    expect(languageOf('main.TS')).toBe('typescript')
    expect(languageOf('lib.rs')).toBe('rust')
    expect(languageOf('LICENSE')).toBe('text')
  })
})

describe('workspace store', () => {
  let fs: FakeFs
  let ws: ReturnType<typeof useWorkspace>
  beforeEach(() => {
    setActivePinia(createPinia())
    fs = new FakeFs({ '/proj/src/main.ts': 'x', '/proj/README.md': '# hi', '/proj/node_modules/pkg/i.js': '', '/other': null })
    ws = useWorkspace()
    ws.configure({ fs, host: new FakeHost(fs) })
  })

  test('opens a folder and lists its top level', async () => {
    await ws.openFolder('/proj')
    expect(ws.name).toBe('proj')
    expect(ws.rows.map((r) => r.entry.name)).toEqual(['src', 'README.md'])
  })

  test('expanding a folder loads it lazily', async () => {
    await ws.openFolder('/proj')
    expect(ws.children.has('/proj/src')).toBe(false)
    await ws.toggle('/proj/src')
    expect(ws.rows.map((r) => r.entry.name)).toEqual(['src', 'main.ts', 'README.md'])
    await ws.toggle('/proj/src')
    expect(ws.rows).toHaveLength(2)
  })

  test('a new file on disk shows up in a loaded folder and is reported', async () => {
    await ws.openFolder('/proj')
    const seen: string[][] = []
    ws.onFilesChanged((p) => seen.push(p))
    fs.externalWrite('/proj/new.ts', 'y')
    await Bun.sleep(0)
    await Bun.sleep(0)
    expect(ws.rows.map((r) => r.entry.name)).toContain('new.ts')
    expect(seen).toEqual([['/proj/new.ts']])
  })

  test('remembers the last project and reopens it on start', async () => {
    const host = new FakeHost(fs)
    host.lastProject = '/proj'
    ws.configure({ host })
    await ws.init()
    expect(ws.root).toBe('/proj')
  })

  test('opening something that is not a folder reports an error and keeps the old one', async () => {
    await ws.openFolder('/proj')
    await ws.openFolder('/nope')
    expect(ws.root).toBe('/proj')
    expect(ws.error).toMatch(/not a folder/)
  })
})
