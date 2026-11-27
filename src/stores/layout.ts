// Layout presets: the built-in "Agent" (chat-first, the default) and "Editor", plus any
// the user saves. Each preset remembers how it was last arranged, so rearranging
// "Agent" and switching away and back keeps the changes; "Reset layout" goes back to
// the preset's starting arrangement.
//
// Stored in localStorage for now (like the old panel sizes). SPEC.md: settings move to
// the config folder with the settings API in Milestone 7.

import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef } from 'vue'
import { BUILT_IN_PANELS, BUILT_IN_PRESETS, type BuiltInPresetId, type DockHost, type PanelId } from '../layout/dock'
import { usePlugins } from './plugins'

export interface Preset {
  id: string
  name: string
  builtIn: boolean
  /** Added by a plugin (`api.layout.registerPreset`): can't be deleted from the menu. */
  fromPlugin?: string
}

/** A preset the user saved: `base` is the arrangement at the time, for "Reset layout". */
interface CustomPreset {
  id: string
  name: string
  base: unknown
}

/** Where layouts are kept. localStorage in the app; a Map-backed fake in tests. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const KEY_ACTIVE = 'tinkr.layout.active'
const KEY_CUSTOM = 'tinkr.layout.custom'
const keyState = (id: string) => `tinkr.layout.state.${id}`
/** Wait this long after the last change before saving (a drag fires many changes). */
const SAVE_DELAY_MS = 300

const isBuiltIn = (id: string): id is BuiltInPresetId => BUILT_IN_PRESETS.some((p) => p.id === id)

function readJson<T>(store: KeyValueStore, key: string, fallback: T): T {
  try {
    const raw = store.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function defaultStore(): KeyValueStore {
  try {
    return localStorage
  } catch {
    const m = new Map<string, string>()
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
  }
}

export const useLayout = defineStore('layout', () => {
  let store: KeyValueStore = defaultStore()
  const host = shallowRef<DockHost | null>(null)
  const custom = ref<CustomPreset[]>(readJson<CustomPreset[]>(store, KEY_CUSTOM, []))
  const activeId = ref(store.getItem(KEY_ACTIVE) ?? 'agent')
  /** Which panels are on screen right now: visible and the active tab of their group. */
  const shown = reactive(Object.fromEntries(BUILT_IN_PANELS.map((id) => [id, false])) as Record<PanelId, boolean>)
  /** Which panels are in the layout in a visible group (maybe as a background tab). */
  const visible = reactive(Object.fromEntries(BUILT_IN_PANELS.map((id) => [id, false])) as Record<PanelId, boolean>)
  const appliedListeners = new Set<() => void>()
  let applying = false
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  const presets = computed<Preset[]>(() => [
    ...BUILT_IN_PRESETS.map((p) => ({ id: p.id, name: p.name, builtIn: true })),
    ...usePlugins().presets.map((p) => ({ id: p.id, name: p.name, builtIn: false, fromPlugin: p.plugin })),
    ...custom.value.map((p) => ({ id: p.id, name: p.name, builtIn: false })),
  ])
  const active = computed(() => presets.value.find((p) => p.id === activeId.value) ?? presets.value[0])

  /** For tests: use another store (call before `attach`). */
  function useStorage(s: KeyValueStore) {
    store = s
    custom.value = readJson<CustomPreset[]>(store, KEY_CUSTOM, [])
    activeId.value = store.getItem(KEY_ACTIVE) ?? 'agent'
  }

  function refreshShown() {
    const registry = usePlugins()
    const ids = new Set<PanelId>([...BUILT_IN_PANELS, ...registry.panels.keys(), ...(host.value?.panelIds() ?? [])])
    for (const id of ids) {
      shown[id] = host.value?.isShown(id) ?? false
      visible[id] = host.value?.isVisible(id) ?? false
      // Panels hear about their own visibility (the plugin API's `ctx.visible`).
      registry.setPanelVisible(id, shown[id])
    }
  }

  function saveNow() {
    clearTimeout(saveTimer)
    saveTimer = undefined
    if (!host.value || applying) return
    try {
      store.setItem(keyState(activeId.value), JSON.stringify(host.value.snapshot()))
    } catch {
      /* not persisted */
    }
  }

  /** Write a save that's still waiting for its delay (when the window closes). Nothing pending, nothing written. */
  function flush() {
    if (saveTimer !== undefined) saveNow()
  }

  function onDockChange() {
    if (applying) return
    refreshShown()
    clearTimeout(saveTimer)
    saveTimer = setTimeout(saveNow, SAVE_DELAY_MS)
  }

  /** The preset's starting arrangement. */
  function applyBase(id: string) {
    const h = host.value!
    const c = custom.value.find((p) => p.id === id) ?? usePlugins().presets.find((p) => p.id === id)
    const base = c && ('base' in c ? c.base : c.layout)
    if (c && h.restore(base)) return h.setHomeRules('agent')
    h.build(isBuiltIn(id) ? id : 'agent')
  }

  /** Lay out preset `id`: its remembered arrangement if there is a usable one, else its base. */
  function apply(id: string, { fresh = false } = {}) {
    const h = host.value
    if (!h) return
    applying = true
    try {
      const saved = fresh ? null : readJson<unknown>(store, keyState(id), null)
      if (saved && h.restore(saved)) h.setHomeRules(isBuiltIn(id) ? id : 'agent')
      else applyBase(id)
    } finally {
      applying = false
    }
    refreshShown()
    saveNow()
    // Let the app re-apply what the layout can't know: e.g. hide the editor if no file is open.
    for (const l of appliedListeners) l()
    refreshShown()
  }

  /** Connect the dock (once it exists) and lay out the active preset. */
  function attach(h: DockHost) {
    host.value = h
    if (!presets.value.some((p) => p.id === activeId.value)) activeId.value = 'agent'
    h.onChange(onDockChange)
    // A plugin that's unloaded for good takes its panel out of the layout.
    usePlugins().onPanelRemoved((id) => {
      h.remove(id)
      refreshShown()
    })
    apply(activeId.value)
  }

  function switchTo(id: string) {
    if (!presets.value.some((p) => p.id === id) || id === activeId.value) return
    saveNow() // keep the current preset's arrangement
    activeId.value = id
    store.setItem(KEY_ACTIVE, id)
    apply(id)
  }

  /** Back to the active preset's starting arrangement. */
  function reset() {
    apply(activeId.value, { fresh: true })
  }

  function persistCustom() {
    store.setItem(KEY_CUSTOM, JSON.stringify(custom.value))
  }

  /** Save the current arrangement as a new preset, and switch to it. Returns its id. */
  function saveAs(name: string): string | null {
    const h = host.value
    const trimmed = name.trim()
    if (!h || !trimmed) return null
    saveNow()
    const id = `custom-${Date.now().toString(36)}`
    const base = h.snapshot()
    custom.value = [...custom.value, { id, name: trimmed, base }]
    persistCustom()
    store.setItem(keyState(id), JSON.stringify(base))
    activeId.value = id
    store.setItem(KEY_ACTIVE, id)
    h.setHomeRules('agent')
    return id
  }

  /** Delete a saved preset (built-ins and plugins' presets can't be). Deleting the active one switches to Agent. */
  function remove(id: string) {
    if (isBuiltIn(id) || !custom.value.some((p) => p.id === id)) return
    if (id === activeId.value) switchTo('agent')
    custom.value = custom.value.filter((p) => p.id !== id)
    persistCustom()
    store.removeItem(keyState(id))
  }

  /** The current arrangement in dockview's JSON (for "copy layout as JSON" / plugin presets). */
  const snapshot = () => host.value?.snapshot() ?? null

  /** The preset for Ctrl+Alt+<n> (1-based, in menu order). */
  const presetForKey = (n: number) => presets.value[n - 1]?.id ?? null

  function show(id: PanelId, options?: { activate?: boolean }) {
    host.value?.show(id, options)
    refreshShown()
  }
  function hide(id: PanelId) {
    host.value?.hide(id)
    refreshShown()
  }
  /** Show it (as the active tab) unless it's already showing; then hide it. */
  function toggle(id: PanelId) {
    if (host.value?.isShown(id)) hide(id)
    else show(id)
  }

  /** Called after a preset is laid out (see `apply`). */
  function onApplied(listener: () => void) {
    appliedListeners.add(listener)
    return () => appliedListeners.delete(listener)
  }

  return {
    presets, active, activeId, shown, visible,
    useStorage, attach, switchTo, reset, saveAs, remove, presetForKey, snapshot, show, hide, toggle, onApplied, saveNow, flush,
  }
})
