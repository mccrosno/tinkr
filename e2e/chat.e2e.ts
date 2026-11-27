// End-to-end check of Milestone 1 in the real Tauri window, driven over the DevTools
// protocol (no mouse/keyboard, so it can run while you use the machine).
// Uses your real Claude Code login (a few cents of usage).
//
//   PowerShell:  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
//                bun tauri dev --config src-tauri/tauri.unfocused.conf.json
//   then:        bun run e2e

import { connect, deleteTestChats, sleep } from './cdp'

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

/** Open the agent status dot's menu (in the rail, or the title bar while that's collapsed). */
const openAgentMenu = async () => {
  await js(`document.querySelector('[data-testid=agent-button]').click()`)
  await until('agent menu', `!!document.querySelector('[data-testid=agent-status]')`, 2000)
}

/** Type into the composer the way a user would (input event), then click Send. */
async function sendViaUi(message: string) {
  await js(`(() => { const t = document.querySelector('textarea'); t.value = ${JSON.stringify(message)}; t.dispatchEvent(new Event('input')); })()`)
  await sleep(50)
  await js(`document.querySelector('.composer [data-testid=send]').click()`)
}
const lastAssistant = () => js<string>(`[...document.querySelectorAll('.msg.assistant')].at(-1)?.textContent ?? ''`)

// Start from a clean chat.
await js(`location.reload()`)
await sleep(1500)

// 1. The agent status menu shows the CLI and login found by the sidecar.
await until('status', `${chat}.cli?.state === 'ok' && !!${chat}.auth`)
await openAgentMenu()
const status = await text('[data-testid=agent-status]')
console.log('  agent:', status, '|', await text('[data-testid=auth-status]'))
if (!status.startsWith('Claude Code ')) throw new Error('agent status: ' + status)
if ((await js<string>(`${chat}.auth.state`)) !== 'subscription') console.log('  (note: not a subscription login)')
await js(`document.querySelector('[data-testid=agent-button]').click()`)
pass('the agent status menu shows Claude Code version and login')

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
await js(`document.querySelector('.composer [data-testid=stop]').click()`)
await until('stopped', `!${chat}.busy`, 20_000)
console.log('  stopped after', (await lastAssistant()).length, 'chars; meta:', await js(`[...document.querySelectorAll('.msg.assistant .meta')].at(-1)?.textContent`))
if ((await js<string>(`${chat}.messages.at(-1).done?.outcome`)) !== 'aborted') throw new Error('expected outcome "aborted"')
pass('Stop aborts a running reply')

// 5. New chat clears the conversation.
const testSession = await js<string | null>(`${chat}.sessionId`) // deleted at the end
await js(`document.querySelector('[data-testid=new-chat]').click()`) // in the Chats panel
await sleep(100)
if ((await js<number>(`${chat}.messages.length`)) !== 0 || (await js(`${chat}.sessionId`)) !== null) throw new Error('new chat did not reset')
pass('New chat starts fresh')

// 6. Restarting the agent reconnects and re-checks status.
await openAgentMenu()
await js(`document.querySelector('[data-testid=restart-agent]').click()`)
await until('reconnected', `${chat}.connection === 'connected' && ${chat}.cli?.state === 'ok'`)
await sleep(1500) // make sure the old process's exit event didn't mark us disconnected
if ((await js<string>(`${chat}.connection`)) !== 'connected') throw new Error('stale exit event disconnected the UI')
pass('Restart agent reconnects')

// Leave no trace in the history list.
await deleteTestChats(js, { ids: [testSession] })

console.log('\n' + results.join('\n'))
cdp.close()
process.exit(0)
