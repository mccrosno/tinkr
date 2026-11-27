// Tinkr agent sidecar: reads requests from stdin and writes events to stdout,
// one JSON object per line (see shared/protocol.ts). Human-readable logs go to stderr.

import { homedir } from 'node:os'
import { PROTOCOL_VERSION, parseLine, type CliStatus, type SidecarEvent, type SidecarRequest } from '../../shared/protocol'
import { Agent, chatFolder, readAccount } from './agent'
import { deleteChat, listChats, loadChat, renameChat } from './history'
import { findCli } from './cli'
import { MIN_CLI_VERSION, SDK_VERSION } from './sdkVersion.generated'

const emit = (event: SidecarEvent) => process.stdout.write(JSON.stringify(event) + '\n')
const log = (...args: unknown[]) => console.error('[sidecar]', ...args)

let cli: CliStatus = { state: 'missing', searched: [] }
const agent = new Agent(() => (cli.state === 'ok' ? cli.path : null), emit)

async function refreshStatus() {
  cli = await findCli(MIN_CLI_VERSION)
  const { auth, models } =
    cli.state === 'ok' ? await readAccount(cli.path) : { auth: { state: 'unknown', detail: 'no usable CLI' } as const, models: [] }
  emit({ type: 'status', cli, auth, models })
}

// Status checks can overlap (startup + a UI request); share one in-flight check.
let statusInFlight: Promise<void> | null = null
function status() {
  statusInFlight ??= refreshStatus().finally(() => (statusInFlight = null))
  return statusInFlight
}

async function handle(line: string) {
  const req = parseLine<SidecarRequest>(line)
  if (!req) return emit({ type: 'error', message: `not a protocol message: ${line.slice(0, 200)}` })
  switch (req.type) {
    case 'status':
      return status()
    case 'send':
      // Make sure the CLI has been checked before the first turn.
      if (cli.state !== 'ok') await status()
      return agent.send(req.turnId, req.resumeSessionId, req.text, {
        cwd: req.cwd,
        model: req.model,
        effort: req.effort,
        attachments: req.attachments,
        pluginsDir: req.pluginsDir,
      })
    case 'abort':
      return agent.abort(req.turnId)
    case 'permissionResponse':
      return agent.respond(req.requestId, req.decision)
    case 'pluginResponse':
      return agent.answerPluginRequest(req.requestId, { text: req.text, isError: req.isError })
    case 'listChats':
      return answer(req.requestId, async () => {
        const dir = req.allFolders ? null : chatFolder(req.cwd)
        emit({ type: 'chatList', requestId: req.requestId, chats: await listChats(dir, homedir()) })
      })
    case 'loadChat':
      return answer(req.requestId, async () => {
        emit({ type: 'chatHistory', requestId: req.requestId, items: await loadChat(req.sessionId, chatFolder(req.cwd), req.cwd) })
      })
    case 'renameChat':
      return answer(req.requestId, async () => {
        await renameChat(req.sessionId, req.title, chatFolder(req.cwd))
        emit({ type: 'requestDone', requestId: req.requestId })
      })
    case 'deleteChat':
      return answer(req.requestId, async () => {
        await deleteChat(req.sessionId, chatFolder(req.cwd))
        emit({ type: 'requestDone', requestId: req.requestId })
      })
    default:
      return emit({ type: 'error', message: `unknown request type: ${(req as { type: string }).type}` })
  }
}

/** Run a history request; if it fails, answer with the error so the UI isn't left waiting. */
async function answer(requestId: string, run: () => Promise<void>) {
  try {
    await run()
  } catch (e) {
    emit({ type: 'requestDone', requestId, error: e instanceof Error ? e.message : String(e) })
  }
}

// Requests are handled concurrently (an abort must be able to arrive mid-turn).
const inFlight = new Set<Promise<unknown>>()
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  buffer += chunk
  let nl: number
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    if (!line) continue
    const p = handle(line).catch((e) => emit({ type: 'error', message: String(e) }))
    inFlight.add(p)
    p.finally(() => inFlight.delete(p))
  }
})
// stdin closing means the app is gone: finish what's running, then exit.
process.stdin.on('end', async () => {
  await Promise.allSettled([...inFlight])
  process.exit(0)
})

emit({ type: 'ready', protocol: PROTOCOL_VERSION, sdkVersion: SDK_VERSION, minCliVersion: MIN_CLI_VERSION })
log(`ready (sdk ${SDK_VERSION}, min cli ${MIN_CLI_VERSION})`)
void status()
