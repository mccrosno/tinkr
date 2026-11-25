// Chat state: one conversation with the agent, plus connection/install/login status.

import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { AgentEvent, AgentProvider, AuthStatus, CliStatus, TurnOutcome } from '../agent/types'

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant' | 'error'
  text: string
  turnId?: string
  done?: { outcome: TurnOutcome; durationMs: number; costUsd?: number }
}

export type Connection = 'connecting' | 'connected' | 'disconnected'

let nextId = 1

export const useChat = defineStore('chat', () => {
  const provider = shallowRef<AgentProvider | null>(null)
  const connection = ref<Connection>('connecting')
  const disconnectReason = ref('')
  const cli = ref<CliStatus | null>(null)
  const auth = ref<AuthStatus | null>(null)
  const messages = ref<ChatMessage[]>([])
  /** Agent-side conversation id; null until the first turn of a chat starts. */
  const sessionId = ref<string | null>(null)
  const activeTurnId = ref<string | null>(null)
  const log = ref<string[]>([])
  /** Turns that already finished; a turn can finish before `send()` returns its id. */
  const finishedTurns = new Set<string>()

  /** Why sending is blocked right now, or null if it isn't. */
  const blocker = computed<string | null>(() => {
    if (connection.value === 'connecting') return 'Starting the agent…'
    if (connection.value === 'disconnected') return 'The agent process stopped.'
    if (!cli.value) return 'Checking for Claude Code…'
    if (cli.value.state !== 'ok') return 'Claude Code needs attention.'
    if (auth.value?.state === 'signedOut') return 'Not signed in to Claude Code.'
    return null
  })
  const busy = computed(() => activeTurnId.value !== null)
  const canSend = computed(() => !blocker.value && !busy.value)

  function addLog(line: string) {
    log.value.push(`${new Date().toLocaleTimeString()}  ${line}`)
    if (log.value.length > 300) log.value.splice(0, log.value.length - 300)
  }

  function assistantFor(turnId: string) {
    let m = messages.value.findLast((x) => x.role === 'assistant' && x.turnId === turnId)
    if (!m) {
      messages.value.push({ id: nextId++, role: 'assistant', text: '', turnId })
      m = messages.value[messages.value.length - 1]
    }
    return m
  }

  function handle(e: AgentEvent) {
    switch (e.type) {
      case 'connected':
        connection.value = 'connected'
        disconnectReason.value = ''
        break
      case 'disconnected':
        connection.value = 'disconnected'
        disconnectReason.value = e.reason
        activeTurnId.value = null
        addLog(e.reason)
        break
      case 'status':
        cli.value = e.cli
        auth.value = e.auth
        break
      case 'turnStarted':
        sessionId.value = e.sessionId
        addLog(`turn ${e.turnId} started on ${e.model}`)
        break
      case 'text':
        assistantFor(e.turnId).text += e.text
        break
      case 'turnFinished': {
        if (e.sessionId) sessionId.value = e.sessionId
        finishedTurns.add(e.turnId)
        if (activeTurnId.value === e.turnId) activeTurnId.value = null
        const m = messages.value.findLast((x) => x.role === 'assistant' && x.turnId === e.turnId)
        if (m) m.done = { outcome: e.outcome, durationMs: e.durationMs, costUsd: e.costUsd }
        if (e.outcome === 'error') messages.value.push({ id: nextId++, role: 'error', text: e.message ?? 'The turn failed.', turnId: e.turnId })
        addLog(`turn ${e.turnId} ${e.outcome} in ${e.durationMs} ms`)
        break
      }
      case 'log':
        addLog(e.message)
        break
    }
  }

  async function connect(p: AgentProvider) {
    provider.value = p
    p.onEvent(handle)
    try {
      await p.connect()
    } catch (e) {
      handle({ type: 'disconnected', reason: String(e) })
    }
  }

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || !canSend.value || !provider.value) return false
    messages.value.push({ id: nextId++, role: 'user', text: trimmed })
    try {
      // Mark busy before awaiting so a double Enter can't send twice.
      activeTurnId.value = 'pending'
      const turnId = await provider.value.send(sessionId.value, trimmed)
      activeTurnId.value = finishedTurns.has(turnId) ? null : turnId
    } catch (e) {
      activeTurnId.value = null
      messages.value.push({ id: nextId++, role: 'error', text: String(e) })
    }
    return true
  }

  async function stop() {
    if (activeTurnId.value && activeTurnId.value !== 'pending') await provider.value?.abort(activeTurnId.value)
  }

  function newChat() {
    if (busy.value) return
    messages.value = []
    sessionId.value = null
  }

  async function restart() {
    connection.value = 'connecting'
    cli.value = null
    auth.value = null
    try {
      await provider.value?.restart()
    } catch (e) {
      handle({ type: 'disconnected', reason: String(e) })
    }
  }

  async function recheck() {
    cli.value = null
    await provider.value?.refreshStatus()
  }

  return {
    connection, disconnectReason, cli, auth, messages, sessionId, activeTurnId, log,
    blocker, busy, canSend,
    connect, send, stop, newChat, restart, recheck,
  }
})
