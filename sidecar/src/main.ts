// Tinkr agent sidecar: reads requests from stdin and writes events to stdout,
// one JSON object per line (see shared/protocol.ts). Human-readable logs go to stderr.

import { PROTOCOL_VERSION, parseLine, type CliStatus, type SidecarEvent, type SidecarRequest } from '../../shared/protocol'
import { Agent, readAuth } from './agent'
import { findCli } from './cli'
import { MIN_CLI_VERSION, SDK_VERSION } from './sdkVersion.generated'

const emit = (event: SidecarEvent) => process.stdout.write(JSON.stringify(event) + '\n')
const log = (...args: unknown[]) => console.error('[sidecar]', ...args)

let cli: CliStatus = { state: 'missing', searched: [] }
const agent = new Agent(() => (cli.state === 'ok' ? cli.path : null), emit)

async function refreshStatus() {
  cli = await findCli(MIN_CLI_VERSION)
  const auth = cli.state === 'ok' ? await readAuth(cli.path) : ({ state: 'unknown', detail: 'no usable CLI' } as const)
  emit({ type: 'status', cli, auth })
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
      return agent.send(req.turnId, req.resumeSessionId, req.text, req.cwd)
    case 'abort':
      return agent.abort(req.turnId)
    default:
      return emit({ type: 'error', message: `unknown request type: ${(req as { type: string }).type}` })
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
