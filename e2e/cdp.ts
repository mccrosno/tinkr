// Tiny Chrome DevTools Protocol client for driving the running Tauri window.
// WebView2 (Windows): start the app with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222.

export async function connect(port = 9222) {
  const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as {
    type: string
    url: string
    webSocketDebuggerUrl: string
  }[]
  const page = targets.find((t) => t.type === 'page' && (t.url.includes('localhost:1420') || t.url.includes('tauri.localhost')))
  if (!page) throw new Error('Tinkr window not found on the debug port')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let id = 0
  const pending = new Map<number, (v: any) => void>()
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(String(e.data))
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)!(msg)
  })

  function send(method: string, params: object = {}): Promise<any> {
    const myId = ++id
    ws.send(JSON.stringify({ id: myId, method, params }))
    return new Promise((resolve) => pending.set(myId, resolve))
  }

  async function evaluate<T = unknown>(expression: string): Promise<T> {
    const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (m.result?.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails))
    return m.result?.result?.value
  }

  return { send, evaluate, close: () => ws.close() }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
