// End-to-end check of Milestone 1 in the real Tauri window, driven over the DevTools
// protocol (no mouse/keyboard, so it can run while you use the machine).
// Uses your real Claude Code login (a few cents of usage).
//
//   PowerShell:  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
//                bun tauri dev --config src-tauri/tauri.unfocused.conf.json
//   then:        bun run e2e

import { connect, sleep } from './cdp'

const cdp = await connect(Number(process.argv[2] ?? 9222))
const js = <T = unknown>(expr: string) => cdp.evaluate<T>(expr)
const chat = `window.__tinkr.pinia._s.get('chat')`
const text = (sel: string) => js<string>(`document.querySelector(${JSON.stringify(sel)})?.textContent?.trim() ?? ''`)
const results: string[] = []
const pass = (s: string) => (results.push('PASS ' + s), console.log('PASS', s))

async function until(label: string, expr: string, timeoutMs = 90_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await js<boolean>(expr)) return Date.now() - t0
    await sleep(150)
  }
  throw new Error('timed out waiting for: ' + label)
}

/** Type into the composer the way a user would (input event), then click Send. */
async function sendViaUi(message: string) {
  await js(`(() => { const t = document.querySelector('textarea'); t.value = ${JSON.stringify(message)}; t.dispatchEvent(new Event('input')); })()`)
  await sleep(50)
  await js(`[...document.querySelectorAll('.composer button')].find(b => b.textContent.trim() === 'Send').click()`)
}
const lastAssistant = () => js<string>(`[...document.querySelectorAll('.msg.assistant')].at(-1)?.textContent ?? ''`)

// Start from a clean chat.
await js(`location.reload()`)
await sleep(1500)

// 1. Status bar shows the CLI and login found by the sidecar.
await until('status', `${chat}.cli?.state === 'ok' && !!${chat}.auth`)
console.log('  status bar:', await text('[data-testid=agent-status]'), '|', await text('[data-testid=auth-status]'))
if ((await js<string>(`${chat}.auth.state`)) !== 'subscription') console.log('  (note: not a subscription login)')
pass('status bar shows Claude Code version and login')

// 2. A message streams into the chat, rendered as Markdown.
await sendViaUi('Reply with a Markdown bullet list of three fruits and nothing else.')
const lengths: number[] = []
await until('first text', `${chat}.messages.some(m => m.role === 'assistant' && m.text)`)
while (await js<boolean>(`${chat}.busy`)) {
  const n = (await lastAssistant()).length
  if (lengths.at(-1) !== n) lengths.push(n)
  await sleep(40)
}
const items = await js<number>(`[...document.querySelectorAll('.msg.assistant')].at(-1).querySelectorAll('li').length`)
console.log('  reply:', JSON.stringify(await lastAssistant()), '| list items:', items, '| lengths seen:', lengths.join('→'))
console.log('  meta:', await text('.msg.assistant .meta'))
if (items !== 3) throw new Error('expected a rendered 3-item list')
pass('reply streams and renders as Markdown')

// 3. A follow-up continues the same conversation.
await sendViaUi('Which of those fruits did you list second? Reply with one word.')
await until('follow-up done', `!${chat}.busy && ${chat}.messages.filter(m => m.role === 'assistant').length === 2`)
console.log('  follow-up:', JSON.stringify(await lastAssistant()))
const first = await js<string>(`[...document.querySelectorAll('.msg.assistant li')][1].textContent.trim().toLowerCase()`)
if (!(await lastAssistant()).toLowerCase().includes(first.replace(/[^a-z]/g, '').slice(0, 4))) throw new Error('follow-up lost context')
pass('follow-up resumes the conversation')

// 4. Stop interrupts a long reply.
await sendViaUi('Write a 500-word story about a lighthouse keeper.')
await until('story starts', `${chat}.messages.at(-1).role === 'assistant' && ${chat}.messages.at(-1).text.length > 20`)
await js(`[...document.querySelectorAll('.composer button')].find(b => b.textContent.trim() === 'Stop').click()`)
await until('stopped', `!${chat}.busy`, 20_000)
console.log('  stopped after', (await lastAssistant()).length, 'chars; meta:', await js(`[...document.querySelectorAll('.msg.assistant .meta')].at(-1)?.textContent`))
if ((await js<string>(`${chat}.messages.at(-1).done?.outcome`)) !== 'aborted') throw new Error('expected outcome "aborted"')
pass('Stop aborts a running reply')

// 5. New chat clears the conversation.
await js(`[...document.querySelectorAll('.titlebar button')].find(b => b.textContent.includes('New chat')).click()`)
await sleep(100)
if ((await js<number>(`${chat}.messages.length`)) !== 0 || (await js(`${chat}.sessionId`)) !== null) throw new Error('new chat did not reset')
pass('New chat starts fresh')

// 6. Restarting the agent reconnects and re-checks status.
await js(`[...document.querySelectorAll('.statusbar button')].find(b => b.textContent.includes('Restart')).click()`)
await until('reconnected', `${chat}.connection === 'connected' && ${chat}.cli?.state === 'ok'`)
await sleep(1500) // make sure the old process's exit event didn't mark us disconnected
if ((await js<string>(`${chat}.connection`)) !== 'connected') throw new Error('stale exit event disconnected the UI')
pass('Restart agent reconnects')

console.log('\n' + results.join('\n'))
cdp.close()
process.exit(0)
