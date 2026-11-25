// Minimal AgentProvider for the spike: wraps the Rust sidecar relay.
// The real interface (SPEC.md "Agent layer") adds sessions, abort, and permission requests.

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { reactive } from 'vue'

/** Events the sidecar writes to stdout (mirrors spikes/sidecar/core.ts). */
export type SidecarEvent =
  | { type: 'ready'; cliPath: string | null }
  | { type: 'auth'; account: { email?: string; subscriptionType?: string; apiProvider?: string; tokenSource?: string } }
  | { type: 'init'; apiKeySource: string; model: string; version: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; subtype: string; firstDeltaMs?: number; totalMs: number; costUsd?: number }
  | { type: 'error'; message: string }

export interface ChatMessage {
  role: 'user' | 'assistant' | 'error'
  text: string
  meta?: string
}

/** Shared state the panels read. A Pinia store in the real app. */
export const agent = reactive({
  messages: [] as ChatMessage[],
  log: [] as string[],
  busy: false,
  authLabel: 'checking…',
  pid: null as number | null,
})

function addLog(line: string) {
  agent.log.push(`${new Date().toLocaleTimeString()}  ${line}`)
  if (agent.log.length > 500) agent.log.shift()
}

function handle(ev: SidecarEvent) {
  const last = agent.messages[agent.messages.length - 1]
  switch (ev.type) {
    case 'ready':
      addLog(`sidecar ready, cli: ${ev.cliPath ?? 'none found'}`)
      break
    case 'auth': {
      const a = ev.account
      // subscriptionType is the reliable signal for a subscription login;
      // apiKeySource reads "none" in that case.
      agent.authLabel = a.subscriptionType
        ? `${a.subscriptionType} (Claude Code login)`
        : a.tokenSource === 'none'
          ? 'Not signed in: run `claude` then /login'
          : (a.apiProvider ?? 'unknown')
      break
    }
    case 'init':
      addLog(`turn started: ${ev.model}, CLI ${ev.version}, apiKeySource=${ev.apiKeySource}`)
      break
    case 'delta':
      if (last?.role === 'assistant') last.text += ev.text
      else agent.messages.push({ role: 'assistant', text: ev.text })
      break
    case 'done':
      agent.busy = false
      if (last?.role === 'assistant') {
        last.meta = `first token ${ev.firstDeltaMs ?? '–'} ms · ${ev.totalMs} ms · ~$${ev.costUsd?.toFixed(4) ?? '?'} (estimate)`
      }
      break
    case 'error':
      agent.busy = false
      agent.messages.push({ role: 'error', text: ev.message })
      break
  }
}

async function send(req: object) {
  try {
    await invoke('sidecar_send', { line: JSON.stringify(req) })
  } catch (e) {
    agent.busy = false
    agent.messages.push({ role: 'error', text: String(e) })
  }
}

export async function sendMessage(text: string) {
  agent.messages.push({ role: 'user', text })
  agent.busy = true
  await send({ type: 'prompt', text })
}

export async function restart() {
  agent.busy = false
  agent.pid = await invoke<number>('sidecar_restart')
  addLog(`restarted sidecar, pid ${agent.pid}`)
  await send({ type: 'auth' })
}

export async function connect() {
  await listen<string>('sidecar://line', (e) => {
    try {
      handle(JSON.parse(e.payload) as SidecarEvent)
    } catch {
      addLog(`bad line from sidecar: ${e.payload}`)
    }
  })
  await listen<string>('sidecar://log', (e) => addLog(`[stderr] ${e.payload}`))
  await listen<number>('sidecar://exit', (e) => {
    addLog(`sidecar pid ${e.payload} exited`)
    // Only react if the process that died is the current one (not one we replaced).
    if (agent.pid === null || agent.pid === e.payload) {
      agent.busy = false
      agent.authLabel = 'sidecar stopped'
    }
  })
  // The sidecar was started by Rust before we were listening; ask for auth now.
  await send({ type: 'auth' })
}
