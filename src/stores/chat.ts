// Chat state: one conversation with the agent, plus connection/install/login status.
//
// A turn shows up as a sequence of messages: text, a tool call, more text, a permission
// card, and so on, in the order they happened. File-change events are passed on to
// listeners (the review store) instead of being shown.

import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { AgentEvent, AgentProvider, AuthStatus, CliStatus, PermissionDecision, TurnOutcome } from '../agent/types'
import { formatPrompt, sameRef, type CodeRef } from '../chat/refs'

export type ToolStatus = 'running' | 'done' | 'error'
export type PermissionState = 'pending' | 'allowed' | 'allowedForChat' | 'denied' | 'cancelled'

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant' | 'error' | 'tool' | 'permission'
  text: string
  turnId?: string
  /** assistant: set on the turn's last text segment when the turn ends. */
  done?: { outcome: TurnOutcome; durationMs: number; costUsd?: number }
  /** user: code the message refers to (shown as chips). */
  refs?: CodeRef[]
  /** tool: a tool call. */
  tool?: { id: string; name: string; summary: string; status: ToolStatus }
  /** permission: a request for the user's OK. */
  permission?: { requestId: string; toolName: string; summary: string; detail?: string; state: PermissionState }
}

export type FileEvent = Extract<AgentEvent, { type: 'fileWillChange' | 'fileChanged' }>

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
  /** Folder the agent works in (Claude Code keeps sessions per folder). Null = home folder. */
  const projectRoot = ref<string | null>(null)
  /** Code references waiting in the composer, sent with the next message. */
  const draftRefs = ref<CodeRef[]>([])
  /** Bumped to ask the chat view to focus its input (e.g. after "Ask Claude"). */
  const focusRequests = ref(0)
  /** Turns that already finished; a turn can finish before `send()` returns its id. */
  const finishedTurns = new Set<string>()
  /** Turns from a chat that was replaced (folder switch); their late events are dropped. */
  const staleTurns = new Set<string>()
  const fileListeners = new Set<(e: FileEvent) => void>()

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
  const pendingPermissions = computed(() => messages.value.filter((m) => m.permission?.state === 'pending').length)

  function addLog(line: string) {
    log.value.push(`${new Date().toLocaleTimeString()}  ${line}`)
    if (log.value.length > 300) log.value.splice(0, log.value.length - 300)
  }

  const push = (m: Omit<ChatMessage, 'id'>) => {
    messages.value.push({ id: nextId++, ...m })
    return messages.value[messages.value.length - 1] // the reactive copy
  }

  /** The text segment to append to: the turn's latest message if it's text, else a new one. */
  function assistantFor(turnId: string) {
    const last = messages.value.findLast((x) => x.turnId === turnId)
    return last?.role === 'assistant' ? last : push({ role: 'assistant', text: '', turnId })
  }

  const toolMessage = (id: string) => messages.value.findLast((m) => m.tool?.id === id)
  const permissionMessage = (id: string) => messages.value.findLast((m) => m.permission?.requestId === id)

  function handle(e: AgentEvent) {
    if ('turnId' in e && staleTurns.has(e.turnId)) return
    switch (e.type) {
      case 'connected':
        connection.value = 'connected'
        disconnectReason.value = ''
        break
      case 'disconnected':
        connection.value = 'disconnected'
        disconnectReason.value = e.reason
        if (activeTurnId.value) settleTurn(activeTurnId.value)
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
      case 'toolUse':
        push({ role: 'tool', text: '', turnId: e.turnId, tool: { id: e.toolUseId, name: e.name, summary: e.summary, status: 'running' } })
        break
      case 'toolResult': {
        const m = toolMessage(e.toolUseId)
        if (m?.tool) m.tool.status = e.isError ? 'error' : 'done'
        break
      }
      case 'permissionRequest':
        push({
          role: 'permission',
          text: '',
          turnId: e.turnId,
          permission: { requestId: e.requestId, toolName: e.toolName, summary: e.summary, detail: e.detail, state: 'pending' },
        })
        break
      case 'permissionCancelled': {
        const m = permissionMessage(e.requestId)
        if (m?.permission?.state === 'pending') m.permission.state = 'cancelled'
        break
      }
      case 'fileWillChange':
      case 'fileChanged':
        for (const l of fileListeners) l(e)
        break
      case 'turnFinished': {
        if (e.sessionId) sessionId.value = e.sessionId
        finishedTurns.add(e.turnId)
        if (activeTurnId.value === e.turnId) activeTurnId.value = null
        settleTurn(e.turnId)
        // The turn's summary line goes under its last text (a new empty one if it had none).
        const lastText = messages.value.findLast((x) => x.role === 'assistant' && x.turnId === e.turnId)
        const target = lastText && messages.value[messages.value.length - 1] === lastText ? lastText : push({ role: 'assistant', text: '', turnId: e.turnId })
        target.done = { outcome: e.outcome, durationMs: e.durationMs, costUsd: e.costUsd }
        if (e.outcome === 'error') push({ role: 'error', text: e.message ?? 'The turn failed.', turnId: e.turnId })
        addLog(`turn ${e.turnId} ${e.outcome} in ${e.durationMs} ms`)
        break
      }
      case 'log':
        addLog(e.message)
        break
    }
  }

  /** A turn ended: nothing of it is running or waiting any more. */
  function settleTurn(turnId: string) {
    for (const m of messages.value) {
      if (m.turnId !== turnId) continue
      if (m.tool?.status === 'running') m.tool.status = 'done'
      if (m.permission?.state === 'pending') m.permission.state = 'cancelled'
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

  /** Send a message (with any code references in the composer). Returns false if nothing was sent. */
  async function send(text: string) {
    const trimmed = text.trim()
    const refs = draftRefs.value
    if ((!trimmed && !refs.length) || !canSend.value || !provider.value) return false
    push({ role: 'user', text: trimmed, refs: refs.length ? refs : undefined })
    draftRefs.value = []
    try {
      // Mark busy before awaiting so a double Enter can't send twice.
      activeTurnId.value = 'pending'
      const turnId = await provider.value.send(sessionId.value, formatPrompt(trimmed, refs), { cwd: projectRoot.value ?? undefined })
      activeTurnId.value = finishedTurns.has(turnId) ? null : turnId
    } catch (e) {
      activeTurnId.value = null
      push({ role: 'error', text: String(e) })
    }
    return true
  }

  async function stop() {
    if (activeTurnId.value && activeTurnId.value !== 'pending') await provider.value?.abort(activeTurnId.value)
  }

  async function respondToPermission(requestId: string, decision: PermissionDecision) {
    const m = permissionMessage(requestId)
    if (!m?.permission || m.permission.state !== 'pending') return
    m.permission.state = decision === 'allow' ? 'allowed' : decision === 'allowForChat' ? 'allowedForChat' : 'denied'
    await provider.value?.respondToPermission(requestId, decision)
  }

  /** Add a code reference to the composer and focus it ("Ask Claude" / "Request changes"). */
  function addRef(r: CodeRef) {
    if (!draftRefs.value.some((x) => sameRef(x, r))) draftRefs.value.push(r)
    else draftRefs.value = draftRefs.value.map((x) => (sameRef(x, r) ? r : x)) // same lines: take the new purpose
    focusRequests.value++
  }

  function removeRef(index: number) {
    draftRefs.value.splice(index, 1)
  }

  function onFileEvent(listener: (e: FileEvent) => void) {
    fileListeners.add(listener)
    return () => fileListeners.delete(listener)
  }

  function newChat() {
    if (busy.value) return
    messages.value = []
    sessionId.value = null
  }

  /** Switch the folder the agent works in. Conversations don't carry across folders. */
  async function setProject(root: string | null) {
    if (root === projectRoot.value) return
    // A reply still running belongs to the old folder's chat: stop it and ignore its events.
    if (activeTurnId.value) staleTurns.add(activeTurnId.value)
    await stop()
    activeTurnId.value = null
    projectRoot.value = root
    messages.value = []
    draftRefs.value = []
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
    connection, disconnectReason, cli, auth, messages, sessionId, activeTurnId, log, projectRoot, draftRefs, focusRequests,
    blocker, busy, canSend, pendingPermissions,
    connect, send, stop, respondToPermission, addRef, removeRef, onFileEvent, newChat, setProject, restart, recheck,
  }
})
