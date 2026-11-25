// Chat state: one conversation with the agent, plus connection/install/login status,
// the history of past chats in the current folder, and the model/effort choice.
//
// A turn shows up as a sequence of messages: text, a tool call, more text, a permission
// card, and so on, in the order they happened. File-change events are passed on to
// listeners (the review store) instead of being shown.

import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type {
  AgentEvent,
  AgentProvider,
  AttachmentPreview,
  AuthStatus,
  ChatSummary,
  CliStatus,
  EffortLevel,
  HistoryItem,
  ModelOption,
  PermissionDecision,
  TurnOutcome,
} from '../agent/types'
import { LIMITS, formatSize, isImage, readAttachment, type DraftAttachment } from '../chat/attachments'
import { formatPrompt, parsePrompt, sameRef, type CodeRef } from '../chat/refs'
import { joinPath, samePath } from '../workspace/fs'

export type ToolStatus = 'running' | 'done' | 'error'
export type PermissionState = 'pending' | 'allowed' | 'allowedForChat' | 'denied' | 'cancelled'

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant' | 'error' | 'tool' | 'permission'
  text: string
  turnId?: string
  /** assistant: set on the turn's last text segment when the turn ends. `model` is the model id it ran on. */
  done?: { outcome: TurnOutcome; durationMs: number; costUsd?: number; model?: string }
  /** user: code the message refers to (shown as chips). */
  refs?: CodeRef[]
  /** user: files sent with the message (images keep their data, for a thumbnail). */
  attachments?: AttachmentPreview[]
  /** tool: a tool call. */
  tool?: { id: string; name: string; summary: string; status: ToolStatus }
  /** permission: a request for the user's OK. */
  permission?: { requestId: string; toolName: string; summary: string; detail?: string; state: PermissionState }
}

export type FileEvent = Extract<AgentEvent, { type: 'fileWillChange' | 'fileChanged' }>

export type Connection = 'connecting' | 'connected' | 'disconnected'

let nextId = 1

/** Remembered choices (fine if storage is unavailable, e.g. in tests). */
function load(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function save(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* not persisted */
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

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
  /** Folder the agent works in (Claude Code keeps sessions per folder). Null = a chat without a folder. */
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
  /** The model each running turn uses (from `turnStarted`), for its summary line. */
  const turnModels = new Map<string, string>()

  // Model and effort. The list comes from Claude Code (it depends on the account).
  // "default" is Claude Code's own default, which follows the user's settings.
  const models = ref<ModelOption[]>([])
  const model = ref(load('tinkr.model') ?? 'default')
  const effort = ref<EffortLevel | null>((load('tinkr.effort') as EffortLevel | null) ?? null)
  /** The picked model, or the default one if the pick is no longer offered. */
  const modelOption = computed(
    () => models.value.find((m) => m.value === model.value) ?? models.value.find((m) => m.value === 'default') ?? null,
  )
  const effortLevels = computed(() => modelOption.value?.efforts ?? [])
  /** The effort sent with a message: null (the model's default) if the picked level isn't offered. */
  const effectiveEffort = computed(() => (effort.value && effortLevels.value.includes(effort.value) ? effort.value : null))

  /** Files waiting in the composer, sent with the next message. */
  const draftAttachments = ref<DraftAttachment[]>([])
  /** Why the last files couldn't be attached (shown in the composer until the next try). */
  const attachError = ref('')

  // History: past chats in the current folder (or the chats without one), or with
  // `allFolders` every chat Claude Code has stored, from any tool and folder.
  const chats = ref<ChatSummary[]>([])
  const allFolders = ref(load('tinkr.allFolders') === '1')
  const chatsError = ref('')
  /** A past chat is being loaded into the view. */
  const openingChat = ref(false)
  /** Bumped when the folder changes, so a slow answer about the old folder is dropped. */
  let chatsGeneration = 0

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
  const canSend = computed(() => !blocker.value && !busy.value && !openingChat.value)
  /**
   * The reply text still arriving: the newest message, if it's Claude's text in the
   * running turn. Only that one shows the typing cursor. Earlier text of the same turn
   * (before a tool call), replies loaded from history and turns cut off by a crash have
   * no cursor, though none of them has a `done` marker.
   */
  const streamingId = computed(() => {
    const last = messages.value.at(-1)
    return last?.role === 'assistant' && !last.done && last.turnId !== undefined && last.turnId === activeTurnId.value ? last.id : null
  })
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
        models.value = e.models
        if (e.cli.state === 'ok' && e.auth.state !== 'signedOut') void refreshChats()
        break
      case 'turnStarted':
        sessionId.value = e.sessionId
        turnModels.set(e.turnId, e.model)
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
        target.done = { outcome: e.outcome, durationMs: e.durationMs, costUsd: e.costUsd, model: turnModels.get(e.turnId) }
        turnModels.delete(e.turnId)
        if (e.outcome === 'error') push({ role: 'error', text: e.message ?? 'The turn failed.', turnId: e.turnId })
        addLog(`turn ${e.turnId} ${e.outcome} in ${e.durationMs} ms`)
        void refreshChats() // a new chat appears in the list; a continued one moves to the top
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

  /** Send a message (with any code references and files in the composer). Returns false if nothing was sent. */
  async function send(text: string) {
    const trimmed = text.trim()
    const refs = draftRefs.value
    const files = draftAttachments.value
    if ((!trimmed && !refs.length && !files.length) || !canSend.value || !provider.value) return false
    push({
      role: 'user',
      text: trimmed,
      refs: refs.length ? refs : undefined,
      attachments: files.length
        ? files.map((f) => ({ name: f.name, mediaType: f.mediaType, data: isImage(f.mediaType) ? f.data : undefined }))
        : undefined,
    })
    draftRefs.value = []
    draftAttachments.value = []
    attachError.value = ''
    const picked = modelOption.value
    try {
      // Mark busy before awaiting so a double Enter can't send twice.
      activeTurnId.value = 'pending'
      const turnId = await provider.value.send(sessionId.value, formatPrompt(trimmed, refs), {
        cwd: projectRoot.value ?? undefined,
        model: picked && picked.value !== 'default' ? picked.value : undefined,
        effort: effectiveEffort.value ?? undefined,
        attachments: files.length ? files.map(({ name, mediaType, data }) => ({ name, mediaType, data })) : undefined,
      })
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

  function setModel(value: string) {
    model.value = value
    save('tinkr.model', value === 'default' ? null : value)
  }

  function setEffort(value: EffortLevel | null) {
    effort.value = value
    save('tinkr.effort', value)
  }

  /** Read files into the composer. Files that can't be attached are skipped, with a message. */
  async function addAttachments(files: Iterable<Blob & { name?: string }>) {
    const problems: string[] = []
    for (const file of files) {
      try {
        const a = await readAttachment(file)
        const total = draftAttachments.value.reduce((n, x) => n + x.size, a.size)
        if (total > LIMITS.total) throw new Error(`${a.name} would make this message's files larger than ${formatSize(LIMITS.total)}.`)
        draftAttachments.value.push(a)
      } catch (e) {
        problems.push(errorText(e))
      }
    }
    attachError.value = problems.join(' ')
    focusRequests.value++
  }

  function removeAttachment(id: number) {
    draftAttachments.value = draftAttachments.value.filter((a) => a.id !== id)
    attachError.value = ''
  }

  const cwdArg = () => projectRoot.value ?? undefined

  /** Does a chat in `folder` (null = no folder) belong to the folder open now? */
  const isHere = (folder: string | null) =>
    folder === null || projectRoot.value === null ? folder === projectRoot.value : samePath(folder, projectRoot.value)

  /** The folder to name in a request about chat `id`: its own (from the list), else the current one. */
  function folderArg(id: string) {
    const c = chats.value.find((x) => x.sessionId === id)
    return c ? (c.folder ?? undefined) : cwdArg()
  }

  /** Reload the history list (the current folder's, or all folders'). */
  async function refreshChats() {
    if (!provider.value) return
    const generation = chatsGeneration
    try {
      const list = await provider.value.listChats(cwdArg(), allFolders.value)
      if (generation !== chatsGeneration) return
      chats.value = list
      chatsError.value = ''
    } catch (e) {
      if (generation === chatsGeneration) chatsError.value = `Couldn't list past chats: ${errorText(e)}`
    }
  }

  /** History rows as chat messages: references come back as chips, attachments as previews. */
  function historyMessages(items: HistoryItem[]): ChatMessage[] {
    const root = projectRoot.value
    const toAbsolute = root ? (rel: string) => joinPath(root, root.includes('\\') ? rel.replaceAll('/', '\\') : rel) : undefined
    return items.map((item): ChatMessage => {
      const id = nextId++
      if (item.kind === 'user') {
        const { text, refs } = parsePrompt(item.text, toAbsolute)
        return { id, role: 'user', text, refs: refs.length ? refs : undefined, attachments: item.attachments.length ? item.attachments : undefined }
      }
      if (item.kind === 'assistant') return { id, role: 'assistant', text: item.text }
      return { id, role: 'tool', text: '', tool: { id: item.toolUseId, name: item.name, summary: item.summary, status: item.isError ? 'error' : 'done' } }
    })
  }

  function setAllFolders(value: boolean) {
    allFolders.value = value
    save('tinkr.allFolders', value ? '1' : null)
    chatsGeneration++ // a list still loading is for the other view
    void refreshChats()
  }

  /**
   * Show a past chat of the current folder; the next message continues it. Returns false
   * if it couldn't be opened. A chat from another folder (in the all-folders list) needs
   * that folder opened first, which the app does (see `openChatIn` in App.vue).
   */
  async function openChat(id: string) {
    if (busy.value || openingChat.value || !provider.value) return false
    if (id === sessionId.value) return true
    const listed = chats.value.find((c) => c.sessionId === id)
    if (listed && !isHere(listed.folder)) return false
    const generation = chatsGeneration
    openingChat.value = true
    try {
      const items = await provider.value.loadChat(id, cwdArg())
      if (generation !== chatsGeneration) return false // the folder changed meanwhile
      messages.value = historyMessages(items)
      sessionId.value = id
      chatsError.value = ''
      return true
    } catch (e) {
      chatsError.value = `Couldn't open that chat: ${errorText(e)}`
      return false
    } finally {
      openingChat.value = false
    }
  }

  async function renameChat(id: string, title: string) {
    if (!provider.value || !title.trim()) return
    try {
      await provider.value.renameChat(id, title.trim(), folderArg(id))
    } catch (e) {
      chatsError.value = `Couldn't rename that chat: ${errorText(e)}`
      return
    }
    await refreshChats()
  }

  /** Delete a past chat for good (Claude Code's transcript too). Not while it's replying. */
  async function deleteChat(id: string) {
    if (!provider.value || (busy.value && id === sessionId.value)) return
    try {
      await provider.value.deleteChat(id, folderArg(id))
    } catch (e) {
      chatsError.value = `Couldn't delete that chat: ${errorText(e)}`
      return
    }
    if (id === sessionId.value) {
      messages.value = []
      sessionId.value = null
    }
    await refreshChats()
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

  /**
   * Switch the folder the agent works in. Conversations don't carry across folders.
   * Everything changes before the first `await`, so a second call for the same folder
   * (the app's folder watcher and `openChatIn` can both make one) sees it done and returns.
   */
  async function setProject(root: string | null) {
    if (root === projectRoot.value) return
    // A reply still running belongs to the old folder's chat: stop it and ignore its events.
    const running = activeTurnId.value
    if (running) staleTurns.add(running)
    activeTurnId.value = null
    projectRoot.value = root
    messages.value = []
    draftRefs.value = []
    sessionId.value = null
    chatsGeneration++
    if (!allFolders.value) chats.value = [] // the all-folders list stays the same
    chatsError.value = ''
    if (running && running !== 'pending') await provider.value?.abort(running)
    await refreshChats()
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
    models, model, effort, modelOption, effortLevels, effectiveEffort, draftAttachments, attachError, chats, chatsError, openingChat,
    allFolders, isHere,
    blocker, busy, canSend, pendingPermissions, streamingId,
    connect, send, stop, respondToPermission, addRef, removeRef, onFileEvent, newChat, setProject, restart, recheck,
    setModel, setEffort, addAttachments, removeAttachment, refreshChats, setAllFolders, openChat, renameChat, deleteChat,
  }
})
