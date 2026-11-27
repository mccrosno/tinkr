// AgentProvider for Claude, backed by the Bun sidecar that Rust starts and relays.
// Rust events: "sidecar://line" (one protocol line), "sidecar://log" (stderr), "sidecar://exit" (pid).

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { parseLine, type ChatSummary, type HistoryItem, type SidecarEvent, type SidecarRequest } from '@shared/protocol'
import type { AgentEvent, AgentProvider, PermissionDecision, SendOptions } from './types'

/** Answers to history requests; they are resolved by request id, not shown as events. */
type Reply = Extract<SidecarEvent, { type: 'chatList' | 'chatHistory' | 'requestDone' }>

/** Distributes a request's type over the union, so `Omit` keeps each variant's fields. */
type WithoutRequestId<T> = T extends unknown ? Omit<T, 'requestId'> : never
type HistoryRequest = WithoutRequestId<Extract<SidecarRequest, { requestId: string }>>

/** Map a sidecar protocol event to a provider-neutral event (null = nothing for the UI). */
export function toAgentEvent(e: SidecarEvent): AgentEvent | null {
  switch (e.type) {
    case 'ready':
      return { type: 'log', message: `sidecar ready (protocol ${e.protocol}, SDK ${e.sdkVersion}, needs Claude Code ≥ ${e.minCliVersion})` }
    case 'status':
      return { type: 'status', cli: e.cli, auth: e.auth, models: e.models ?? [] }
    case 'turnStarted':
      return e
    case 'textDelta':
      return { type: 'text', turnId: e.turnId, text: e.text }
    case 'turnFinished':
    case 'toolUse':
    case 'toolResult':
    case 'fileWillChange':
    case 'fileChanged':
    case 'permissionRequest':
    case 'permissionCancelled':
      return e
    case 'error':
      return { type: 'log', message: `sidecar error: ${e.message}` }
    case 'chatList':
    case 'chatHistory':
    case 'requestDone':
      return null // answers to requests; the provider resolves them (see `ask`)
  }
}

export class ClaudeSidecarProvider implements AgentProvider {
  readonly id = 'claude'
  readonly label = 'Claude'
  private listeners = new Set<(e: AgentEvent) => void>()
  private nextTurn = 0
  private nextRequest = 0
  /** History requests waiting for their answer, by request id. */
  private waiting = new Map<string, { resolve: (r: Reply) => void; reject: (e: Error) => void }>()
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
      if (e && (e.type === 'chatList' || e.type === 'chatHistory' || e.type === 'requestDone')) return this.settle(e)
      const mapped = e ? toAgentEvent(e) : { type: 'log' as const, message: `unreadable sidecar line: ${payload}` }
      if (mapped) this.dispatch(mapped)
    })
    await listen<string>('sidecar://log', ({ payload }) => this.dispatch({ type: 'log', message: payload }))
    await listen<number>('sidecar://exit', ({ payload }) => {
      if (payload !== this.pid) return
      this.pid = null
      this.failWaiting('the agent process exited')
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

  async send(sessionId: string | null, text: string, options: SendOptions = {}) {
    const turnId = `t${Date.now().toString(36)}-${this.nextTurn++}`
    const { cwd, model, effort, attachments } = options
    await this.request({ type: 'send', turnId, resumeSessionId: sessionId, text, cwd, model, effort, attachments })
    return turnId
  }

  /** Send a history request and wait for the answer with the same request id. */
  private async ask(req: HistoryRequest): Promise<Reply> {
    const requestId = `r${this.nextRequest++}`
    const answer = new Promise<Reply>((resolve, reject) => this.waiting.set(requestId, { resolve, reject }))
    try {
      await this.request({ ...req, requestId } as SidecarRequest)
    } catch (e) {
      this.waiting.delete(requestId)
      throw e
    }
    const reply = await answer
    if (reply.type === 'requestDone' && reply.error) throw new Error(reply.error)
    return reply
  }

  private settle(reply: Reply) {
    const w = this.waiting.get(reply.requestId)
    this.waiting.delete(reply.requestId)
    w?.resolve(reply)
  }

  /** The sidecar is gone: nothing it was asked will be answered. */
  private failWaiting(reason: string) {
    for (const w of this.waiting.values()) w.reject(new Error(reason))
    this.waiting.clear()
  }

  async listChats(cwd?: string, allFolders = false): Promise<ChatSummary[]> {
    const r = await this.ask({ type: 'listChats', cwd, allFolders })
    return r.type === 'chatList' ? r.chats : []
  }

  async loadChat(sessionId: string, cwd?: string): Promise<HistoryItem[]> {
    const r = await this.ask({ type: 'loadChat', sessionId, cwd })
    return r.type === 'chatHistory' ? r.items : []
  }

  async renameChat(sessionId: string, title: string, cwd?: string) {
    await this.ask({ type: 'renameChat', sessionId, title, cwd })
  }

  async deleteChat(sessionId: string, cwd?: string) {
    await this.ask({ type: 'deleteChat', sessionId, cwd })
  }

  abort(turnId: string) {
    return this.request({ type: 'abort', turnId })
  }

  respondToPermission(requestId: string, decision: PermissionDecision) {
    return this.request({ type: 'permissionResponse', requestId, decision })
  }

  async restart() {
    this.failWaiting('the agent was restarted')
    this.pid = await invoke<number>('sidecar_restart')
    this.dispatch({ type: 'connected' })
    await this.refreshStatus()
  }
}
