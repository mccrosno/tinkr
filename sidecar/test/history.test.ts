import { describe, expect, test } from 'bun:test'
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import { attachmentBlock, messageContent } from '../src/attachments'
import { chatTitle, sameFolder, toHistory } from '../src/history'

/** A transcript entry shaped like the ones `getSessionMessages` returns (see SPEC "Milestone 5 notes"). */
const entry = (type: 'user' | 'assistant', content: unknown, parent: string | null = null): SessionMessage => ({
  type,
  uuid: crypto.randomUUID(),
  session_id: 's',
  message: { role: type, content },
  parent_tool_use_id: parent,
  parent_agent_id: null,
})

describe('chatTitle', () => {
  test('a custom name wins over the first prompt', () => {
    expect(chatTitle({ customTitle: 'Renamed', firstPrompt: 'hello', summary: 'latest' })).toBe('Renamed')
  })
  test('else the first prompt, not the summary (which is the latest prompt)', () => {
    expect(chatTitle({ firstPrompt: 'How do I\n  sort?', summary: 'later question' })).toBe('How do I sort?')
  })
  test("selection blocks are left out, and long prompts cut", () => {
    const prompt = `<selection file="a.ts" lines="1-2" purpose="question">\ncode\n</selection>\n\n${'word '.repeat(40)}`
    const title = chatTitle({ firstPrompt: prompt, summary: '' })
    expect(title.startsWith('word word')).toBe(true)
    expect(title.length).toBe(80)
    expect(title.endsWith('…')).toBe(true)
  })
  test('nothing to go on', () => {
    expect(chatTitle({ summary: '' })).toBe('Untitled chat')
  })
})

describe('toHistory', () => {
  test('user text, Claude text and tool calls in order, with failed tools marked', () => {
    const items = toHistory(
      [
        entry('user', [{ type: 'text', text: 'Read the note' }]),
        entry('assistant', [{ type: 'thinking', thinking: '', signature: 'x' }]),
        entry('assistant', [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/proj/note.txt' } }]),
        entry('user', [{ type: 'tool_result', tool_use_id: 't1', content: 'hi' }]),
        entry('assistant', [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }]),
        entry('user', [{ type: 'tool_result', tool_use_id: 't2', content: 'boom', is_error: true }]),
        entry('assistant', [{ type: 'text', text: 'It says hi.' }]),
        entry('assistant', [{ type: 'text', text: 'Tests fail.' }]),
      ],
      '/proj',
    )
    expect(items).toEqual([
      { kind: 'user', text: 'Read the note', attachments: [] },
      { kind: 'tool', toolUseId: 't1', name: 'Read', summary: 'note.txt', isError: false },
      { kind: 'tool', toolUseId: 't2', name: 'Bash', summary: 'npm test', isError: true },
      { kind: 'assistant', text: 'It says hi.\n\nTests fail.' },
    ])
  })

  test('a plain-string prompt, and attachments (images keep their data)', () => {
    const items = toHistory([
      entry('user', 'plain'),
      entry('user', [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
        { type: 'document', title: 'notes.txt', source: { type: 'text', media_type: 'text/plain', data: 'secret' } },
        { type: 'document', title: 'doc.pdf', source: { type: 'base64', media_type: 'application/pdf', data: 'BBB' } },
        { type: 'text', text: 'What are these?' },
      ]),
    ])
    expect(items).toEqual([
      { kind: 'user', text: 'plain', attachments: [] },
      {
        kind: 'user',
        text: 'What are these?',
        attachments: [
          { name: 'image-1.png', mediaType: 'image/png', data: 'AAA' },
          { name: 'notes.txt', mediaType: 'text/plain' },
          { name: 'doc.pdf', mediaType: 'application/pdf' },
        ],
      },
    ])
  })

  test("sub-agent work and Claude Code's own notes are left out", () => {
    const items = toHistory([
      entry('user', [{ type: 'text', text: '<command-name>/clear</command-name>' }]),
      entry('user', [{ type: 'text', text: 'real question' }]),
      entry('assistant', [{ type: 'tool_use', id: 't1', name: 'Task', input: { description: 'look around' } }]),
      entry('assistant', [{ type: 'text', text: 'sub-agent chatter' }], 't1'),
      entry('user', [{ type: 'text', text: '[Request interrupted by user]' }]),
    ])
    expect(items).toEqual([
      { kind: 'user', text: 'real question', attachments: [] },
      { kind: 'tool', toolUseId: 't1', name: 'Task', summary: 'look around', isError: false },
    ])
  })
})

describe('attachments', () => {
  test('images and PDFs go as base64; text files as text documents named after the file', () => {
    expect(attachmentBlock({ name: 'a.png', mediaType: 'image/png', data: 'AAA' })).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAA' },
    })
    expect(attachmentBlock({ name: 'd.pdf', mediaType: 'application/pdf', data: 'BBB' })).toMatchObject({ type: 'document', title: 'd.pdf' })
    expect(attachmentBlock({ name: 'n.md', mediaType: 'text/plain', data: Buffer.from('héllo').toString('base64') })).toEqual({
      type: 'document',
      title: 'n.md',
      source: { type: 'text', media_type: 'text/plain', data: 'héllo' },
    })
  })

  test('unknown types are refused', () => {
    expect(() => attachmentBlock({ name: 'x.exe', mediaType: 'application/octet-stream', data: '' })).toThrow(/unsupported/)
  })

  test('attachments come before the text; no empty text block', () => {
    const blocks = messageContent('what is it?', [{ name: 'a.png', mediaType: 'image/png', data: 'A' }])
    expect(blocks.map((b) => b.type)).toEqual(['image', 'text'])
    expect(messageContent('', [{ name: 'a.png', mediaType: 'image/png', data: 'A' }]).map((b) => b.type)).toEqual(['image'])
  })
})

describe('sameFolder', () => {
  test('Windows: case and slash style do not matter', () => {
    expect(sameFolder('C:\\Users\\me', 'c:/users/ME/', true)).toBe(true)
    expect(sameFolder('C:\\Users\\me', 'C:\\Users\\me2', true)).toBe(false)
  })
  test('elsewhere: case matters', () => {
    expect(sameFolder('/home/me', '/home/me/', false)).toBe(true)
    expect(sameFolder('/home/me', '/home/Me', false)).toBe(false)
  })
})
