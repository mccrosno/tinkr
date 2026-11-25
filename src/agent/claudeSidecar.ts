// AgentProvider for Claude, backed by the Bun sidecar that Rust starts and relays.
// Rust events: "sidecar://line" (one protocol line), "sidecar://log" (stderr), "sidecar://exit" (pid).

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { parseLine, type SidecarEvent, type SidecarRequest } from '@shared/protocol'
import type { AgentEvent, AgentProvider } from './types'

/** Map a sidecar protocol event to a provider-neutral event (null = nothing for the UI). */
export function toAgentEvent(e: SidecarEvent): AgentEvent | null {
  switch (e.type) {
    case 'ready':
      return { type: 'log', message: `sidecar ready (protocol ${e.protocol}, SDK ${e.sdkVersion}, needs Claude Code ≥ ${e.minCliVersion})` }
    case 'status':
      return { type: 'status', cli: e.cli, auth: e.auth }
    case 'turnStarted':
      return e
    case 'textDelta':
      return { type: 'text', turnId: e.turnId, text: e.text }
    case 'turnFinished':
      return e
    case 'error':
      return { type: 'log', message: `sidecar error: ${e.message}` }
  }
}

export class ClaudeSidecarProvider implements AgentProvider {
  readonly id = 'claude'
  readonly label = 'Claude'
  private listeners = new Set<(e: AgentEvent) => void>()
  private nextTurn = 0
  /** Current sidecar pid, so exits of processes we already replaced are ignored. */
  private pid: number | null = null

  private dispatch(e: AgentEvent) {
    for (const l of this.listeners) l(e)
  }

  private async request(req: SidecarRequest) {
    await invoke('sidecar_send', { line: JSON.stringify(req) })
  }

  onEvent(listener: (e: AgentEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async connect() {
    await listen<string>('sidecar://line', ({ payload }) => {
      const e = parseLine<SidecarEvent>(payload)
      const mapped = e ? toAgentEvent(e) : { type: 'log' as const, message: `unreadable sidecar line: ${payload}` }
      if (mapped) this.dispatch(mapped)
    })
    await listen<string>('sidecar://log', ({ payload }) => this.dispatch({ type: 'log', message: payload }))
    await listen<number>('sidecar://exit', ({ payload }) => {
      if (payload !== this.pid) return
      this.pid = null
      this.dispatch({ type: 'disconnected', reason: `the agent process (pid ${payload}) exited` })
    })
    this.pid = await invoke<number | null>('sidecar_pid')
    if (this.pid === null) {
      this.dispatch({ type: 'disconnected', reason: 'the agent process failed to start' })
      return
    }
    this.dispatch({ type: 'connected' })
    // Rust started the sidecar before we were listening, so ask for status explicitly.
    await this.refreshStatus()
  }

  refreshStatus() {
    return this.request({ type: 'status' })
  }

  async send(sessionId: string | null, text: string, options: { cwd?: string } = {}) {
    const turnId = `t${Date.now().toString(36)}-${this.nextTurn++}`
    await this.request({ type: 'send', turnId, resumeSessionId: sessionId, text, cwd: options.cwd })
    return turnId
  }

  abort(turnId: string) {
    return this.request({ type: 'abort', turnId })
  }

  async restart() {
    this.pid = await invoke<number>('sidecar_restart')
    this.dispatch({ type: 'connected' })
    await this.refreshStatus()
  }
}
