import { describe, expect, test } from 'bun:test'
import { dayGroup, groupByDay, timeAgo } from '../src/chat/dates'
import { findSide, type Box } from '../src/layout/places'

const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, right: left + width, bottom: top + height })

// The Agent preset in a 1200x800 dock, with the 6px gap between cards:
// [ sidebar ] [ chat ] [ editor ]
// [ terminal                    ]
const sidebar = { panel: 'files', box: box(0, 0, 240, 534) }
const chat = { panel: 'chat', box: box(246, 0, 468, 534) }
const editor = { panel: 'editor', box: box(720, 0, 480, 534) }
const terminal = { panel: 'terminal', box: box(0, 540, 1200, 260) }
const without = (p: { panel: string }) => [sidebar, chat, editor, terminal].filter((x) => x !== p)

describe('where a closed panel was', () => {
  test('along a whole edge of the dock', () => {
    expect(findSide(terminal.box, without(terminal))).toEqual({ direction: 'below' })
  })

  test('beside the neighbor it shares the most with', () => {
    // The terminal under the editor is the editor's width too, but only part of its own.
    expect(findSide(editor.box, without(editor))).toEqual({ direction: 'right', panel: 'chat' })
    expect(findSide(sidebar.box, without(sidebar))).toEqual({ direction: 'left', panel: 'chat' })
  })

  test('under one neighbor, as in the Editor preset', () => {
    const files = { panel: 'files', box: box(0, 0, 240, 800) }
    const above = { panel: 'editor', box: box(246, 0, 500, 534) }
    const right = { panel: 'chat', box: box(752, 0, 448, 800) }
    expect(findSide(box(246, 540, 500, 260), [files, above, right])).toEqual({ direction: 'below', panel: 'editor' })
    // The full-height files card ran along the left edge.
    expect(findSide(files.box, [above, right])).toEqual({ direction: 'left' })
  })

  test('alone in the dock: nothing to remember', () => {
    expect(findSide(box(0, 0, 1200, 800), [])).toBeUndefined()
  })
})

describe('chat dates', () => {
  const now = new Date(2026, 10, 27, 10, 0).getTime()
  const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0).getTime()

  test('groups follow the calendar day, not 24 hour periods', () => {
    expect(dayGroup(at(27, 0), now)).toBe('Today')
    expect(dayGroup(at(26, 23), now)).toBe('Yesterday')
    expect(dayGroup(at(26, 0), now)).toBe('Yesterday')
    expect(dayGroup(at(25, 23), now)).toBe('Earlier')
  })

  test('only groups with chats are listed, newest first', () => {
    const chats = [at(27, 9), at(27, 8), at(20, 8)].map((lastModified) => ({ lastModified }))
    expect(groupByDay(chats, now).map((g) => [g.label, g.chats.length])).toEqual([['Today', 2], ['Earlier', 1]])
    expect(groupByDay([], now)).toEqual([])
  })

  test('time ago', () => {
    expect(timeAgo(now - 20_000, now)).toBe('now')
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(timeAgo(now - 2 * 3_600_000, now)).toBe('2 h ago')
    expect(timeAgo(now - 25 * 3_600_000, now)).toBe('Yesterday')
    expect(timeAgo(now - 3 * 86_400_000, now)).toBe('3 days ago')
    expect(timeAgo(now - 30 * 86_400_000, now)).toMatch(/28/)
  })
})
