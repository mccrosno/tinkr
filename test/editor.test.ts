import { beforeEach, describe, expect, test } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'
import { MAX_EDITABLE_BYTES, useEditor } from '../src/stores/editor'
import { useWorkspace } from '../src/stores/workspace'
import { FakeFs, FakeHost } from './fakeFs'

let fs: FakeFs
let editor: ReturnType<typeof useEditor>

beforeEach(async () => {
  setActivePinia(createPinia())
  fs = new FakeFs({ '/p/a.ts': 'const a = 1\n', '/p/b.md': '# B\n', '/p/img.png': 'PNG\u0000\u0001', '/p/big.log': 'x'.repeat(MAX_EDITABLE_BYTES + 1) })
  const ws = useWorkspace()
  ws.configure({ fs, host: new FakeHost(fs) })
  await ws.openFolder('/p')
  ws.onFilesChanged((paths) => useEditor().onDiskChange(paths))
  editor = useEditor()
})

const tick = async () => {
  for (let i = 0; i < 5; i++) await Bun.sleep(0)
}

describe('editor store', () => {
  test('opening a file adds and activates a tab; opening again reuses it', async () => {
    await editor.open('/p/a.ts')
    await editor.open('/p/b.md')
    await editor.open('/p/a.ts')
    expect(editor.tabs.map((t) => t.name)).toEqual(['a.ts', 'b.md'])
    expect(editor.active?.name).toBe('a.ts')
    expect(editor.active?.language).toBe('typescript')
  })

  test('edits mark the tab dirty; saving writes and clears it', async () => {
    await editor.open('/p/a.ts')
    editor.updateText('/p/a.ts', 'const a = 2\n')
    expect(editor.dirtyCount).toBe(1)
    expect(await editor.save()).toBe(true)
    expect(fs.files.get('/p/a.ts')).toBe('const a = 2\n')
    expect(editor.dirtyCount).toBe(0)
  })

  test('our own save coming back from the watcher changes nothing', async () => {
    await editor.open('/p/a.ts')
    editor.updateText('/p/a.ts', 'mine')
    await editor.save()
    const revision = editor.active!.revision
    fs.externalWrite('/p/a.ts', 'mine')
    await tick()
    expect(editor.active!.revision).toBe(revision)
    expect(editor.active!.conflict).toBe(false)
  })

  test('a clean tab reloads when the file changes on disk', async () => {
    await editor.open('/p/a.ts')
    fs.externalWrite('/p/a.ts', 'changed elsewhere')
    await tick()
    expect(editor.active!.text).toBe('changed elsewhere')
    expect(editor.active!.revision).toBe(1)
    expect(editor.dirtyCount).toBe(0)
  })

  test('a dirty tab is flagged instead of overwritten, and the user picks', async () => {
    await editor.open('/p/a.ts')
    editor.updateText('/p/a.ts', 'my edit')
    fs.externalWrite('/p/a.ts', 'their edit')
    await tick()
    expect(editor.active!.text).toBe('my edit')
    expect(editor.active!.conflict).toBe(true)

    editor.keepMine('/p/a.ts')
    expect(editor.active!.conflict).toBe(false)
    expect(editor.active!.text).toBe('my edit')

    fs.externalWrite('/p/a.ts', 'their second edit')
    await tick()
    await editor.reloadFromDisk('/p/a.ts')
    expect(editor.active!.text).toBe('their second edit')
    expect(editor.dirtyCount).toBe(0)
  })

  test('binary and very large files open as a notice, not in the editor', async () => {
    expect((await editor.open('/p/img.png'))?.unsupported).toMatch(/binary/)
    expect((await editor.open('/p/big.log'))?.unsupported).toMatch(/MB/)
    expect(await editor.save('/p/img.png')).toBe(false)
  })

  test('closing a dirty tab needs force; closing activates a neighbour', async () => {
    await editor.open('/p/a.ts')
    await editor.open('/p/b.md')
    editor.updateText('/p/b.md', 'changed')
    expect(editor.close('/p/b.md')).toBe(false)
    expect(editor.close('/p/b.md', true)).toBe(true)
    expect(editor.active?.name).toBe('a.ts')
  })

  test('a missing file reports an error instead of throwing', async () => {
    expect(await editor.open('/p/missing.ts')).toBeNull()
    expect(editor.lastError).toMatch(/missing\.ts/)
  })
})
