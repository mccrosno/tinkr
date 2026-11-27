import { describe, expect, test } from 'bun:test'
import type { DockviewApi } from 'dockview-vue'
import { reactive } from 'vue'
import { Dock } from '../src/layout/dock'

/** Just enough of dockview's API to restore a layout into. */
function fakeApi() {
  const loaded: unknown[] = []
  const closed: string[] = []
  const panel = (id: string) => ({ id, api: { close: () => closed.push(id) } })
  const api = { fromJSON: (data: unknown) => loaded.push(data), panels: [panel('chat'), panel('gone.panel')] }
  return { api: api as unknown as DockviewApi, loaded, closed }
}
const registered = (id: string) => (id === 'chat' ? { title: 'Chat', location: 'center' as const } : undefined)

/** One card holding these panels, the first in front. */
function card(...ids: string[]) {
  const state = { visible: true, closed: [] as string[] }
  const group = {
    api: { get isVisible() { return state.visible }, setVisible: (v: boolean) => (state.visible = v) },
    element: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) },
    panels: [] as unknown[],
    activePanel: undefined as unknown,
  }
  group.panels = ids.map((id) => ({ id, group, api: { close: () => state.closed.push(id) } }))
  group.activePanel = group.panels[0]
  const api = { getPanel: (id: string) => group.panels.find((p) => (p as { id: string }).id === id), groups: [group] }
  return { dock: new Dock(api as unknown as DockviewApi, registered), state }
}

describe('putting a panel away', () => {
  test('hides its whole card, other tabs and all', () => {
    const { dock, state } = card('terminal', 'console')
    dock.putAway('terminal')
    expect(state).toEqual({ visible: false, closed: [] })
  })

  test('on the card with the chat, closes just that panel', () => {
    const { dock, state } = card('editor', 'chat')
    dock.putAway('editor')
    expect(state).toEqual({ visible: true, closed: ['editor'] })
  })

  test('leaves a background tab alone', () => {
    const { dock, state } = card('console', 'terminal')
    dock.putAway('terminal')
    expect(state).toEqual({ visible: true, closed: [] })
  })
})

describe('restoring a saved layout', () => {
  const saved = {
    grid: { root: { type: 'branch', data: [] } },
    panels: { chat: { id: 'chat', tabComponent: 'pinned' } },
    tinkrPlaces: { editor: { mates: ['chat'], width: 300, height: 400 } },
  }

  test("accepts Vue's reactive objects, and leaves them unchanged", () => {
    const { api, loaded } = fakeApi()
    const input = reactive(structuredClone(saved))
    expect(new Dock(api, registered).restore(input)).toBe(true)
    // Dockview gets the layout without our own extras or the old tab component.
    expect(loaded).toEqual([{ grid: saved.grid, panels: { chat: { id: 'chat' } } }])
    expect(input).toEqual(saved)
  })

  test('drops panels nothing has registered', () => {
    const { api, closed } = fakeApi()
    new Dock(api, registered).restore(saved)
    expect(closed).toEqual(['gone.panel'])
  })

  test("anything that isn't a layout is refused", () => {
    const { api, loaded } = fakeApi()
    for (const junk of [null, 'x', {}, { panels: {} }]) expect(new Dock(api, registered).restore(junk)).toBe(false)
    expect(loaded).toEqual([])
  })
})
