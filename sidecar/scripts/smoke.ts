// Live smoke test of the sidecar over stdio (uses your real Claude Code login; a few cents of usage).
// Usage: bun scripts/smoke.ts [path-to-compiled-sidecar]
// Checks: status and the model list, a turn streams, a follow-up resumes the same
// conversation, abort works, an image attachment with a picked model and effort, and the
// history requests (list, load, rename, delete). Its chats run in the home folder (no
// project), like Tinkr's chats without a folder; it deletes them at the end.

import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
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
if (!status.models.some((m) => m.value === 'haiku')) throw new Error('model list has no "haiku": ' + JSON.stringify(status.models.map((m) => m.value)))
ok(`${status.models.length} models offered`)

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
const abortAt = Date.now()
send({ type: 'abort', turnId: 't3' })
const f3 = await next('turnFinished', (e) => e.turnId === 't3')
console.log('  t3:', f3.outcome, `${text('t3').length} chars before abort`, `${f3.durationMs} ms in all, stopped ${Date.now() - abortAt} ms after the abort`)
if (f3.outcome !== 'aborted') throw new Error('abort did not produce outcome "aborted"')
ok('abort stops a running turn')

// An image, sent with a picked model and effort.
send({
  type: 'send',
  turnId: 't4',
  resumeSessionId: null,
  text: 'What color is this image? Reply with one word.',
  model: 'haiku',
  effort: 'low',
  attachments: [{ name: 'red.png', mediaType: 'image/png', data: redPng() }],
})
const s4 = await next('turnStarted', (e) => e.turnId === 't4')
const f4 = await next('turnFinished', (e) => e.turnId === 't4')
console.log('  t4:', JSON.stringify(text('t4')), f4.outcome, s4.model)
if (!/red/i.test(text('t4'))) throw new Error('image attachment was not seen')
if (!/haiku/i.test(s4.model)) throw new Error('model pick was ignored')
ok('image attachment, model and effort')

// History: the chats appear in the list, load, rename and delete.
const ask = async <T extends 'chatList' | 'chatHistory' | 'requestDone'>(type: T, req: object, id: string) => {
  send({ ...req, requestId: id })
  return next(type, (e) => (e as { requestId?: string }).requestId === id)
}
const list = await ask('chatList', { type: 'listChats' }, 'r1')
const mine = [f1.sessionId, f3.sessionId, f4.sessionId]
if (!mine.every((id) => list.chats.some((c) => c.sessionId === id))) throw new Error('listChats is missing a chat: ' + JSON.stringify(list.chats))
const loaded = await ask('chatHistory', { type: 'loadChat', sessionId: f4.sessionId }, 'r2')
console.log('  history:', JSON.stringify(loaded.items).replace(/"data":"[^"]+"/g, '"data":"…"'))
const first = loaded.items[0]
if (first?.kind !== 'user' || first.attachments[0]?.mediaType !== 'image/png') throw new Error('history lost the attachment')
const renamed = await ask('requestDone', { type: 'renameChat', sessionId: f4.sessionId, title: 'Red square' }, 'r3')
if (renamed.error) throw new Error(renamed.error)
const after = await ask('chatList', { type: 'listChats' }, 'r4')
if (after.chats.find((c) => c.sessionId === f4.sessionId)?.title !== 'Red square') throw new Error('rename did not stick')
for (const [i, id] of mine.entries()) {
  const done = await ask('requestDone', { type: 'deleteChat', sessionId: id }, `d${i}`)
  if (done.error) throw new Error(done.error)
}
const left = (await ask('chatList', { type: 'listChats' }, 'r5')).chats
if (left.some((c) => mine.includes(c.sessionId))) throw new Error('delete left chats behind')
const all = await ask('chatList', { type: 'listChats', allFolders: true }, 'r6')
const folders = new Set(all.chats.map((c) => c.folder ?? '(no folder)'))
console.log(`  all folders: ${all.chats.length} chats in ${folders.size} folders`)
if (all.chats.length < left.length) throw new Error('the all-folders list has fewer chats than one folder')
ok('history: list, load (with attachment), rename, delete, all folders')

proc.stdin.end()
console.log('sidecar exit code:', await proc.exited)

/** A 16x16 solid red PNG, base64-encoded. */
function redPng() {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Buffer) => {
    let c = 0xffffffff
    for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(16, 0)
  header.writeUInt32BE(16, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 16 }, () => [255, 0, 0]).flat())])
  const pixels = deflateSync(Buffer.concat(Array.from({ length: 16 }, () => row)))
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))])
  return png.toString('base64')
}
