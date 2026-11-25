import { beforeEach, describe, expect, test } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'
import { EditorState } from '@codemirror/state'
import { lineStats, useReview } from '../src/stores/review'
import { useWorkspace } from '../src/stores/workspace'
import { selectionRef } from '../src/editor/askClaude'
import { formatPrompt, refLabel } from '../src/chat/refs'
import { relativeTo } from '../src/workspace/fs'
import { FakeFs, FakeHost } from './fakeFs'

let fs: FakeFs
let review: ReturnType<typeof useReview>

beforeEach(async () => {
  setActivePinia(createPinia())
  fs = new FakeFs({ '/p/a.ts': 'one\ntwo\nthree\n', '/p/b.ts': 'b\n' })
  const ws = useWorkspace()
  ws.configure({ fs, host: new FakeHost(fs) })
  await ws.openFolder('/p')
  review = useReview()
})

/** Claude edits `path` to `text`, the way the sidecar reports it. */
async function claudeEdits(path: string, text: string, id = 'u1') {
  const before = fs.files.has(path) ? fs.files.get(path)! : null
  await review.onAgentFile({ type: 'fileWillChange', turnId: 't1', toolUseId: id, path, before })
  fs.put(path, text)
  await review.onAgentFile({ type: 'fileChanged', turnId: 't1', toolUseId: id, path })
}

describe('review store', () => {
  test('an edit puts the file under review with line counts, and tells listeners', async () => {
    const changed: string[] = []
    review.onChanged((p) => changed.push(p))
    await claudeEdits('/p/a.ts', 'one\nTWO\nthree\nfour\n')
    expect(review.count).toBe(1)
    const f = review.files[0]
    expect(f.relPath).toBe('a.ts')
    expect(f.baseline).toBe('one\ntwo\nthree\n')
    expect([f.added, f.removed]).toEqual([2, 1])
    expect(changed).toEqual(['/p/a.ts'])
  })

  test('later edits keep the original baseline', async () => {
    await claudeEdits('/p/a.ts', 'one\nTWO\nthree\n', 'u1')
    await claudeEdits('/p/a.ts', 'ONE\nTWO\nthree\n', 'u2')
    expect(review.files[0].baseline).toBe('one\ntwo\nthree\n')
    expect(review.files[0].current).toBe('ONE\nTWO\nthree\n')
  })

  test('an edit that changed nothing (or was denied) leaves nothing to review', async () => {
    await claudeEdits('/p/a.ts', 'one\ntwo\nthree\n')
    expect(review.count).toBe(0)
  })

  test('editing back to the baseline drops the file from review', async () => {
    await claudeEdits('/p/a.ts', 'changed\n')
    review.noteText('/p/a.ts', 'one\ntwo\nthree\n') // the user saved the original text
    expect(review.count).toBe(0)
  })

  test('accepting keeps the change; rejecting writes the baseline back', async () => {
    await claudeEdits('/p/a.ts', 'A\n')
    await claudeEdits('/p/b.ts', 'B\n', 'u2')
    review.accept('/p/a.ts')
    await review.reject('/p/b.ts')
    expect(review.count).toBe(0)
    expect(fs.files.get('/p/a.ts')).toBe('A\n')
    expect(fs.files.get('/p/b.ts')).toBe('b\n')
  })

  test('a file Claude created is "new", and rejecting it deletes it', async () => {
    await claudeEdits('/p/new.ts', 'export {}\n')
    const f = review.files[0]
    expect(f.baseline).toBeNull()
    expect([f.added, f.removed]).toEqual([1, 0])
    await review.reject('/p/new.ts')
    expect(fs.files.has('/p/new.ts')).toBe(false)
  })

  test('accepting part of the changes moves the baseline (chunk accept in the editor)', async () => {
    await claudeEdits('/p/a.ts', 'ONE\ntwo\nTHREE\n')
    review.setBaseline('/p/a.ts', 'ONE\ntwo\nthree\n')
    expect(review.files[0].removed).toBe(1)
    review.setBaseline('/p/a.ts', 'ONE\ntwo\nTHREE\n')
    expect(review.count).toBe(0)
  })

  test('changes on disk refresh files under review', async () => {
    await claudeEdits('/p/a.ts', 'changed\n')
    fs.put('/p/a.ts', 'one\ntwo\nthree\n') // e.g. `git checkout` in the terminal
    await review.onDiskChange(['/p/a.ts'])
    expect(review.count).toBe(0)
  })

  test('reject all and clear', async () => {
    await claudeEdits('/p/a.ts', 'A\n')
    await claudeEdits('/p/b.ts', 'B\n', 'u2')
    await review.rejectAll()
    expect(fs.files.get('/p/a.ts')).toBe('one\ntwo\nthree\n')
    await claudeEdits('/p/a.ts', 'A\n', 'u3')
    review.clear()
    expect(review.count).toBe(0)
  })
})

test('lineStats counts changed lines per chunk (like git)', () => {
  expect(lineStats('a\nb\nc\n', 'a\nB\nc\n')).toEqual({ added: 1, removed: 1 })
  expect(lineStats('a\nb\n', 'a\nb\nc\nd\n')).toEqual({ added: 2, removed: 0 })
  expect(lineStats('a\nb\nc\n', 'a\n')).toEqual({ added: 0, removed: 2 })
  // Without a final newline, appending also changes the old last line (git shows it too).
  expect(lineStats('a\nb', 'a\nb\nc')).toEqual({ added: 2, removed: 1 })
})

describe('selection references', () => {
  const state = (doc: string, anchor: number, head = anchor) => EditorState.create({ doc, selection: { anchor, head } })
  const doc = 'line one\nline two\nline three\n'

  test('a selection within one line', () => {
    const r = selectionRef(state(doc, 9, 13), '/p/a.ts', 'a.ts', 'question')
    expect([r.fromLine, r.toLine, r.text]).toEqual([2, 2, 'line'])
  })

  test('no selection means the cursor line', () => {
    const r = selectionRef(state(doc, 11), '/p/a.ts', 'a.ts', 'change')
    expect([r.fromLine, r.toLine, r.text, r.purpose]).toEqual([2, 2, 'line two', 'change'])
  })

  test('a selection ending at the start of a line leaves that line out', () => {
    const r = selectionRef(state(doc, 0, 18), '/p/a.ts', 'a.ts', 'question') // "line one\nline two\n"
    expect([r.fromLine, r.toLine]).toEqual([1, 2])
    expect(refLabel(r)).toBe('a.ts:1-2')
  })

  test('formatPrompt escapes attribute text', () => {
    const p = formatPrompt('hi', [{ path: '/p/"x".ts', relPath: '"x".ts', fromLine: 1, toLine: 1, text: 'x', purpose: 'question' }])
    expect(p.startsWith('<selection file="&quot;x&quot;.ts" lines="1-1"')).toBe(true)
  })
})

test('relativeTo', () => {
  expect(relativeTo('/p', '/p/src/a.ts')).toBe('src/a.ts')
  expect(relativeTo('/p/', '/p/a.ts')).toBe('a.ts')
  expect(relativeTo('/p', '/p2/a.ts')).toBe('/p2/a.ts')
  expect(relativeTo('C:\\Proj', 'c:\\proj\\src\\a.ts')).toBe('src/a.ts')
  expect(relativeTo(null, '/p/a.ts')).toBe('/p/a.ts')
})
