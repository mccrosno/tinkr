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
