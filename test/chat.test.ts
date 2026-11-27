import { beforeEach, describe, expect, test } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'
import type { AgentEvent, AgentProvider, ChatSummary, HistoryItem, ModelOption, PermissionDecision, SendOptions } from '../src/agent/types'
import { formatPrompt, parsePrompt, type CodeRef } from '../src/chat/refs'
import type { FileEvent } from '../src/stores/chat'
import { toAgentEvent } from '../src/agent/claudeSidecar'
import { useChat } from '../src/stores/chat'
import { usePlugins } from '../src/stores/plugins'

/** A provider the test drives by hand. */
class FakeProvider implements AgentProvider {
  id = 'fake'
  label = 'Fake'
  sent: ({ sessionId: string | null; text: string; turnId: string } & SendOptions)[] = []
  /** History the fake "stores", per folder (undefined cwd = chats without a folder). */
  chats = new Map<string | undefined, ChatSummary[]>()
  transcripts = new Map<string, HistoryItem[]>()
  historyCalls: string[] = []
  aborted: string[] = []
  answers: [string, PermissionDecision][] = []
  pluginAnswers: [string, { text: string; isError: boolean }][] = []
  private listener: (e: AgentEvent) => void = () => {}
  private n = 0
  emit(e: AgentEvent) {
    this.listener(e)
  }
  onEvent(l: (e: AgentEvent) => void) {
    this.listener = l
    return () => {}
  }
  async connect() {
    this.emit({ type: 'connected' })
    this.emit({ type: 'status', cli: { state: 'ok', path: '/claude', version: '2.1.331' }, auth: { state: 'subscription', plan: 'Claude Pro' }, models: MODELS })
  }
  async refreshStatus() {}
  async send(sessionId: string | null, text: string, options: SendOptions = {}) {
    const turnId = `turn${++this.n}`
    this.sent.push({ sessionId, text, turnId, ...options })
    return turnId
  }
  async listChats(cwd?: string, allFolders = false) {
    this.historyCalls.push(allFolders ? 'list all' : `list ${cwd ?? '-'}`)
    return allFolders ? [...this.chats.values()].flat() : (this.chats.get(cwd) ?? [])
  }
  async loadChat(sessionId: string, cwd?: string) {
    this.historyCalls.push(`load ${sessionId} ${cwd ?? '-'}`)
    const items = this.transcripts.get(sessionId)
    if (!items) throw new Error('no such chat')
    return items
  }
  async renameChat(sessionId: string, title: string, cwd?: string) {
    this.historyCalls.push(`rename ${sessionId} ${title} ${cwd ?? '-'}`)
    const c = this.chats.get(cwd)?.find((x) => x.sessionId === sessionId)
    if (c) c.title = title
  }
  async deleteChat(sessionId: string, cwd?: string) {
    this.historyCalls.push(`delete ${sessionId} ${cwd ?? '-'}`)
    this.chats.set(cwd, (this.chats.get(cwd) ?? []).filter((x) => x.sessionId !== sessionId))
  }
  async abort(turnId: string) {
    this.aborted.push(turnId)
  }
  async respondToPermission(requestId: string, decision: PermissionDecision) {
    this.answers.push([requestId, decision])
  }
  async respondToPluginRequest(requestId: string, report: { text: string; isError: boolean }) {
    this.pluginAnswers.push([requestId, report])
  }
  async restart() {}
}

const MODELS: ModelOption[] = [
  { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: '', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: '', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'claude-haiku-4-5-20251001', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', description: '', efforts: [] },
]

let fake: FakeProvider
let chat: ReturnType<typeof useChat>

beforeEach(async () => {
  setActivePinia(createPinia())
  chat = useChat()
  fake = new FakeProvider()
  await chat.connect(fake)
})

describe('plugin authoring', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0))

  test('messages carry the plugins folder once it is known', async () => {
    usePlugins().dir = '/home/me/.config/tinkr/plugins'
    await chat.send('make a plugin')
    expect(fake.sent[0].pluginsDir).toBe('/home/me/.config/tinkr/plugins')
  })

  test('a plugin request is done by the handler and answered, errors included', async () => {
    chat.setPluginRequestHandler(async (action, name) => {
      if (name === 'bad') throw new Error('exploded')
      return { text: `${action} ${name}`, isError: false }
    })
    fake.emit({ type: 'pluginRequest', turnId: 't', requestId: 'g1', action: 'reload', name: 'notes' })
    fake.emit({ type: 'pluginRequest', turnId: 't', requestId: 'g2', action: 'status', name: 'bad' })
    await tick()
    expect(fake.pluginAnswers).toEqual([
      ['g1', { text: 'reload notes', isError: false }],
      ['g2', { text: "Tinkr couldn't do that: exploded", isError: true }],
    ])
  })

  test('without a handler the agent still gets an answer', async () => {
    fake.emit({ type: 'pluginRequest', turnId: 't', requestId: 'g1', action: 'reload', name: 'notes' })
    await tick()
    expect(fake.pluginAnswers[0][1].isError).toBe(true)
  })

  test('a permission card knows it is about a plugin', async () => {
    await chat.send('go')
    fake.emit({ type: 'permissionRequest', turnId: 'turn1', requestId: 'p1', toolName: 'Write', summary: 'notes/index.js', pluginEdit: { plugin: 'notes' } })
    expect(chat.messages.at(-1)?.permission?.pluginEdit).toEqual({ plugin: 'notes' })
  })
})

describe('chat store', () => {
  test('ready to send once the CLI is ok and signed in', () => {
    expect(chat.blocker).toBeNull()
    expect(chat.canSend).toBe(true)
  })

  test('streams a reply and remembers the session for the next message', async () => {
    await chat.send('hello')
    expect(chat.busy).toBe(true)
    fake.emit({ type: 'turnStarted', turnId: 'turn1', sessionId: 's1', model: 'm' })
    fake.emit({ type: 'text', turnId: 'turn1', text: 'Hi ' })
    fake.emit({ type: 'text', turnId: 'turn1', text: 'there' })
    fake.emit({ type: 'turnFinished', turnId: 'turn1', sessionId: 's1', outcome: 'success', durationMs: 900, costUsd: 0.01 })
    expect(chat.busy).toBe(false)
    expect(chat.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'hello'],
      ['assistant', 'Hi there'],
    ])
    await chat.send('again')
    expect(fake.sent[1].sessionId).toBe('s1')
  })

  test('only the text still arriving shows the typing cursor', async () => {
    await chat.send('hello')
    fake.emit({ type: 'text', turnId: 'turn1', text: 'Let me look.' })
    const first = chat.messages.at(-1)!.id
    expect(chat.streamingId).toBe(first)
    // A tool call: the text before it is finished, and nothing is streaming until more text comes.
    fake.emit({ type: 'toolUse', turnId: 'turn1', toolUseId: 'u1', name: 'Read', summary: 'a.ts' })
    expect(chat.streamingId).toBeNull()
    fake.emit({ type: 'text', turnId: 'turn1', text: 'Found it.' })
    expect(chat.streamingId).not.toBe(first)
    fake.emit({ type: 'turnFinished', turnId: 'turn1', sessionId: 's1', outcome: 'success', durationMs: 1 })
    expect(chat.streamingId).toBeNull()

    // A reply cut off by a crash has no `done`, but no cursor either.
    await chat.send('again')
    fake.emit({ type: 'text', turnId: 'turn2', text: 'partial' })
    fake.emit({ type: 'disconnected', reason: 'crashed' })
    expect(chat.streamingId).toBeNull()

    // Nor do replies loaded from history.
    fake.emit({ type: 'connected' })
    fake.transcripts.set('old', [{ kind: 'user', text: 'q', attachments: [] }, { kind: 'assistant', text: 'a' }])
    await chat.openChat('old')
    expect(chat.streamingId).toBeNull()
  })

  test('cannot send twice while a turn runs', async () => {
    await chat.send('one')
    expect(await chat.send('two')).toBe(false)
    expect(fake.sent).toHaveLength(1)
  })

  test('a turn that finishes before send() returns does not stay busy', async () => {
    const original = fake.send.bind(fake)
    fake.send = async (s, t) => {
      const id = await original(s, t)
      fake.emit({ type: 'turnFinished', turnId: id, sessionId: null, outcome: 'error', durationMs: 1, message: 'nope' })
      return id
    }
    await chat.send('x')
    expect(chat.busy).toBe(false)
    expect(chat.messages.at(-1)).toMatchObject({ role: 'error', text: 'nope' })
  })

  test('stop aborts the running turn', async () => {
    await chat.send('long')
    await chat.stop()
    expect(fake.aborted).toEqual(['turn1'])
  })

  test('new chat forgets the session', async () => {
    await chat.send('a')
    fake.emit({ type: 'turnFinished', turnId: 'turn1', sessionId: 's1', outcome: 'success', durationMs: 1 })
    chat.newChat()
    expect(chat.messages).toHaveLength(0)
    expect(chat.sessionId).toBeNull()
  })

  test('turns run in the open project folder', async () => {
    await chat.setProject('/proj')
    await chat.send('hi')
    expect(fake.sent[0].cwd).toBe('/proj')
  })

  test('switching folders stops the running reply and starts a fresh chat', async () => {
    await chat.setProject('/a')
    await chat.send('long')
    fake.emit({ type: 'turnStarted', turnId: 'turn1', sessionId: 's1', model: 'm' })
    await chat.setProject('/b')
    expect(fake.aborted).toEqual(['turn1'])
    expect(chat.messages).toHaveLength(0)
    expect(chat.sessionId).toBeNull()
    expect(chat.busy).toBe(false)
    // Late events from the old folder's turn don't leak into the new chat.
    fake.emit({ type: 'text', turnId: 'turn1', text: 'late' })
    fake.emit({ type: 'turnFinished', turnId: 'turn1', sessionId: 's1', outcome: 'aborted', durationMs: 5 })
    expect(chat.messages).toHaveLength(0)
    expect(chat.sessionId).toBeNull()
  })

  test('blocked when signed out or the agent stops', () => {
    fake.emit({ type: 'status', cli: { state: 'ok', path: '/c', version: '2.1.331' }, auth: { state: 'signedOut' }, models: [] })
    expect(chat.blocker).toMatch(/signed in/i)
    fake.emit({ type: 'disconnected', reason: 'crashed' })
    expect(chat.blocker).toMatch(/stopped/i)
    expect(chat.canSend).toBe(false)
  })
})

describe('toAgentEvent', () => {
  test('maps sidecar deltas to text events', () => {
    expect(toAgentEvent({ type: 'textDelta', turnId: 't', text: 'x' })).toEqual({ type: 'text', turnId: 't', text: 'x' })
  })
})

describe('tools, permissions and file events', () => {
  test('text after a tool call starts a new segment; the summary goes on the last one', async () => {
    await chat.send('fix it')
    fake.emit({ type: 'text', turnId: 'turn1', text: 'Looking.' })
    fake.emit({ type: 'toolUse', turnId: 'turn1', toolUseId: 'u1', name: 'Edit', summary: 'src/a.ts' })
    expect(chat.messages.at(-1)?.tool).toEqual({ id: 'u1', name: 'Edit', summary: 'src/a.ts', status: 'running' })
    fake.emit({ type: 'toolResult', turnId: 'turn1', toolUseId: 'u1', isError: false })
    fake.emit({ type: 'text', turnId: 'turn1', text: 'Done.' })
    fake.emit({ type: 'turnFinished', turnId: 'turn1', sessionId: 's1', outcome: 'success', durationMs: 5 })
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(chat.messages[1].text).toBe('Looking.')
    expect(chat.messages[2].tool?.status).toBe('done')
    expect(chat.messages[3].text).toBe('Done.')
    expect(chat.messages[1].done).toBeUndefined()
    expect(chat.messages[3].done?.outcome).toBe('success')
  })

  test('a turn that ends on a tool call still gets a summary line', async () => {
    await chat.send('run it')
    fake.emit({ type: 'toolUse', turnId: 'turn1', toolUseId: 'u1', name: 'Bash', summary: 'ls' })
    fake.emit({ type: 'turnFinished', turnId: 'turn1', sessionId: 's1', outcome: 'aborted', durationMs: 5 })
    expect(chat.messages.at(-1)?.role).toBe('assistant')
    expect(chat.messages.at(-1)?.done?.outcome).toBe('aborted')
    expect(chat.messages[1].tool?.status).toBe('done') // nothing left "running"
  })

  test('permission requests: answering records the choice and tells the provider', async () => {
    await chat.send('install it')
    fake.emit({ type: 'permissionRequest', turnId: 'turn1', requestId: 'p1', toolName: 'Bash', summary: 'npm i', detail: 'npm i' })
    expect(chat.pendingPermissions).toBe(1)
    await chat.respondToPermission('p1', 'allowForChat')
    expect(chat.messages.at(-1)?.permission?.state).toBe('allowedForChat')
    expect(fake.answers).toEqual([['p1', 'allowForChat']])
    expect(chat.pendingPermissions).toBe(0)
    await chat.respondToPermission('p1', 'deny') // already answered: ignored
    expect(fake.answers).toHaveLength(1)
  })

  test('stopping cancels a pending permission request', async () => {
    await chat.send('install it')
    fake.emit({ type: 'permissionRequest', turnId: 'turn1', requestId: 'p1', toolName: 'Bash', summary: 'npm i' })
    fake.emit({ type: 'permissionCancelled', requestId: 'p1' })
    expect(chat.messages.at(-1)?.permission?.state).toBe('cancelled')
  })

  test('file events go to listeners, not into the chat', async () => {
    const seen: FileEvent[] = []
    chat.onFileEvent((e) => seen.push(e))
    await chat.send('edit')
    fake.emit({ type: 'fileWillChange', turnId: 'turn1', toolUseId: 'u1', path: '/p/a.ts', before: 'x' })
    fake.emit({ type: 'fileChanged', turnId: 'turn1', toolUseId: 'u1', path: '/p/a.ts' })
    expect(seen.map((e) => e.type)).toEqual(['fileWillChange', 'fileChanged'])
    expect(chat.messages).toHaveLength(1) // just the user message
  })
})

describe('code references', () => {
  const ref = (over: Partial<CodeRef> = {}): CodeRef => ({
    path: '/p/src/a.ts', relPath: 'src/a.ts', fromLine: 3, toLine: 4, text: 'let x = 1\nlet y = 2', purpose: 'question', ...over,
  })

  test('a reference is sent as a selection block before the text, then cleared', async () => {
    chat.addRef(ref())
    expect(chat.focusRequests).toBe(1)
    await chat.send('what is this?')
    expect(fake.sent[0].text).toBe('<selection file="src/a.ts" lines="3-4" purpose="question">\nlet x = 1\nlet y = 2\n</selection>\n\nwhat is this?')
    expect(chat.messages[0].text).toBe('what is this?') // the chat shows the text and a chip, not the raw block
    expect(chat.messages[0].refs).toHaveLength(1)
    expect(chat.draftRefs).toEqual([])
  })

  test('a reference alone can be sent; adding the same lines again replaces the purpose', async () => {
    chat.addRef(ref())
    chat.addRef(ref({ purpose: 'change' }))
    expect(chat.draftRefs).toHaveLength(1)
    expect(chat.draftRefs[0].purpose).toBe('change')
    expect(await chat.send('  ')).toBe(true)
    expect(fake.sent[0].text.endsWith('Improve the selected code.')).toBe(true)
  })

  test('removing a reference', () => {
    chat.addRef(ref())
    chat.addRef(ref({ fromLine: 9, toLine: 9 }))
    chat.removeRef(0)
    expect(chat.draftRefs.map((r) => r.fromLine)).toEqual([9])
  })
})

describe('model and effort', () => {
  test('the default model and effort send nothing, so Claude Code picks', async () => {
    expect(chat.modelOption?.value).toBe('default')
    await chat.send('hi')
    expect(fake.sent[0].model).toBeUndefined()
    expect(fake.sent[0].effort).toBeUndefined()
  })

  test('a picked model and effort are sent', async () => {
    chat.setModel('opus')
    chat.setEffort('high')
    await chat.send('hi')
    expect(fake.sent[0]).toMatchObject({ model: 'opus', effort: 'high' })
  })

  test('effort is dropped for a model without effort levels', async () => {
    chat.setEffort('max')
    chat.setModel('claude-haiku-4-5-20251001')
    expect(chat.effortLevels).toEqual([])
    expect(chat.effectiveEffort).toBeNull()
    await chat.send('hi')
    expect(fake.sent[0].effort).toBeUndefined()
  })

  test('a model that is no longer offered falls back to the default', () => {
    chat.setModel('retired-model')
    expect(chat.modelOption?.value).toBe('default')
  })

  test("the turn's summary line records the model it ran on", async () => {
    await chat.send('hi')
    fake.emit({ type: 'turnStarted', turnId: 'turn1', sessionId: 's1', model: 'claude-opus-5-5' })
    fake.emit({ type: 'turnFinished', turnId: 'turn1', sessionId: 's1', outcome: 'success', durationMs: 5 })
    expect(chat.messages.at(-1)?.done?.model).toBe('claude-opus-5-5')
  })
})

describe('attachments', () => {
  const file = (name: string, type: string, body: BlobPart) => new File([body], name, { type })

  test('files are read into the composer, sent as base64, and shown on the message', async () => {
    await chat.addAttachments([file('notes.md', '', '# Hi'), file('shot.png', 'image/png', new Uint8Array([1, 2, 3]))])
    expect(chat.draftAttachments.map((a) => [a.name, a.mediaType])).toEqual([
      ['notes.md', 'text/plain'],
      ['shot.png', 'image/png'],
    ])
    expect(await chat.send('')).toBe(true) // files alone can be sent
    expect(fake.sent[0].attachments).toEqual([
      { name: 'notes.md', mediaType: 'text/plain', data: btoa('# Hi') },
      { name: 'shot.png', mediaType: 'image/png', data: 'AQID' },
    ])
    // Only images keep their data on the message (for the thumbnail).
    expect(chat.messages[0].attachments).toEqual([
      { name: 'notes.md', mediaType: 'text/plain', data: undefined },
      { name: 'shot.png', mediaType: 'image/png', data: 'AQID' },
    ])
    expect(chat.draftAttachments).toEqual([])
  })

  test('binary files are refused with a message; the rest still attach', async () => {
    await chat.addAttachments([file('app.exe', 'application/octet-stream', new Uint8Array([0x4d, 0x5a, 0, 0])), file('a.txt', 'text/plain', 'ok')])
    expect(chat.draftAttachments.map((a) => a.name)).toEqual(['a.txt'])
    expect(chat.attachError).toMatch(/app\.exe can't be attached/)
  })

  test('removing an attachment', async () => {
    await chat.addAttachments([file('a.txt', '', 'a'), file('b.txt', '', 'b')])
    chat.removeAttachment(chat.draftAttachments[0].id)
    expect(chat.draftAttachments.map((a) => a.name)).toEqual(['b.txt'])
  })
})

describe('history', () => {
  const summary = (sessionId: string, title = sessionId, folder: string | null = null): ChatSummary => ({ sessionId, title, folder, lastModified: 1 })
  const settle = () => new Promise((r) => setTimeout(r, 0))

  test('the list loads on connect, per folder, and reloads after each turn', async () => {
    fake.chats.set(undefined, [summary('a')])
    fake.chats.set('/proj', [summary('p')])
    await fake.connect()
    await settle()
    expect(chat.chats.map((c) => c.sessionId)).toEqual(['a'])
    await chat.setProject('/proj')
    expect(chat.chats.map((c) => c.sessionId)).toEqual(['p'])

    fake.historyCalls = []
    await chat.send('hi')
    fake.emit({ type: 'turnFinished', turnId: 'turn1', sessionId: 'p2', outcome: 'success', durationMs: 1 })
    await settle()
    expect(fake.historyCalls).toEqual(['list /proj'])
  })

  test('opening a chat shows its messages and continues it', async () => {
    await chat.setProject('/proj')
    fake.transcripts.set('s9', [
      { kind: 'user', text: '<selection file="src/a.ts" lines="2-3" purpose="change">\nx\n</selection>\n\nfix it', attachments: [] },
      { kind: 'tool', toolUseId: 't1', name: 'Edit', summary: 'src/a.ts', isError: false },
      { kind: 'tool', toolUseId: 't2', name: 'Bash', summary: 'npm test', isError: true },
      { kind: 'assistant', text: 'Done.' },
    ])
    expect(await chat.openChat('s9')).toBe(true)
    expect(fake.historyCalls.at(-1)).toBe('load s9 /proj')
    expect(chat.sessionId).toBe('s9')
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'tool', 'tool', 'assistant'])
    // The selection block comes back as a chip, with an absolute path to open.
    expect(chat.messages[0].text).toBe('fix it')
    expect(chat.messages[0].refs?.[0]).toMatchObject({ path: '/proj/src/a.ts', relPath: 'src/a.ts', fromLine: 2, toLine: 3, purpose: 'change' })
    expect(chat.messages[2].tool?.status).toBe('error')

    await chat.send('and again')
    expect(fake.sent[0].sessionId).toBe('s9')
  })

  test('a chat that fails to load leaves the current one alone', async () => {
    await chat.send('hello')
    fake.emit({ type: 'turnFinished', turnId: 'turn1', sessionId: 's1', outcome: 'success', durationMs: 1 })
    expect(await chat.openChat('missing')).toBe(false)
    expect(chat.sessionId).toBe('s1')
    expect(chat.chatsError).toMatch(/no such chat/)
  })

  test('no chat can be opened while a reply is running', async () => {
    fake.transcripts.set('s2', [])
    await chat.send('long')
    expect(await chat.openChat('s2')).toBe(false)
    expect(fake.historyCalls.some((c) => c.startsWith('load'))).toBe(false)
  })

  test('all folders: one list for every folder; chats of other folders are renamed and deleted in their own', async () => {
    fake.chats.set(undefined, [summary('home1')])
    fake.chats.set('C:\\proj', [summary('p1', 'p1', 'C:\\proj')])
    chat.setAllFolders(true)
    await settle()
    expect(chat.chats.map((c) => c.sessionId)).toEqual(['home1', 'p1'])
    // Opening a folder keeps the same list (it already has every folder).
    await chat.setProject('c:/PROJ')
    expect(chat.chats.map((c) => c.sessionId)).toEqual(['home1', 'p1'])
    expect(chat.isHere('C:\\proj')).toBe(true) // same folder, different spelling
    expect(chat.isHere(null)).toBe(false)
    // A chat of another folder isn't opened here (the app switches folders first).
    fake.transcripts.set('home1', [])
    expect(await chat.openChat('home1')).toBe(false)
    await chat.renameChat('home1', 'Home chat')
    await chat.deleteChat('p1')
    expect(fake.historyCalls).toContain('rename home1 Home chat -')
    expect(fake.historyCalls).toContain('delete p1 C:\\proj')
  })

  test('switching folders twice at once does the work once', async () => {
    await chat.send('long')
    fake.emit({ type: 'turnStarted', turnId: 'turn1', sessionId: 's1', model: 'm' })
    await Promise.all([chat.setProject('/x'), chat.setProject('/x')])
    expect(fake.aborted).toEqual(['turn1'])
    expect(fake.historyCalls.filter((c) => c === 'list /x')).toHaveLength(1)
  })

  test('rename and delete; deleting the open chat starts a new one', async () => {
    fake.chats.set(undefined, [summary('s1', 'old'), summary('s2')])
    fake.transcripts.set('s1', [{ kind: 'assistant', text: 'hi' }])
    await chat.openChat('s1')
    await chat.renameChat('s1', '  New name ')
    expect(fake.historyCalls).toContain('rename s1 New name -')
    expect(chat.chats[0].title).toBe('New name')
    await chat.deleteChat('s1')
    expect(chat.chats.map((c) => c.sessionId)).toEqual(['s2'])
    expect(chat.sessionId).toBeNull()
    expect(chat.messages).toEqual([])
  })
})

describe('parsePrompt', () => {
  test('round-trips formatPrompt, including escaped paths and the stock request', () => {
    const r: CodeRef = { path: '/p/a "b".ts', relPath: 'a "b".ts', fromLine: 1, toLine: 2, text: 'one\ntwo', purpose: 'question' }
    expect(parsePrompt(formatPrompt('why?', [r]), (rel) => `/p/${rel}`)).toEqual({ text: 'why?', refs: [r] })
    expect(parsePrompt(formatPrompt('', [r]))).toMatchObject({ text: '' })
    expect(parsePrompt('just text')).toEqual({ text: 'just text', refs: [] })
  })
})
