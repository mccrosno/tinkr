// End-to-end check of Milestone 2 (file tree + editor) in the real Tauri window, over CDP.
// Keystrokes are sent to the page through DevTools, not the OS, so your own
// mouse/keyboard aren't touched. Launch the app as described in e2e/chat.e2e.ts, then:
//   bun e2e/editor.e2e.ts

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, deleteTestChats, sleep } from './cdp'

const cdp = await connect(Number(process.argv[2] ?? 9222))
const js = <T = unknown>(expr: string) => cdp.evaluate<T>(expr)
const results: string[] = []
const pass = (s: string) => (results.push('PASS ' + s), console.log('PASS', s))
async function until(label: string, expr: string, timeoutMs = 15_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await js<boolean>(expr)) return
    await sleep(100)
  }
  throw new Error('timed out waiting for: ' + label)
}
const store = (name: string) => `window.__tinkr.pinia._s.get('${name}')`
const editorText = () => js<string>(`document.querySelector('[data-testid=editor] .cm-content')?.innerText ?? ''`)
const clickRow = (name: string) =>
  js(`[...document.querySelectorAll('[role=treeitem]')].find(li => li.querySelector('.label').textContent === ${JSON.stringify(name)}).click()`)
const key = async (key: string, code: string, vk: number, modifiers = 0) => {
  for (const type of ['keyDown', 'keyUp'])
    await cdp.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, modifiers })
}

// A throwaway project.
const dir = mkdtempSync(join(tmpdir(), 'tinkr-e2e-'))
mkdirSync(join(dir, 'src'))
mkdirSync(join(dir, 'node_modules', 'junk'), { recursive: true })
writeFileSync(join(dir, 'src', 'main.ts'), 'export const answer: number = 41\n')
writeFileSync(join(dir, 'README.md'), '# Demo\n')
const mainPath = join(dir, 'src', 'main.ts')

try {
  await js(`location.reload()`)
  await sleep(1500)

  // 1. Open the folder: tree lists it, noise folders hidden.
  await js(`window.__tinkrOpenFolder(${JSON.stringify(dir)})`)
  await until('tree', `document.querySelectorAll('[role=treeitem]').length === 2`)
  const rows = await js<string[]>(`[...document.querySelectorAll('[role=treeitem] .label')].map(l => l.textContent)`)
  console.log('  tree:', rows.join(', '))
  if (rows.join() !== 'src,README.md') throw new Error('unexpected tree')
  pass('open folder shows the tree, folders first, node_modules hidden')

  // 2. Expand a folder and open a file: tab + highlighted code.
  await clickRow('src')
  await until('expand', `document.querySelectorAll('[role=treeitem]').length === 3`)
  await clickRow('main.ts')
  await until('editor', `(document.querySelector('[data-testid=editor] .cm-content')?.innerText ?? '').includes('answer')`)
  await until('highlighting', `document.querySelectorAll('[data-testid=editor] .cm-line span').length > 2`, 5000)
  const colored = await js<number>(`new Set([...document.querySelectorAll('[data-testid=editor] .cm-line span')].map(s => getComputedStyle(s).color)).size`)
  console.log('  tab:', await js(`document.querySelector('[role=tab][aria-selected=true] .name').textContent`), '| distinct token colors:', colored)
  if (colored < 3) throw new Error('expected TypeScript syntax highlighting')
  pass('clicking a file opens a tab with syntax highlighting')

  // 3. Type and save with Ctrl+S.
  await js(`document.querySelector('[data-testid=editor] .cm-content').focus()`)
  await key('End', 'End', 35, 2) // Ctrl+End: end of document
  await cdp.send('Input.insertText', { text: 'export const extra = true\n' })
  await until('dirty dot', `!!document.querySelector('[role=tab][aria-selected=true] .dirty')`)
  await key('s', 'KeyS', 83, 2) // Ctrl+S
  await until('saved', `!document.querySelector('[role=tab][aria-selected=true] .dirty')`)
  const onDisk = readFileSync(mainPath, 'utf8')
  console.log('  on disk:', JSON.stringify(onDisk))
  if (!onDisk.includes('export const extra = true')) throw new Error('save did not reach disk')
  pass('typing marks the tab unsaved; Ctrl+S writes the file')

  // 4. Another program changes the file: a clean tab reloads.
  writeFileSync(mainPath, 'export const answer: number = 42 // changed outside\n')
  await until('reload', `(document.querySelector('[data-testid=editor] .cm-content')?.innerText ?? '').includes('changed outside')`)
  pass('external change reloads a clean tab')

  // 5. External change while there are unsaved edits: conflict banner, user picks.
  await js(`document.querySelector('[data-testid=editor] .cm-content').focus()`)
  await cdp.send('Input.insertText', { text: '// my unsaved edit\n' })
  await until('dirty', `!!document.querySelector('[role=tab][aria-selected=true] .dirty')`)
  writeFileSync(mainPath, 'export const answer = 43 // second outside change\n')
  await until('conflict banner', `!!document.querySelector('.banner')`)
  if (!(await editorText()).includes('my unsaved edit')) throw new Error('unsaved edit was overwritten')
  await js(`[...document.querySelectorAll('.banner button')].find(b => b.textContent.includes('disk')).click()`)
  await until('took disk version', `(document.querySelector('[data-testid=editor] .cm-content')?.innerText ?? '').includes('second outside change')`)
  pass('external change with unsaved edits asks instead of overwriting')

  // 6. New files appear in the tree.
  writeFileSync(join(dir, 'src', 'added.ts'), '// new\n')
  await until('new file in tree', `[...document.querySelectorAll('[role=treeitem] .label')].some(l => l.textContent === 'added.ts')`)
  pass('files created on disk appear in the tree')

  // 7. Chat runs in the project folder.
  await until('chat ready', `${store('chat')}.canSend`, 60_000)
  await js(`${store('chat')}.send('What is your current working directory? Reply with only the absolute path.')`)
  await until('reply', `!${store('chat')}.busy && ${store('chat')}.messages.some(m => m.role === 'assistant' && m.done)`, 90_000)
  const reply = await js<string>(`${store('chat')}.messages.findLast(m => m.role === 'assistant').text`)
  console.log('  cwd reply:', JSON.stringify(reply.trim()))
  const folder = dir.split(/[\\/]/).pop()!.toLowerCase()
  if (!reply.toLowerCase().includes(folder)) throw new Error('chat is not running in the project folder')
  pass('chat runs in the open project folder')

  console.log('\n' + results.join('\n'))
} finally {
  await deleteTestChats(js, { folder: dir }).catch(() => {})
  await js(`${store('editor')}.closeAll(); ${store('workspace')}.closeFolder()`).catch(() => {})
  cdp.close()
  // Best effort: on Windows, Search/Defender can keep new files locked for a while after
  // the test (the folder became deletable a few minutes later). Not a Tinkr leak.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  } catch (e) {
    console.warn(`  (could not delete ${dir} yet: ${(e as NodeJS.ErrnoException).code}; remove it later)`)
  }
}
process.exit(0)
