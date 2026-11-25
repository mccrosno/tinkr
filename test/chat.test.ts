import { beforeEach, describe, expect, test } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'
import type { AgentEvent, AgentProvider } from '../src/agent/types'
import { toAgentEvent } from '../src/agent/claudeSidecar'
import { useChat } from '../src/stores/chat'

/** A provider the test drives by hand. */
class FakeProvider implements AgentProvider {
  id = 'fake'
  label = 'Fake'
  sent: { sessionId: string | null; text: string; turnId: string; cwd?: string }[] = []
  aborted: string[] = []
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
