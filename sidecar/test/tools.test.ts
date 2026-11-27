import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decide, describeTool, editTarget, forThisChat, isInside, readBaseline } from '../src/tools'

describe('isInside', () => {
  test('posix paths', () => {
    expect(isInside('/p/src/a.ts', '/p', false)).toBe(true)
    expect(isInside('/p', '/p', false)).toBe(true)
    expect(isInside('/p2/a.ts', '/p', false)).toBe(false) // a sibling with the same prefix
    expect(isInside('/p/../etc/passwd', '/p', false)).toBe(false)
  })
  test('windows paths ignore case', () => {
    if (process.platform !== 'win32') return // path.resolve only understands C:\ on Windows
    expect(isInside('C:\\Proj\\src\\a.ts', 'c:\\proj', true)).toBe(true)
    expect(isInside('D:\\proj\\a.ts', 'C:\\proj', true)).toBe(false)
  })
})

describe('decide (permission policy)', () => {
  const root = process.platform === 'win32' ? 'C:\\proj' : '/proj'
  const inside = join(root, 'src', 'a.ts')
  test('edits inside the project are allowed', () => {
    expect(decide('Edit', { file_path: inside }, root)).toEqual({ kind: 'allow' })
    expect(decide('Write', { file_path: inside, content: '' }, root)).toEqual({ kind: 'allow' })
  })
  test('edits outside the project, or with no project, are denied', () => {
    expect(decide('Edit', { file_path: join(root, '..', 'other', 'a.ts') }, root).kind).toBe('deny')
    expect(decide('Write', { file_path: inside }, undefined).kind).toBe('deny')
    expect(decide('Edit', {}, root).kind).toBe('deny') // no path at all
  })
  test('anything else asks the user', () => {
    expect(decide('Bash', { command: 'rm -rf build' }, root)).toEqual({ kind: 'ask' })
    expect(decide('WebFetch', { url: 'https://example.com' }, root)).toEqual({ kind: 'ask' })
  })
})

test('describeTool gives short labels', () => {
  const root = process.platform === 'win32' ? 'C:\\proj' : '/proj'
  expect(describeTool('Edit', { file_path: join(root, 'src', 'a.ts') }, root)).toBe('src/a.ts')
  expect(describeTool('Read', { file_path: join(root, 'README.md') }, root)).toBe('README.md')
  expect(describeTool('Bash', { command: 'npm test\necho done' })).toBe('npm test')
  expect(describeTool('Grep', { pattern: 'TODO' })).toBe('TODO')
  expect(describeTool('Mystery', { x: 1 })).toBe('')
})

test('editTarget reads file_path or notebook_path', () => {
  expect(editTarget('Edit', { file_path: '/a' })).toBe('/a')
  expect(editTarget('NotebookEdit', { notebook_path: '/n.ipynb' })).toBe('/n.ipynb')
  expect(editTarget('Read', { file_path: '/a' })).toBeNull()
})

test('forThisChat keeps suggested rules for the session only', () => {
  const out = forThisChat([{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'mkdir *' }], behavior: 'allow', destination: 'localSettings' }])
  expect(out).toEqual([{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'mkdir *' }], behavior: 'allow', destination: 'session' }])
  expect(forThisChat(undefined)).toEqual([])
})

test('readBaseline: text, missing (null), binary (undefined)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tinkr-baseline-'))
  writeFileSync(join(dir, 'a.txt'), 'hello\n')
  writeFileSync(join(dir, 'b.bin'), 'PNG\u0000')
  expect(await readBaseline(join(dir, 'a.txt'))).toBe('hello\n')
  expect(await readBaseline(join(dir, 'missing.txt'))).toBeNull()
  expect(await readBaseline(join(dir, 'b.bin'))).toBeUndefined()
})
