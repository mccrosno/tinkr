// Drives the running Tauri window over the Chrome DevTools Protocol.
// Start the app with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222,
// then: bun e2e/cdp-check.ts
// Checks: sidecar auth shows up, a prompt streams back, hidden-tab panels keep state,
// and restarting the sidecar works.

const PORT = 9222
const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[]
const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:1420'))
if (!page) throw new Error('Tinkr window not found on the debug port')

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map<number, (v: any) => void>()
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(String(e.data))
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)!(msg)
})
function evaluate<T = unknown>(expression: string): Promise<T> {
  const myId = ++id
  ws.send(JSON.stringify({ id: myId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  return new Promise((resolve, reject) =>
    pending.set(myId, (m) => (m.result?.exceptionDetails ? reject(new Error(JSON.stringify(m.result.exceptionDetails))) : resolve(m.result?.result?.value))),
  )
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitFor(label: string, expr: string, timeoutMs = 60_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await evaluate<boolean>(expr)) return Date.now() - start
    await sleep(200)
  }
  throw new Error(`timed out waiting for: ${label}`)
}
const text = (sel: string) => `(document.querySelector(${JSON.stringify(sel)})?.textContent ?? '')`
const results: string[] = []
const pass = (s: string) => (results.push(`PASS ${s}`), console.log(`PASS ${s}`))

// Fresh layout so the selectors below are predictable.
await evaluate(`localStorage.removeItem('tinkr.spike.layout'); location.reload(); true`)
await sleep(1500)

// 1. Auth label arrives from the sidecar through Rust.
await waitFor('auth label', `!${text('.bar .auth')}.includes('checking')`)
console.log('  auth label:', (await evaluate<string>(text('.bar .auth'))).replace(/\S+@\S+/, '<email>'))
pass('sidecar started by Rust, auth relayed to UI')

// 2. Send a prompt and watch it stream.
await evaluate(`(() => {
  const ta = document.querySelector('.composer textarea');
  ta.value = 'Count from 1 to 10, one number per line.';
  ta.dispatchEvent(new Event('input'));
  return true })()`)
await sleep(100) // let Vue re-render so the Send button is enabled
await evaluate(`document.querySelector('.composer button').click(); true`)
const samples: number[] = []
const t0 = Date.now()
while (Date.now() - t0 < 60_000) {
  const len = await evaluate<number>(`document.querySelector('.msg.assistant .text')?.textContent.length ?? 0`)
  if (!samples.length || samples[samples.length - 1] !== len) samples.push(len)
  if (await evaluate<boolean>(`!!document.querySelector('.msg.assistant .meta')`)) break
  await sleep(100)
}
console.log('  reply:', JSON.stringify(await evaluate(text('.msg.assistant .text'))))
console.log('  meta:', await evaluate(text('.msg.assistant .meta')))
console.log('  text length over time:', samples.join(' → '))
if (!(await evaluate<boolean>(`!!document.querySelector('.msg.assistant .meta')`))) throw new Error('reply never finished')
pass(`prompt streamed back (${samples.filter((n) => n > 0).length} distinct partial lengths)`)

// 3. Hidden-tab state: type a draft, move Notes into the Chat group via the API, switch tabs, come back.
await evaluate(`(() => { const ta = document.querySelector('.composer textarea'); ta.value = 'unsent draft'; ta.dispatchEvent(new Event('input')); return true })()`)
const hidden = await evaluate<string>(`(async () => {
  const dock = window.__dock;
  const ta = document.querySelector('.composer textarea');
  ta.dataset.marker = 'original';                   // tag the DOM node to detect remounts
  const chat = dock.getPanel('chat'), notes = dock.getPanel('notes');
  notes.api.moveTo({ group: chat.group });          // stack Notes into Chat's group (Notes becomes active)
  await new Promise(r => setTimeout(r, 300));
  const whileHidden = { inDom: document.body.contains(ta), visible: ta.offsetParent !== null };
  chat.api.setActive();                             // switch back to Chat
  await new Promise(r => setTimeout(r, 300));
  const now = document.querySelector('.composer textarea');
  return JSON.stringify({ whileHidden, sameNode: now === ta, marker: now?.dataset.marker ?? null, draft: now?.value });
})()`)
console.log('  hidden-tab result:', hidden)
const h = JSON.parse(hidden)
if (h.draft === 'unsent draft') pass(`hidden tab kept its state (same DOM node: ${h.sameNode})`)
else console.log('FAIL hidden tab lost its state')

// 4. Restart the sidecar from the UI and check it reconnects.
await evaluate(`[...document.querySelectorAll('.bar button')].find(b => b.textContent.includes('Restart')).click(); true`)
await waitFor('restart logged', `${text('.log')}.includes('restarted sidecar')`)
await waitFor('auth after restart', `${text('.log')}.includes('sidecar ready')`)
pass('sidecar restart works')

console.log('\n' + results.join('\n'))
ws.close()
process.exit(0)
