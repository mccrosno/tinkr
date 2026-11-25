// Live smoke test of the sidecar over stdio (uses your real Claude Code login; a few cents of usage).
// Usage: bun scripts/smoke.ts [path-to-compiled-sidecar]
// Checks: status, a turn streams, a follow-up resumes the same conversation, abort works.

import { join } from 'node:path'
import type { SidecarEvent } from '../../shared/protocol'

const cmd = process.argv[2] ? [process.argv[2]] : ['bun', join(import.meta.dir, '..', 'src', 'main.ts')]
const proc = Bun.spawn(cmd, { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' })
const events: SidecarEvent[] = []
const waiters: { pred: (e: SidecarEvent) => boolean; resolve: (e: SidecarEvent) => void }[] = []

;(async () => {
  let buf = ''
  for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
    buf += chunk
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const e = JSON.parse(buf.slice(0, nl)) as SidecarEvent
      buf = buf.slice(nl + 1)
      events.push(e)
      for (const w of [...waiters]) if (w.pred(e)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(e))
    }
  }
})()

const send = (req: object) => proc.stdin.write(JSON.stringify(req) + '\n')
const next = <T extends SidecarEvent['type']>(type: T, pred: (e: Extract<SidecarEvent, { type: T }>) => boolean = () => true) =>
  new Promise<Extract<SidecarEvent, { type: T }>>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), 90_000)
    waiters.push({ pred: (e) => e.type === type && pred(e as never), resolve: (e) => (clearTimeout(t), resolve(e as never)) })
  })
const text = (turnId: string) =>
  events.flatMap((e) => (e.type === 'textDelta' && e.turnId === turnId ? [e.text] : [])).join('')
const ok = (msg: string) => console.log('PASS', msg)

const ready = await next('ready')
ok(`ready: protocol ${ready.protocol}, sdk ${ready.sdkVersion}, min cli ${ready.minCliVersion}`)
const status = await next('status')
const email = /\S+@\S+/
console.log('  status:', JSON.stringify(status).replace(email, '<email>'))
if (status.cli.state !== 'ok') throw new Error('CLI not ok')
ok(`cli ${status.cli.version}, auth ${status.auth.state}`)

send({ type: 'send', turnId: 't1', resumeSessionId: null, text: 'Remember this code word: PELICAN. Reply only with "ok".' })
const f1 = await next('turnFinished', (e) => e.turnId === 't1')
console.log('  t1:', JSON.stringify(text('t1')), f1.outcome, `${f1.durationMs} ms`)
if (f1.outcome !== 'success' || !f1.sessionId) throw new Error('turn 1 failed: ' + f1.message)
ok('turn streams and finishes')

send({ type: 'send', turnId: 't2', resumeSessionId: f1.sessionId, text: 'What was the code word? Reply with just the word.' })
const f2 = await next('turnFinished', (e) => e.turnId === 't2')
console.log('  t2:', JSON.stringify(text('t2')), f2.outcome, 'same session:', f2.sessionId === f1.sessionId)
if (!/pelican/i.test(text('t2'))) throw new Error('follow-up did not remember the conversation')
ok('follow-up resumes the conversation')

send({ type: 'send', turnId: 't3', resumeSessionId: null, text: 'Write a 600-word story about a lighthouse.' })
await next('textDelta', (e) => e.turnId === 't3')
send({ type: 'abort', turnId: 't3' })
const f3 = await next('turnFinished', (e) => e.turnId === 't3')
console.log('  t3:', f3.outcome, `${text('t3').length} chars before abort`, `${f3.durationMs} ms`)
if (f3.outcome !== 'aborted') throw new Error('abort did not produce outcome "aborted"')
ok('abort stops a running turn')

proc.stdin.end()
console.log('sidecar exit code:', await proc.exited)
