// End-to-end check of Milestone 4 (Claude edits files, with review) in the real Tauri
// window, over CDP. Uses your real Claude Code login: a few Claude turns, roughly
// $0.30-0.60 of usage. Launch the app as described in e2e/chat.e2e.ts, then:
//   bun e2e/review.e2e.ts
//
// Covers: the chat-first layout, the selection popup / Ctrl+L / right-click menu adding
// a reference to the composer, Claude's edit showing as a diff with per-chunk
// Accept/Reject (checked on disk), a permission card for a shell command, and
// rejecting a file Claude created (deleted from disk).

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    await sleep(150)
  }
  throw new Error('timed out waiting for: ' + label)
}
const store = (name: string) => `window.__tinkr.pinia._s.get('${name}')`
const chat = store('chat')
const review = store('review')
const key = async (key: string, code: string, vk: number, modifiers = 0) => {
  for (const type of ['keyDown', 'keyUp'] as const)
    await cdp.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, modifiers })
}
const CTRL = 2
const SHIFT = 8
/** Type into the chat box and press Enter. */
async function sendChat(text: string) {
  await js(`document.querySelector('textarea[aria-label=Message]').focus()`)
  await cdp.send('Input.insertText', { text })
  await key('Enter', 'Enter', 13)
  await until('turn started', `${chat}.busy`, 5000)
}
const turnDone = (label: string) => until(label, `!${chat}.busy`, 180_000)
const lastTurnError = () => js<string | null>(`${chat}.messages.filter(m => m.role === 'error').at(-1)?.text ?? null`)

// A throwaway project with one file that has two separate places to change.
const dir = mkdtempSync(join(tmpdir(), 'tinkr-review-'))
mkdirSync(join(dir, 'src'))
const mathPath = join(dir, 'src', 'math.ts')
const original = `export function add(a: number, b: number) {
  return a + b
}

// A few unrelated lines, so the two changes are separate chunks.
export const version = 1
export const label = 'math'
export const enabled = true

export function greet(name: string) {
  return 'Hello ' + name
}
`
writeFileSync(mathPath, original)

try {
  // Start from the default layout (the sidebar toggle is remembered between runs).
  await js(`localStorage.removeItem('tinkr.sidebarOpen'); location.reload()`)
  await sleep(500)
  await until('app loaded', `typeof window.__tinkrOpenFolder === 'function'`, 30_000)
  await js(`window.__tinkrOpenFolder(${JSON.stringify(dir)})`)
  await until('chat ready', `${chat}.canSend && ${store('workspace')}.root !== null`, 60_000)
  await until('tree loaded', `document.querySelectorAll('[role=treeitem]').length > 0`)

  // 1. Chat-first layout: the chat is the main area; no editor panel until a file opens.
  // (Run with the "Agent" layout preset active.)
  const layout = await js<{ chat: number; editor: boolean; tree: boolean }>(`({
    chat: document.querySelector('[data-panel=chat]').getBoundingClientRect().width,
    editor: ${store('layout')}.visible.editor,
    tree: !!document.querySelector('[data-panel=files] [role=treeitem]'),
  })`)
  if (layout.editor || !layout.tree || layout.chat < 400) throw new Error('unexpected layout: ' + JSON.stringify(layout))
  pass(`chat-first layout: chat ${Math.round(layout.chat)}px wide, editor closed, file tree shown`)

  // 2. Opening a file opens the editor panel beside the chat.
  await js(`[...document.querySelectorAll('[role=treeitem]')].find(r => r.querySelector('.label').textContent === 'src').click()`)
  await until('src expanded', `[...document.querySelectorAll('[role=treeitem] .label')].some(l => l.textContent === 'math.ts')`)
  await js(`[...document.querySelectorAll('[role=treeitem]')].find(r => r.querySelector('.label').textContent === 'math.ts').click()`)
  await until('editor panel', `!!document.querySelector('[data-testid=editor-panel] .cm-content')?.innerText.includes('greet')`)
  pass('opening a file opens the editor panel beside the chat')

  // 3. Select lines 1-3 with the keyboard: the popup appears; Ctrl+L adds a reference.
  await js(`document.querySelector('[data-testid=editor] .cm-content').focus()`)
  await key('Home', 'Home', 36, CTRL)
  for (let i = 0; i < 3; i++) await key('ArrowDown', 'ArrowDown', 40, SHIFT)
  await until('selection popup', `!!document.querySelector('.cm-ask-claude')`, 3000)
  await key('l', 'KeyL', 76, CTRL)
  await until('reference chip', `${chat}.draftRefs.length === 1`, 3000)
  const chip = await js<string>(`document.querySelector('[data-testid=draft-refs]').innerText`)
  const focused = await js<string>(`document.activeElement?.getAttribute('aria-label') ?? ''`)
  if (!chip.includes('src/math.ts:1-3') || focused !== 'Message') throw new Error(`chip "${chip}", focus "${focused}"`)
  pass('selecting code shows the popup; Ctrl+L adds "src/math.ts:1-3" and focuses the chat box')

  // 4. Right-click menu: "Request changes" turns the same reference into a change request.
  await js(`(() => {
    const line = document.querySelector('[data-testid=editor] .cm-line')
    const r = line.getBoundingClientRect()
    line.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 5 }))
  })()`)
  await until('context menu', `!!document.querySelector('[role=menu]')`, 3000)
  const items = await js<string[]>(`[...document.querySelectorAll('[role=menuitem]')].map(b => b.innerText.split('\\n')[0])`)
  console.log('  menu:', items.join(' | '))
  await js(`[...document.querySelectorAll('[role=menuitem]')].find(b => b.innerText.startsWith('Request changes')).click()`)
  await until('change chip', `${chat}.draftRefs.length === 1 && ${chat}.draftRefs[0].purpose === 'change'`, 3000)
  pass('right-click menu offers Ask Claude / Request changes and adds a change request')

  // 5. Claude edits the file: the diff shows inline, the change list shows it.
  await sendChat(
    'Make exactly two edits to src/math.ts with the Edit tool: rename the function `add` to `sum`, ' +
      'and change greet to return a template literal (`Hello ${name}`). Do not change anything else and do not run commands.',
  )
  await turnDone('edit turn')
  const err = await lastTurnError()
  if (err) throw new Error('turn failed: ' + err)
  const tools = await js<string[]>(`${chat}.messages.filter(m => m.role === 'tool').map(m => m.tool.name + ' ' + m.tool.summary)`)
  console.log('  tools:', tools.join(', '))
  if (!tools.some((t) => t.startsWith('Edit src/math.ts') || t.startsWith('Write src/math.ts'))) throw new Error('expected an edit of src/math.ts')
  await until('under review', `${review}.count === 1`, 5000)
  await until('inline diff', `document.querySelectorAll('[data-testid=editor] .cm-deletedChunk').length >= 2`, 5000)
  const disk = readFileSync(mathPath, 'utf8')
  if (!disk.includes('function sum') || !disk.includes('`Hello ${name}`')) throw new Error('unexpected file after edit:\n' + disk)
  const bar = await js<string>(`document.querySelector('[data-testid=changes]').innerText`)
  console.log('  changes bar:', bar.replace(/\s+/g, ' ').trim())
  pass('Claude\'s edit shows as an inline diff with two chunks, listed above the chat box')

  // 6. Reject the first chunk (the rename), accept the second (the template literal).
  await js(`document.querySelector('[data-testid=editor] .cm-deletedChunk button[name=reject]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
  const t0 = Date.now()
  while (!readFileSync(mathPath, 'utf8').includes('function add')) {
    if (Date.now() - t0 > 5000) throw new Error('rejected chunk was not written to disk')
    await sleep(100)
  }
  await until('one chunk left', `document.querySelectorAll('[data-testid=editor] .cm-deletedChunk').length === 1`, 3000)
  await js(`document.querySelector('[data-testid=editor] .cm-deletedChunk button[name=accept]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
  await until('review done', `${review}.count === 0`, 3000)
  const after = readFileSync(mathPath, 'utf8')
  if (!after.includes('function add') || !after.includes('`Hello ${name}`') || after.includes('function sum')) throw new Error('unexpected file:\n' + after)
  pass('rejecting a chunk restores it on disk; accepting the other keeps it; nothing left to review')

  // 7. A shell command that changes something asks first; Allow lets it run.
  await sendChat('Run exactly this shell command with the Bash tool and nothing else: mkdir made-by-claude')
  await until('permission card', `${chat}.pendingPermissions === 1`, 120_000)
  const card = await js<string>(`document.querySelector('[data-testid=permission]').innerText`)
  console.log('  card:', card.replace(/\s+/g, ' ').trim())
  if (!card.includes('mkdir made-by-claude')) throw new Error('card should show the command')
  await js(`[...document.querySelectorAll('[data-testid=permission] button')].find(b => b.innerText === 'Allow').click()`)
  await turnDone('mkdir turn')
  if (!existsSync(join(dir, 'made-by-claude'))) throw new Error('the allowed command did not run')
  pass('a shell command shows a permission card; Allow runs it')

  // 8. A file Claude creates is marked "new"; rejecting it deletes it.
  await sendChat('Create a new file notes.md in the project root containing the single line: hello. Use the Write tool. Do nothing else.')
  await turnDone('create turn')
  await until('new file under review', `${review}.files.some(f => f.relPath === 'notes.md' && f.baseline === null)`, 5000)
  const notesPath = join(dir, 'notes.md')
  if (!existsSync(notesPath)) throw new Error('notes.md was not created')
  await js(`document.querySelector('[data-testid=changes] li[data-path$="notes.md"] button[aria-label^=Reject]').click()`)
  await until('review empty', `${review}.count === 0`, 5000)
  if (existsSync(notesPath)) throw new Error('rejecting a created file should delete it')
  pass('a created file is reviewed as "new", and rejecting it deletes it')

  const cost = await js<number>(`${chat}.messages.reduce((s, m) => s + (m.done?.costUsd ?? 0), 0)`)
  console.log(`\n${results.length} checks passed. Estimated cost: $${cost.toFixed(2)}`)
} finally {
  // Leave no trace in Tinkr: the check's chats, its folder (else it reopens on next launch).
  await deleteTestChats(js, { folder: dir }).catch(() => {})
  await js(`${store('editor')}.closeAll(); ${store('workspace')}.closeFolder()`).catch(() => {})
  cdp.close()
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Windows can keep a fresh folder locked for a while (see SPEC.md); not a failure.
  }
}
