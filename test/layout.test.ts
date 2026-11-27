import { beforeEach, describe, expect, test } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'
import type { BuiltInPresetId, DockHost, PanelId } from '../src/layout/dock'
import { useLayout, type KeyValueStore } from '../src/stores/layout'

/**
 * A dock reduced to what the store sees: which panels are in the layout, which are
 * hidden, which tab is in front. Its "JSON" is a plain copy of that.
 */
class FakeDock implements DockHost {
  panels = new Map<PanelId, { hidden: boolean }>()
  front: PanelId | null = null
  built: string[] = []
  home: BuiltInPresetId = 'agent'
  /** Set to make the next restore fail, as an unusable saved layout would. */
  refuse = false
  private listeners = new Set<() => void>()

  private changed() {
    for (const l of this.listeners) l()
  }
  show(id: PanelId, { activate = true } = {}) {
    const p = this.panels.get(id)
    if (p) p.hidden = false
    else this.panels.set(id, { hidden: false })
    if (activate) this.front = id
    this.changed()
  }
  hide(id: PanelId) {
    const p = this.panels.get(id)
    if (p && id !== 'chat') p.hidden = true
    this.changed()
  }
  isShown(id: PanelId) {
    return this.isVisible(id) && (this.front === id || id === 'chat')
  }
  isVisible(id: PanelId) {
    const p = this.panels.get(id)
    return !!p && !p.hidden
  }
  remove(id: PanelId) {
    this.panels.delete(id)
    this.changed()
  }
  panelIds() {
    return [...this.panels.keys()]
  }
  snapshot() {
    return { panels: [...this.panels].map(([id, p]) => [id, p.hidden]), front: this.front }
  }
  restore(saved: unknown) {
    if (this.refuse) {
      this.refuse = false
      return false
    }
    const s = saved as { panels: [PanelId, boolean][]; front: PanelId | null }
    if (!s?.panels?.some(([id]) => id === 'chat')) return false
    this.panels = new Map(s.panels.map(([id, hidden]) => [id, { hidden }]))
    this.front = s.front
    return true
  }
  build(preset: BuiltInPresetId) {
    this.built.push(preset)
    this.home = preset
    this.panels = new Map(['chat', 'chats', 'files', 'editor', 'terminal'].map((id) => [id as PanelId, { hidden: false }]))
    this.front = preset === 'agent' ? 'chats' : 'files'
  }
  setHomeRules(preset: BuiltInPresetId) {
    this.home = preset
  }
  onChange(l: () => void) {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
}

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>()
  getItem(k: string) {
    return this.data.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.data.set(k, v)
  }
  removeItem(k: string) {
    this.data.delete(k)
  }
}

let mem: MemoryStore
let dock: FakeDock
let layout: ReturnType<typeof useLayout>

function start(preload: (m: MemoryStore) => void = () => {}) {
  setActivePinia(createPinia())
  mem = new MemoryStore()
  preload(mem)
  dock = new FakeDock()
  layout = useLayout()
  layout.useStorage(mem)
  layout.attach(dock)
}

beforeEach(() => start())

describe('layout presets', () => {
  test('first launch: the Agent preset is built and remembered', () => {
    expect(layout.activeId).toBe('agent')
    expect(dock.built).toEqual(['agent'])
    expect(layout.presets.map((p) => p.name)).toEqual(['Agent', 'Editor'])
    expect(mem.getItem('tinkr.layout.state.agent')).not.toBeNull()
    expect(layout.shown.chats).toBe(true)
  })

  test('a remembered arrangement is restored on the next launch instead of rebuilt', () => {
    layout.hide('terminal')
    layout.saveNow()
    const saved = mem.data
    start((m) => (m.data = saved))
    expect(dock.built).toEqual([])
    expect(layout.visible.terminal).toBe(false)
  })

  test('an unusable saved arrangement falls back to building the preset', () => {
    start((m) => m.setItem('tinkr.layout.state.agent', '{"not":"a layout"}'))
    expect(dock.built).toEqual(['agent'])
  })

  test('switching presets keeps each one as it was left', () => {
    layout.hide('files')
    layout.switchTo('editor')
    expect(dock.built.at(-1)).toBe('editor')
    expect(dock.home).toBe('editor')
    expect(mem.getItem('tinkr.layout.active')).toBe('editor')
    expect(layout.visible.files).toBe(true)
    layout.switchTo('agent')
    expect(dock.built).toEqual(['agent', 'editor']) // restored, not rebuilt
    expect(layout.visible.files).toBe(false)
    expect(dock.home).toBe('agent')
  })

  test('reset goes back to the starting arrangement', () => {
    layout.hide('chats')
    layout.reset()
    expect(dock.built).toEqual(['agent', 'agent'])
    expect(layout.visible.chats).toBe(true)
  })

  test('save as: a new preset with its own starting arrangement; delete switches back', () => {
    layout.hide('terminal')
    const id = layout.saveAs('  Focus ')!
    expect(layout.activeId).toBe(id)
    expect(layout.presets.at(-1)).toMatchObject({ id, name: 'Focus', builtIn: false })
    expect(layout.presetForKey(3)).toBe(id)
    // Rearranged, then reset: back to how it was when saved.
    layout.show('terminal')
    layout.reset()
    expect(layout.visible.terminal).toBe(false)
    // Survives a restart.
    const saved = mem.data
    start((m) => (m.data = saved))
    expect(layout.activeId).toBe(id)
    layout.remove(id)
    expect(layout.activeId).toBe('agent')
    expect(layout.presets).toHaveLength(2)
    expect(mem.getItem(`tinkr.layout.state.${id}`)).toBeNull()
  })

  test('built-in presets cannot be deleted; blank names are not saved', () => {
    layout.remove('agent')
    expect(layout.presets).toHaveLength(2)
    expect(layout.saveAs('   ')).toBeNull()
  })

  test('the app hears about every preset laid out (to re-apply editor and terminal visibility)', () => {
    let calls = 0
    layout.onApplied(() => calls++)
    layout.switchTo('editor')
    layout.reset()
    expect(calls).toBe(2)
  })

  test('toggle shows a background tab first, then hides it', () => {
    expect(layout.shown.files).toBe(false) // behind Chats
    layout.toggle('files')
    expect(layout.shown.files).toBe(true)
    layout.toggle('files')
    expect(layout.visible.files).toBe(false)
  })

  test('a preset id that no longer exists falls back to Agent', () => {
    start((m) => m.setItem('tinkr.layout.active', 'custom-gone'))
    expect(layout.activeId).toBe('agent')
  })
})
