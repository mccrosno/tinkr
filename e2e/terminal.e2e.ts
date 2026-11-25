// End-to-end check of Milestone 3 (terminal) in the real Tauri window, over CDP.
// Keystrokes go to the page through DevTools, not the OS, so your own mouse and
// keyboard aren't touched. Launch the app as described in e2e/chat.e2e.ts, then:
//   bun e2e/terminal.e2e.ts
//
// Works with PowerShell (Windows) and POSIX shells (Linux/macOS): commands are
// picked per shell. Output is checked for text the typed command doesn't contain
// (e.g. "tink" + "r-ok"), so the echo of the typed line can't fake a pass.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, sleep } from './cdp'

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
const store = `window.__tinkr.pinia._s.get('terminal')`
const activeKey = () => js<number>(`${store}.activeKey`)
/** A check that the active terminal's visible text contains `needle` (xterm.js's DOM renderer draws rows as divs). */
const screenHas = async (needle: string) =>
  `(document.querySelector('[data-testid=terminal-${await activeKey()}] .xterm-rows')?.innerText ?? '').includes(${JSON.stringify(needle)})`
const key = async (key: string, code: string, vk: number, modifiers = 0, text?: string) => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers, text })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers })
}
const CTRL = 2
/** Type a line into the focused terminal and press Enter. */
async function run(line: string) {
  await cdp.send('Input.insertText', { text: line })
  await key('Enter', 'Enter', 13, 0, '\r')
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0) // signal 0 only checks that the process exists
    return true
  } catch {
    return false
  }
}
async function untilDead(pid: number, label: string) {
  const t0 = Date.now()
  while (alive(pid)) {
    if (Date.now() - t0 > 10_000) throw new Error(`${label}: process ${pid} is still running`)
    await sleep(100)
  }
}

const dir = mkdtempSync(join(tmpdir(), 'tinkr-term-'))
const dirName = dir.split(/[\\/]/).pop()!

try {
  await js(`location.reload()`)
  await sleep(500)
  await until('app loaded', `typeof window.__tinkrOpenFolder === 'function'`, 30_000)
  await js(`window.__tinkrOpenFolder(${JSON.stringify(dir)})`)
  await until('folder open', `window.__tinkr.pinia._s.get('workspace').root !== null`)

  // 1. Ctrl+` opens a terminal in the project folder, with a prompt.
  await key('`', 'Backquote', 192, CTRL)
  await until('terminal running', `${store}.active?.status === 'running'`)
  const shell = await js<string>(`${store}.active.title`)
  const pid1 = await js<number>(`${store}.active.pid`)
  const ps = /^(pwsh|powershell)/i.test(shell)
  await until('prompt', `(document.querySelector('[data-testid=terminal-${await activeKey()}] .xterm-rows')?.innerText ?? '').trim().length > 0`, 20_000)
  await until('focus', `document.activeElement?.classList.contains('xterm-helper-textarea')`, 5000)
  console.log(`  shell: ${shell} (pid ${pid1})`)
  pass('Ctrl+` opens a focused terminal with a running shell')

  // 2. Typed input reaches the shell; output comes back. The shell runs in the folder.
  await run(ps ? `Write-Output ("tink" + "r-ok"); (Get-Location).Path` : `echo "tink""r-ok"; pwd`)
  await until('command output', await screenHas('tinkr-ok'))
  await until('cwd', await screenHas(dirName))
  pass('typed commands run and print, in the project folder')

  // 3. ANSI colors are rendered (xterm.js puts color classes on spans).
  await run(ps ? `Write-Host ("re" + "d-text") -ForegroundColor Red` : `printf '\\033[31m%s\\033[0m\\n' "re""d-text"`)
  await until('red output', await screenHas('red-text'))
  const colored = await js<boolean>(
    `[...document.querySelectorAll('[data-testid=terminal-${await activeKey()}] .xterm-rows span')].some(s => s.textContent.includes('red-text') && /xterm-fg-(1|9)\\b/.test(s.className))`,
  )
  if (!colored) throw new Error('expected red text to be drawn with an ANSI color class')
  pass('ANSI colors render')

  // 4. Resizing the panel resizes the PTY, and the shell sees the new size.
  const rowsBefore = await js<number>(`document.querySelectorAll('[data-testid=terminal-${await activeKey()}] .xterm-rows > div').length`)
  await js(`document.querySelector('[aria-label="Resize terminal"]').focus()`)
  for (let i = 0; i < 2; i++) await key('ArrowUp', 'ArrowUp', 38, 8 /* shift = 50px */)
  await until('more rows', `document.querySelectorAll('[data-testid=terminal-${await activeKey()}] .xterm-rows > div').length > ${rowsBefore}`, 5000)
  const rowsAfter = await js<number>(`document.querySelectorAll('[data-testid=terminal-${await activeKey()}] .xterm-rows > div').length`)
  await js(`document.querySelector('[data-testid=terminal-${await activeKey()}] textarea').focus()`)
  await run(ps ? `"rows=" + $Host.UI.RawUI.WindowSize.Height` : `echo "rows=$(tput lines)"`)
  await until('shell sees the new size', await screenHas(`rows=${rowsAfter}`), 5000)
  pass(`resizing the panel resizes the shell (${rowsBefore} -> ${rowsAfter} rows)`)

  // 5. Ctrl+C with no selection interrupts the running program instead of copying.
  await run(ps ? 'Start-Sleep -Seconds 60' : 'sleep 60')
  await sleep(800)
  await key('c', 'KeyC', 67, CTRL)
  await sleep(500)
  await run(ps ? `Write-Output ("after" + "-interrupt")` : `echo "after""-interrupt"`)
  await until('prompt after Ctrl+C', await screenHas('after-interrupt'), 8000)
  pass('Ctrl+C interrupts a running command')

  // 6. Hiding the panel keeps the shell and its screen; showing it again restores both.
  await key('`', 'Backquote', 192, CTRL)
  await until('hidden', `${store}.visible === false && getComputedStyle(document.querySelector('[data-testid=terminal-panel]')).display === 'none'`)
  if (!alive(pid1)) throw new Error('hiding the panel killed the shell')
  await key('`', 'Backquote', 192, CTRL)
  await until('shown', `${store}.visible === true`)
  await until('screen kept', await screenHas('tinkr-ok'), 3000)
  pass('hiding and showing the panel keeps the shell and its output')

  // 7. A second tab gets its own shell; closing it kills that shell.
  await js(`document.querySelector('[aria-label="New terminal"]').click()`)
  await until('second terminal', `${store}.tabs.length === 2 && ${store}.active?.status === 'running'`)
  const pid2 = await js<number>(`${store}.active.pid`)
  const titles = await js<string[]>(`${store}.tabs.map(t => t.title)`)
  console.log('  tabs:', titles.join(', '))
  if (pid2 === pid1 || titles[0] === titles[1]) throw new Error('expected a separate shell with its own title')
  await js(`document.querySelector('[role=tab][data-key="${await activeKey()}"] .close').click()`)
  await untilDead(pid2, 'closed tab')
  if (!alive(pid1)) throw new Error('closing one tab killed the other shell')
  pass('a second tab runs its own shell, and closing it kills only that shell')

  // 8. A failing exit keeps the tab with the exit code.
  await js(`document.querySelector('[aria-label="New terminal"]').click()`)
  await until('third terminal', `${store}.tabs.length === 2 && ${store}.active?.status === 'running'`)
  const pid3 = await js<number>(`${store}.active.pid`)
  await until('prompt 3', `(document.querySelector('[data-testid=terminal-${await activeKey()}] .xterm-rows')?.innerText ?? '').trim().length > 0`, 20_000)
  await run('exit 3')
  await until('exit 3 shown', `${store}.active?.status === 'exited' && ${store}.active?.exitCode === 3`)
  await until('exit message', await screenHas('[Process exited with code 3]'), 3000)
  await untilDead(pid3, 'exit 3')
  await js(`document.querySelector('[role=tab][data-key="${await activeKey()}"] .close').click()`)
  pass('exiting with an error keeps the tab and shows the exit code')

  // 9. A clean `exit` closes the tab and hides the panel.
  await until('back to first tab', `${store}.tabs.length === 1`)
  await js(`document.querySelector('[data-testid=terminal-${await activeKey()}] textarea').focus()`)
  await run('exit')
  await until('tab closed', `${store}.tabs.length === 0 && ${store}.visible === false`)
  await untilDead(pid1, 'exit')
  pass('`exit` closes the tab and hides the panel')

  // 10. Closing every terminal (what a folder switch does) kills the shells.
  await key('`', 'Backquote', 192, CTRL)
  await until('fresh terminal', `${store}.active?.status === 'running'`)
  const pid4 = await js<number>(`${store}.active.pid`)
  await js(`${store}.closeAll()`)
  await untilDead(pid4, 'closeAll')
  pass('closing all terminals kills their shells')

  console.log(`\n${results.length} checks passed.`)
} finally {
  await js(`${store}.closeAll()`).catch(() => {})
  cdp.close()
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Windows can keep a fresh folder locked for a while (see SPEC.md); not a failure.
  }
}
