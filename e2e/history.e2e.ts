// End-to-end check of Milestone 5 (Desktop-style chat) in the real Tauri window, over
// CDP. Uses your real Claude Code login: three short turns on Haiku at low effort, about
// $0.05. Launch the app as described in e2e/chat.e2e.ts, then:
//   bun e2e/history.e2e.ts
//
// Covers: the model and effort pickers (filled from Claude Code's list, sent with the
// turn), attaching an image by dropping it and a text file through the file picker
// (Claude reads both), the chat appearing in the sidebar's history list, reopening it
// after "New chat" (messages and the image come back) and continuing it, renaming it,
// deleting it, and the "All folders" list (opening a past chat of another folder, read-only).
// Runs as a chat without a folder (the home folder); it closes any open folder first.

import { connect, sleep } from './cdp'

const cdp = await connect(Number(process.argv[2] ?? 9222))
const js = <T = unknown>(expr: string) => cdp.evaluate<T>(expr)
const chat = `window.__tinkr.pinia._s.get('chat')`
const ws = `window.__tinkr.pinia._s.get('workspace')`
const results: string[] = []
const pass = (s: string) => (results.push('PASS ' + s), console.log('PASS', s))
async function until(label: string, expr: string, timeoutMs = 90_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await js<boolean>(expr)) return
    await sleep(150)
  }
  throw new Error('timed out waiting for: ' + label)
}
/** Type into the composer (an input event, as a user would) and click Send. */
async function sendViaUi(message: string) {
  await js(`(() => { const t = document.querySelector('textarea[aria-label=Message]'); t.value = ${JSON.stringify(message)}; t.dispatchEvent(new Event('input')); })()`)
  await sleep(50)
  await js(`[...document.querySelectorAll('.composer button')].find(b => b.textContent.trim() === 'Send').click()`)
}
const lastReply = () => js<string>(`[...document.querySelectorAll('.msg.assistant')].at(-1)?.textContent ?? ''`)
/** Set a <select> the way a user would: pick the value, fire `change`. */
const pick = (label: string, value: string) =>
  js(`(() => { const s = document.querySelector('select[aria-label=${label}]'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change')); })()`)

// A 16x16 solid blue PNG, built in the page (canvas), so no file is needed on disk.
const MAKE_PNG = `await new Promise((r) => { const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); g.fillStyle = '#0000ff'; g.fillRect(0, 0, 16, 16); c.toBlob(r, 'image/png') })`

// Start clean: no folder (these are chats without one), a reload, the Chats tab showing.
await js(`location.reload()`)
await sleep(1500)
await until('agent ready', `${chat}.cli?.state === 'ok' && ${chat}.models.length > 0`)
if (await js<boolean>(`!!${ws}.root`)) {
  await js(`${ws}.closeFolder()`)
  await until('folder closed', `${chat}.projectRoot === null`)
}
await js(`[...document.querySelectorAll('.tabs [role=tab]')].find(b => b.textContent === 'Chats')?.click()`)
const before = await js<string[]>(`${chat}.chats.map(c => c.sessionId)`)

// 1. Pickers: models from Claude Code, effort levels for the picked model.
const models = await js<string[]>(`[...document.querySelectorAll('select[aria-label=Model] option')].map(o => o.value)`)
if (!models.includes('default') || !models.includes('haiku')) throw new Error('model list: ' + models.join(', '))
const savedModel = await js<string>(`${chat}.model`)
const savedEffort = await js<string | null>(`${chat}.effort`)
await pick('Model', 'haiku')
await until('effort picker', `!!document.querySelector('select[aria-label=Effort]')`, 2000)
await pick('Effort', 'low')
if ((await js<string>(`${chat}.effectiveEffort`)) !== 'low') throw new Error('effort pick did not stick')
pass(`model picker lists ${models.length} models; Haiku + low effort picked`)

// 2. Attach an image by dropping it on the chat, and a text file through the picker.
await js(`(async () => {
  const png = ${MAKE_PNG}
  const dt = new DataTransfer()
  dt.items.add(new File([png], 'blue.png', { type: 'image/png' }))
  const target = document.querySelector('.chat')
  target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
  target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
})()`)
await js(`(() => {
  const input = document.querySelector('[data-testid=file-picker]')
  const dt = new DataTransfer()
  dt.items.add(new File(['The password is marmalade.'], 'secret.txt', { type: 'text/plain' }))
  input.files = dt.files
  input.dispatchEvent(new Event('change'))
})()`)
await until('two attachments', `document.querySelectorAll('[data-testid=draft-attachments] [data-testid=attachment]').length === 2`, 3000)
if (!(await js<boolean>(`!!document.querySelector('[data-testid=draft-attachments] img')`))) throw new Error('no image thumbnail')
pass('drop and file picker attach an image (with a thumbnail) and a text file')

// 3. Send: Claude sees both, and runs on the picked model.
await sendViaUi('What color is the image, and what is the password in the text file? Answer as: color, password.')
await until('reply', `!${chat}.busy && ${chat}.messages.some(m => m.done)`)
const reply1 = (await lastReply()).toLowerCase()
if (!reply1.includes('blue') || !reply1.includes('marmalade')) throw new Error('reply missed an attachment: ' + reply1)
const meta = await js<string>(`[...document.querySelectorAll('.msg.assistant .meta')].at(-1)?.textContent ?? ''`)
if (!/haiku/i.test(meta)) throw new Error('summary line does not name the model: ' + meta)
if (await js<number>(`document.querySelectorAll('.msg.user [data-testid=attachment]').length`) !== 2) throw new Error('sent message lost its attachments')
console.log('  reply:', reply1.trim().slice(0, 80), '|', meta)
pass('Claude reads the dropped image and the picked text file, on Haiku')

// 4. The chat is listed in the sidebar, with a title.
const sessionId = await js<string>(`${chat}.sessionId`)
await until('listed', `!!document.querySelector('.chats li[data-session="${sessionId}"]')`, 10_000)
const title = await js<string>(`document.querySelector('.chats li[data-session="${sessionId}"] .name').textContent`)
// Claude Code usually names the chat itself (e.g. "Image color and file password");
// until it has, the first prompt stands in.
if (!title.trim() || title === 'Untitled chat') throw new Error('no title: ' + title)
if (!(await js<boolean>(`document.querySelector('.chats li[data-session="${sessionId}"]').classList.contains('active')`))) throw new Error('not marked active')
pass(`the chat appears in the history list as "${title.slice(0, 50)}"`)

// 5. New chat, then reopen it from the list: messages and the image come back, and it continues.
await js(`document.querySelector('.chats .header button').click()`) // "New"
await until('new chat', `${chat}.messages.length === 0 && ${chat}.sessionId === null`, 2000)
await js(`document.querySelector('.chats li[data-session="${sessionId}"] .open').click()`)
await until('reopened', `${chat}.sessionId === '${sessionId}' && ${chat}.messages.length >= 2`, 15_000)
if (!(await js<boolean>(`!!document.querySelector('.msg.user img')`))) throw new Error('reopened chat lost the image')
if (!(await lastReply()).toLowerCase().includes('marmalade')) throw new Error('reopened chat lost the reply')
await sendViaUi('Repeat only the password, nothing else.')
await until('follow-up', `!${chat}.busy && ${chat}.messages.filter(m => m.done).length >= 1 && ${chat}.messages.at(-1).done`)
if (!(await lastReply()).toLowerCase().includes('marmalade')) throw new Error('follow-up forgot the chat: ' + (await lastReply()))
if ((await js<string>(`${chat}.sessionId`)) !== sessionId) throw new Error('follow-up started a different session')
pass('a reopened chat shows its messages and image, and continues the same conversation')

// 6. Rename from the list (double-click the title, type, Enter).
await js(`document.querySelector('.chats li[data-session="${sessionId}"] .open').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
await until('rename box', `!!document.querySelector('.chats input.rename')`, 2000)
await js(`(() => { const i = document.querySelector('.chats input.rename'); i.value = 'E2E blue square'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })()`)
await until('renamed', `document.querySelector('.chats li[data-session="${sessionId}"] .name')?.textContent === 'E2E blue square'`, 10_000)
pass('renaming a chat from the list')

// 7. Delete (the store call behind the row's × button; its confirmation is a native dialog).
await js(`${chat}.deleteChat('${sessionId}')`)
await until('deleted', `!${chat}.chats.some(c => c.sessionId === '${sessionId}') && ${chat}.sessionId === null`, 10_000)
const after = await js<string[]>(`${chat}.chats.map(c => c.sessionId)`)
if (after.length !== before.length) throw new Error(`other chats changed: ${before.length} before, ${after.length} after`)
pass('deleting the open chat removes it and starts a new one')

// 8. All folders: chats from every folder and tool, and opening one from another folder
//    switches Tinkr to that folder. (Opens a past chat read-only; nothing is sent.)
await js(`document.querySelector('[data-testid=all-folders]').click()`)
await until('all folders', `${chat}.allFolders && ${chat}.chats.some(c => c.folder !== null) && !!document.querySelector('.chats li .folder')`, 30_000)
const folders = await js<number>(`new Set(${chat}.chats.map(c => c.folder)).size`)
const total = await js<number>(`${chat}.chats.length`)
const labelled = await js<boolean>(`!!document.querySelector('.chats li .folder')`)
if (!labelled) throw new Error('rows do not show their folder')
// As JSON: CDP can't copy a Vue reactive proxy by value (it arrives as {}).
const elsewhere = JSON.parse(await js<string>(`JSON.stringify(${chat}.chats.find(c => c.folder !== null))`)) as { sessionId: string; folder: string }
await until('row rendered', `!!document.querySelector('.chats li[data-session="${elsewhere.sessionId}"] .open')`, 5000)
await js(`document.querySelector('.chats li[data-session="${elsewhere.sessionId}"] .open').click()`)
await until('switched folder', `!!${ws}.root && ${chat}.sessionId === '${elsewhere.sessionId}'`, 30_000)
const shown = await js<number>(`${chat}.messages.length`)
if (!shown) throw new Error("the other folder's chat loaded empty")
console.log(`  ${total} chats in ${folders} folders; opened one from ${elsewhere.folder} (${shown} rows)`)
pass('all folders lists every folder; a chat of another folder opens that folder and the chat')
await js(`${ws}.closeFolder()`)
await until('folder closed again', `${chat}.projectRoot === null`, 5000)
await js(`document.querySelector('[data-testid=all-folders]').click()`)
await until('one folder again', `!${chat}.allFolders`, 2000)

// Put the pickers back the way they were.
await js(`${chat}.setModel(${JSON.stringify(savedModel)}); ${chat}.setEffort(${JSON.stringify(savedEffort)})`)

console.log(`\n${results.length} checks passed`)
cdp.close()
