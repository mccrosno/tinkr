import { beforeEach, describe, expect, test } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'
import type { AgentEvent, AgentProvider, PermissionDecision } from '../src/agent/types'
import type { CodeRef } from '../src/chat/refs'
import type { FileEvent } from '../src/stores/chat'
import { toAgentEvent } from '../src/agent/claudeSidecar'
import { useChat } from '../src/stores/chat'

/** A provider the test drives by hand. */
class FakeProvider implements AgentProvider {
  id = 'fake'
  label = 'Fake'
  sent: { sessionId: string | null; text: string; turnId: string; cwd?: string }[] = []
  aborted: string[] = []
  answers: [string, PermissionDecision][] = []
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
    this.emit({ type: 'status', cli: { state: 'ok', path: '/claude', version: '2.1.331' }, auth: { state: 'subscription', plan: 'Claude Pro' } })
  }
  async refreshStatus() {}
  async send(sessionId: string | null, text: string, options: { cwd?: string } = {}) {
    const turnId = `turn${++this.n}`
    this.sent.push({ sessionId, text, turnId, cwd: options.cwd })
    return turnId
  }
  async abort(turnId: string) {
    this.aborted.push(turnId)
  }
  async respondToPermission(requestId: string, decision: PermissionDecision) {
    this.answers.push([requestId, decision])
  }
  async restart() {}
}

let fake: FakeProvider
let chat: ReturnType<typeof useChat>

beforeEach(async () => {
  setActivePinia(createPinia())
  chat = useChat()
  fake = new FakeProvider()
  await chat.connect(fake)
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
    fake.emit({ type: 'status', cli: { state: 'ok', path: '/c', version: '2.1.331' }, auth: { state: 'signedOut' } })
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
