// End-to-end check of Milestone 6 (docking and layout presets) in the real Tauri window,
// over CDP. No Claude turns, so it's free. Launch the app as described in
// e2e/chat.e2e.ts, then:
//   bun e2e/layout.e2e.ts
//
// Covers: the "Agent" preset (chat in the middle, Chats/Files on the left, editor and
// terminal hidden until needed); opening a folder brings Files to the front; opening a
// file shows the editor beside the chat; switching to "Editor" (Ctrl+Alt+2) moves
// everything without losing the chat draft, the editor's undo history or the
// terminal's screen; hiding and showing a panel keeps its size; a panel sharing a card
// is closed instead of hidden and comes back to it; a card's menu splits and closes
// panels; the rail, "All panels" and collapsing; the empty dock; saving a preset,
// restoring it after a reload, resetting and deleting it. The user's own layouts and
// rail settings are saved first and put back.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, sleep } from './cdp'

const cdp = await connect(Number(process.argv[2] ?? 9222))
const js = <T = unknown>(expr: string) => cdp.evaluate<T>(expr)
const store = (name: string) => `window.__tinkr.pinia._s.get('${name}')`
const layout = store('layout')
const dock = 'window.__tinkrDock'
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
const key = async (key: string, code: string, vk: number, modifiers = 0) => {
  for (const type of ['keyDown', 'keyUp'] as const)
    await cdp.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, modifiers })
}
const ALT = 1
const CTRL = 2
const SHIFT = 8
/** A panel's box on screen, [x, y, width, height], or null if it isn't showing. */
const box = (panel: string) =>
  js<number[] | null>(`(() => { const e = document.querySelector('[data-panel=${panel}]'); if (!e || !e.offsetParent) return null; const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round) })()`)
/** Which panels share a group, e.g. [["chats","files"],["chat"]], visible groups only. */
const groups = () => js<string[][]>(`${dock}.groups.filter(g => g.api.isVisible).map(g => g.panels.map(p => p.id))`)

// The user's layouts, to put back at the end.
const saved = await js<Record<string, string>>(
  `Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('tinkr.layout.')).map(k => [k, localStorage.getItem(k)]))`,
)

const settings = store('settings')
const rail = store('rail')
const savedRail = await js<string>(`JSON.stringify([${settings}.appValue('rail.pins', null), ${settings}.appValue('rail.collapsed', null)])`)
/** Choose an item from the ⋯ menu of the card a panel is on. */
async function panelMenu(panel: string, item: string) {
  await js(`${dock}.getPanel('${panel}').group.element.querySelector('[data-testid=panel-menu]').click()`)
  const find = `[...document.querySelectorAll('.context-menu [role=menuitem]')].find(b => b.textContent.trim() === '${item}')`
  await until(`menu item ${item}`, `!!${find}`, 2000)
  await js(`${find}.click()`)
}
const click = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)}).click()`)

// A small project with one file.
const dir = mkdtempSync(join(tmpdir(), 'tinkr-layout-'))
mkdirSync(join(dir, 'src'))
writeFileSync(join(dir, 'src', 'a.ts'), 'export const one = 1\n')

try {
  // Start from the default Agent preset, freshly laid out, with no folder open.
  // (Each reload waits out the layout's save delay first: closing the page writes a pending save.)
  await js(`${store('workspace')}.closeFolder()`)
  await js(`${settings}.setAppValue('rail.pins', undefined); ${settings}.setAppValue('rail.collapsed', undefined)`)
  await sleep(600)
  await js(`localStorage.removeItem('tinkr.layout.active'); localStorage.removeItem('tinkr.layout.state.agent'); localStorage.removeItem('tinkr.layout.state.editor'); location.reload()`)
  await sleep(1500)
  await until('dock ready', `!!${dock} && !!document.querySelector("[data-panel=chat] .chat")`, 30_000)

  // 1. Agent: chat in the middle, Chats and Files stacked on the left, editor and terminal hidden.
  const g1 = await groups()
  const chatBox1 = (await box('chat'))!
  const chatsBox1 = (await box('chats'))!
  if (JSON.stringify(g1.map((g) => g.sort().join('+')).sort()) !== JSON.stringify(['chat', 'chats+files']))
    throw new Error('Agent groups: ' + JSON.stringify(g1))
  if (!(chatsBox1[0] < chatBox1[0]) || chatBox1[2] < 500) throw new Error(`chat ${chatBox1}, chats ${chatsBox1}`)
  if (await js<boolean>(`!!document.querySelector('[data-panel=chat] .chat textarea')`) !== true) throw new Error('chat content not in its panel')
  pass(`Agent: chat in the middle (${chatBox1[2]}px), Chats/Files on the left, editor and terminal hidden`)

  // 2. Opening a folder brings Files to the front; opening a file shows the editor right of the chat.
  await js(`window.__tinkrOpenFolder(${JSON.stringify(dir)})`)
  await until('files in front', `${layout}.shown.files && !!document.querySelector('[data-panel=files] [role=treeitem]')`)
  await js(`${store('editor')}.open(${JSON.stringify(join(dir, 'src', 'a.ts'))})`)
  await until('editor shown', `${layout}.shown.editor && !!document.querySelector('[data-panel=editor] .cm-content')?.innerText.includes('one')`)
  const editorBox = (await box('editor'))!
  const chatBox2 = (await box('chat'))!
  if (!(editorBox[0] > chatBox2[0])) throw new Error(`editor ${editorBox} should be right of chat ${chatBox2}`)
  pass(`opening a folder shows Files; opening a file shows the editor right of the chat (${editorBox[2]}px)`)

  // 3. State that must survive layout changes: a chat draft, an editor edit (with undo), a shell's screen.
  await js(`(() => { const t = document.querySelector('[data-panel=chat] textarea'); t.value = 'draft survives'; t.dispatchEvent(new Event('input')) })()`)
  await js(`document.querySelector('[data-panel=editor] .cm-content').focus()`)
  await key('End', 'End', 35, CTRL)
  await cdp.send('Input.insertText', { text: '// typed\n' })
  await until('edit made', `document.querySelector('[data-panel=editor] .cm-content').innerText.includes('// typed')`)
  await key('`', 'Backquote', 192, CTRL)
  await until('terminal shown', `${layout}.shown.terminal && ${store('terminal')}.active?.status === 'running'`, 20_000)
  // Type only once the shell has the keyboard (else the text lands in the editor), and
  // press Enter as a key: a "\r" inside inserted text doesn't run the command.
  await until('terminal focused', `!!document.activeElement?.closest('[data-panel=terminal]')`, 10_000)
  await cdp.send('Input.insertText', { text: 'echo ("layout" + "-check")' })
  for (const type of ['keyDown', 'keyUp'] as const)
    await cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) })
  const screenHas = (s: string) =>
    `[...document.querySelectorAll('[data-panel=terminal] .xterm-rows')].some(r => r.textContent.includes(${JSON.stringify(s)}))`
  // The command is typed as "layout" + "-check", so only its output contains "layout-check".
  await until('shell output', screenHas('layout-check'), 10_000)
  const termBox = (await box('terminal'))!
  if (!(termBox[1] > chatBox2[1])) throw new Error(`terminal ${termBox} should be below`)
  pass('a draft, an editor change and shell output are in place; the terminal is along the bottom')

  // 4. Ctrl+Alt+2 switches to the Editor preset: editor in the middle, chat on the right. Nothing is lost.
  await key('2', 'Digit2', 50, CTRL | ALT)
  await until('editor preset', `${layout}.activeId === 'editor'`)
  await until('panels moved', `!!document.querySelector('[data-panel=editor] .cm-content') && !!document.querySelector('[data-panel=chat] textarea')`)
  const ed = (await box('editor'))!
  const ch = (await box('chat'))!
  if (!(ed[0] < ch[0])) throw new Error(`Editor preset: editor ${ed} should be left of chat ${ch}`)
  if ((await js<string>(`document.querySelector('[data-panel=chat] textarea').value`)) !== 'draft survives') throw new Error('chat draft lost')
  if (!(await js<boolean>(`document.querySelector('[data-panel=editor] .cm-content').innerText.includes('// typed')`))) throw new Error('editor change lost')
  await until('shell screen kept', screenHas('layout-check'), 3000)
  // Undo still knows about the edit made before the switch.
  await js(`document.querySelector('[data-panel=editor] .cm-content').focus()`)
  await key('z', 'KeyZ', 90, CTRL)
  await until('undo', `!document.querySelector('[data-panel=editor] .cm-content').innerText.includes('// typed')`, 3000)
  pass('Ctrl+Alt+2 switches to "Editor" (editor middle, chat right); draft, undo history and shell screen survive')

  // 5. Back to Agent (Ctrl+Alt+1): it comes back as it was left, not rebuilt.
  await key('1', 'Digit1', 49, CTRL | ALT)
  await until('agent preset', `${layout}.activeId === 'agent' && ${layout}.shown.editor`)
  const edAgain = (await box('editor'))!
  if (!(edAgain[0] > (await box('chat'))![0])) throw new Error('Agent arrangement not restored')
  pass('Ctrl+Alt+1 returns to "Agent" as it was left')

  // 6. Hiding the editor (Ctrl+Shift+E) and showing it again keeps its size.
  await js(`${dock}.getPanel('editor').group.api.setSize({ width: 333 })`)
  await sleep(200)
  const before = (await box('editor'))![2]
  await key('E', 'KeyE', 69, CTRL | SHIFT)
  await until('editor hidden', `!${layout}.visible.editor && !${store('editor')}.panelOpen`)
  await key('E', 'KeyE', 69, CTRL | SHIFT)
  await until('editor back', `${layout}.shown.editor`)
  await sleep(200)
  const after = (await box('editor'))![2]
  if (Math.abs(after - before) > 2) throw new Error(`editor width ${before} -> ${after}`)
  pass(`hiding and showing the editor keeps its place and size (${after}px)`)

  // 7. A panel sharing the chat's card is closed (not hidden, which would take the chat
  //    along) and comes back to that card. The card's menu then splits it off again.
  const together = `${dock}.getPanel('editor')?.group === ${dock}.getPanel('chat').group`
  await js(`${dock}.getPanel('editor').api.moveTo({ group: ${dock}.getPanel('chat').group })`)
  await until('stacked with chat', together)
  await key('E', 'KeyE', 69, CTRL | SHIFT)
  await until('closed', `!${dock}.getPanel('editor') && ${layout}.visible.chat`)
  await key('E', 'KeyE', 69, CTRL | SHIFT)
  await until('back on the card', `${together} && ${layout}.shown.editor`)
  if (!(await js<boolean>(`document.querySelector('[data-panel=editor] .cm-content').innerText.includes('one')`))) throw new Error('editor content lost')
  await panelMenu('editor', 'Split right')
  await until('split off', `!(${together})`)
  if (!((await box('editor'))![0] > (await box('chat'))![0])) throw new Error('"Split right" did not put the editor on the right')
  pass('a panel sharing the chat\'s card is closed and comes back to it; the card menu splits it off')

  // 8. Ctrl+B hides and shows Chats/Files together.
  await key('b', 'KeyB', 66, CTRL)
  await until('sidebar hidden', `!${layout}.visible.files && !${layout}.visible.chats`)
  await key('b', 'KeyB', 66, CTRL)
  await until('sidebar back', `${layout}.visible.files && ${layout}.visible.chats`)
  pass('Ctrl+B hides and shows Chats and Files')

  // The chat closes like any panel, and comes back from the rail where it was, draft and all.
  const chatBefore = (await box('chat'))!
  await panelMenu('chat', 'Close panel')
  await until('chat closed', `!${dock}.getPanel('chat') && ${layout}.state('chat') === 'closed'`)
  await click('.rail [data-pin=chat]')
  await until('chat back', `${layout}.shown.chat`)
  await sleep(200)
  const chatAfter = (await box('chat'))!
  if (Math.abs(chatAfter[0] - chatBefore[0]) > 12) throw new Error(`chat came back elsewhere: ${chatBefore} -> ${chatAfter}`)
  if ((await js<string>(`document.querySelector('[data-panel=chat] textarea').value`)) !== 'draft survives') throw new Error('chat draft lost')
  await click('.rail [data-pin=chat]')
  await until('chat hidden from the rail', `${layout}.state('chat') === 'hidden'`)
  await click('.rail [data-pin=chat]')
  await until('chat shown again', `${layout}.shown.chat`)
  pass('the chat can be closed; its rail icon brings it back in place, and hides and shows it')

  // Dragging a tab onto the rail pins its panel. The drag events are dispatched in the
  // page: dockview notes what's being dragged on `dragstart`, and the rail reads that.
  await js(`${layout}.show('plugins')`)
  await until('plugins shown', `${layout}.shown.plugins`)
  await js(`(() => {
    const panel = ${dock}.getPanel('plugins')
    const tab = panel.group.element.querySelectorAll('.dv-tab')[panel.group.panels.indexOf(panel)]
    const dataTransfer = new DataTransfer()
    const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { dataTransfer, bubbles: true, cancelable: true }))
    const rail = document.querySelector('.rail')
    fire(tab, 'dragstart'); fire(rail, 'dragover'); fire(rail, 'drop'); fire(tab, 'dragend')
  })()`)
  await until('pinned by dragging', `!!document.querySelector('.rail [data-pin=plugins]')`, 3000)
  await js(`${rail}.unpin('plugins'); ${layout}.close('plugins')`)
  pass('dragging a tab onto the rail pins the panel')

  // "All panels" pins and unpins; Ctrl+Shift+B collapses the rail into the title bar.
  await click('[data-testid=all-panels]')
  await until('panel list', `!!document.querySelector('.panel-list [data-panel-item=plugins]')`, 2000)
  await click('.panel-list [data-panel-item=plugins] .pin')
  if ((await js<number>(`Math.round(document.querySelector('.panel-list').getBoundingClientRect().width)`)) !== 300) throw new Error('panel list width')
  await until('pinned', `!!document.querySelector('.rail [data-pin=plugins] svg')`, 2000)
  await click('.panel-list [data-panel-item=plugins] .pin')
  await until('unpinned', `!document.querySelector('.rail [data-pin=plugins]')`, 2000)
  await click('[data-testid=all-panels]')
  await key('B', 'KeyB', 66, CTRL | SHIFT)
  await until('rail collapsed', `${rail}.collapsed && !document.querySelector('.rail') && !!document.querySelector('.titlebar [data-testid=agent-button]')`, 3000)
  await click('[data-testid=rail-toggle]')
  await until('rail back', `!!document.querySelector('.rail') && !document.querySelector('.titlebar [data-testid=agent-button]')`, 3000)
  pass('"All panels" pins and unpins; the rail collapses (its agent dot moves to the title bar) and returns')

  // With nothing on screen the dock says so; "New chat" there brings the chat back.
  await js(`for (const id of ${dock}.panels.map(p => p.id)) ${layout}.close(id)`)
  await until('empty dock', `!!document.querySelector('[data-testid=empty-dock]') && ${dock}.panels.length === 0`, 3000)
  await click('[data-empty=all-panels]')
  await until('panel list from the empty dock', `!!document.querySelector('.panel-list [data-panel-item=chat]')`, 2000)
  await click('[data-empty=all-panels]')
  await click('[data-empty=new-chat]')
  await until('chat from empty', `${layout}.shown.chat && !document.querySelector('[data-testid=empty-dock]')`, 3000)
  await js(`${layout}.reset()`)
  await until('preset back', `${layout}.visible.chats && ${layout}.visible.chat`, 3000)
  await js(`window.__tinkrOpenFolder(${JSON.stringify(dir)})`) // the new chat's folder is unchanged; this shows Files again
  pass('closing every panel leaves "Nothing open"; New chat there brings the chat back')

  // 9. Save as a new preset from the Layout menu; it survives a reload; reset and delete.
  await key('`', 'Backquote', 192, CTRL) // hide the terminal: part of the saved arrangement
  await until('terminal hidden', `!${layout}.visible.terminal`)
  await js(`document.querySelector('[data-testid=layout-menu]').click()`)
  await until('menu', `!!document.querySelector('.layout-popup[role=menu]')`, 2000)
  await js(`[...document.querySelectorAll('.layout-popup .item')].find(b => b.textContent.includes('Save layout as')).click()`)
  await until('name box', `!!document.querySelector('.layout-popup input')`, 2000)
  await js(`(() => { const i = document.querySelector('.layout-popup input'); i.value = 'E2E focus'; i.dispatchEvent(new Event('input')); i.form.requestSubmit() })()`)
  await until('saved', `${layout}.active.name === 'E2E focus'`, 3000)
  const customId = await js<string>(`${layout}.activeId`)
  if ((await js<string | null>(`${layout}.presetForKey(3)`)) !== customId) throw new Error('new preset is not Ctrl+Alt+3')
  if (!(await js<boolean>(`document.querySelector('[data-testid=layout-menu]').title.includes('E2E focus')`))) throw new Error('menu button not updated')
  // Rearrange, then reload: the preset is still active and as it was left.
  await js(`${dock}.getPanel('chats').group.api.setSize({ width: 300 })`)
  await sleep(600) // past the save delay
  await js(`location.reload()`)
  await sleep(1500)
  await until('reloaded', `!!${dock} && !!document.querySelector("[data-panel=chat] .chat")`, 30_000)
  if ((await js<string>(`${layout}.activeId`)) !== customId) throw new Error('active preset not remembered')
  const width = await js<number>(`Math.round(${dock}.getPanel('chats').group.api.width)`)
  if (Math.abs(width - 300) > 2) throw new Error('arrangement not restored after reload: ' + width)
  // Reset: back to how it was saved (the sidebar's earlier width).
  await js(`${layout}.reset()`)
  await sleep(200)
  if (Math.abs((await js<number>(`Math.round(${dock}.getPanel('chats').group.api.width)`)) - 300) < 2) throw new Error('reset changed nothing')
  // Delete from the menu: back to Agent.
  await js(`document.querySelector('[data-testid=layout-menu]').click()`)
  await until('menu again', `!!document.querySelector('.layout-popup[role=menu]')`, 2000)
  await js(`document.querySelector('.layout-popup .delete[aria-label="Delete layout E2E focus"]').click()`)
  await until('deleted', `${layout}.activeId === 'agent' && ${layout}.presets.length === 2`, 3000)
  pass('"Save layout as…" adds a preset (Ctrl+Alt+3) that survives a reload; reset and delete work')

  console.log(`\n${results.length} checks passed.`)
} finally {
  // Put everything back: no folder, the user's own layouts, a fresh page.
  await js(`${store('terminal')}.closeAll(); ${store('editor')}.closeAll(); ${store('workspace')}.closeFolder()`).catch(() => {})
  await js(`(() => {
    const [pins, collapsed] = ${savedRail}
    ${settings}.setAppValue('rail.pins', pins ?? undefined)
    ${settings}.setAppValue('rail.collapsed', collapsed ?? undefined)
    return ${settings}.flush()
  })()`).catch(() => {})
  await sleep(600)
  await js(`(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('tinkr.layout.')) localStorage.removeItem(k)
    const saved = ${JSON.stringify(saved)}
    for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v)
    location.reload()
  })()`).catch(() => {})
  cdp.close()
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  } catch {
    // Windows can keep a fresh folder locked for a while (see SPEC.md); not a failure.
  }
}
process.exit(0)
