// Shared sidecar logic. Entry points (index.ts, slim.ts) decide where the CLI comes from.
// Protocol: one JSON object per line. Requests on stdin, events on stdout.
//   {"type":"auth"}                -> {"type":"auth", account}
//   {"type":"prompt","text":"..."} -> {"type":"init"}, {"type":"delta","text"}..., {"type":"done"}
//   on failure                     -> {"type":"error","message"}
// Anything for humans goes to stderr so stdout stays clean JSON.

import { query } from '@anthropic-ai/claude-agent-sdk'

export function run(cliPath: string | undefined) {
  const send = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + '\n')

  function baseOptions() {
    return {
      pathToClaudeCodeExecutable: cliPath,
      tools: [] as string[], // chat only for the spike: no file or shell access
      maxTurns: 1,
      persistSession: false,
      settingSources: [] as never[], // don't load the user's project/user settings
    }
  }

  async function handleAuth() {
    const q = query({ prompt: 'hi', options: { ...baseOptions() } })
    try {
      const account = await q.accountInfo()
      send({ type: 'auth', account })
    } finally {
      q.interrupt().catch(() => {})
    }
  }

  async function handlePrompt(text: string) {
    const started = Date.now()
    let firstDeltaMs: number | undefined
    for await (const m of query({ prompt: text, options: { ...baseOptions(), includePartialMessages: true } })) {
      if (m.type === 'system' && m.subtype === 'init') {
        send({ type: 'init', apiKeySource: m.apiKeySource, model: m.model, version: m.claude_code_version })
      } else if (m.type === 'stream_event') {
        const ev = m.event
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          firstDeltaMs ??= Date.now() - started
          send({ type: 'delta', text: ev.delta.text })
        }
      } else if (m.type === 'result') {
        send({ type: 'done', subtype: m.subtype, firstDeltaMs, totalMs: Date.now() - started, costUsd: m.total_cost_usd })
      }
    }
  }

  async function handleLine(line: string) {
    try {
      const req = JSON.parse(line)
      if (req.type === 'auth') await handleAuth()
      else if (req.type === 'prompt') await handlePrompt(req.text)
      else send({ type: 'error', message: `unknown request type: ${req.type}` })
    } catch (e) {
      send({ type: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  // Read stdin line by line. Requests run one at a time, in order, via a promise chain.
  let buf = ''
  let queue: Promise<void> = Promise.resolve()
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    buf += chunk
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line) queue = queue.then(() => handleLine(line))
    }
  })
  // When the host closes stdin, finish queued work, then exit.
  process.stdin.on('end', () => {
    if (buf.trim()) queue = queue.then(() => handleLine(buf.trim()))
    queue.then(() => process.exit(0))
  })
  send({ type: 'ready', cliPath: cliPath ?? null })
  console.error(`[sidecar] ready (cli: ${cliPath})`)
}
