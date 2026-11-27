// The plugin registry: the plugins Tinkr knows (built-in and on disk), everything they
// registered (panels, commands, actions, layout presets), and the log shown in the
// Console panel. The loader (src/plugins/loader.ts) fills it; the UI reads it.
//
// Panels are framework-agnostic: each gets a container element, created once, which
// its `mount` fills. The dock moves that element into the panel's place (PanelHost.vue)
// and back to a hidden "parking" box when the panel leaves the layout, so a panel's
// content is never rebuilt by layout changes.

import { defineStore } from 'pinia'
import { computed, markRaw, reactive, ref, shallowReactive } from 'vue'
import type { ActionDefinition, ActionSlot, CommandDefinition, Disposable, PanelDefinition, PanelLocation, PluginManifest, ThemeDefinition } from '../plugins/api'
import { resolveIcon, type Icon } from '../plugins/icons'
import { MAX_TRANSLUCENCY, type ResolvedTheme } from '../theme/apply'

export type PluginState = 'loading' | 'active' | 'error' | 'disabled' | 'awaiting-approval'

export interface PluginRecord {
  name: string
  manifest: PluginManifest
  builtIn: boolean
  /** Folder on disk; null for built-ins. */
  dir: string | null
  state: PluginState
  error?: string
}

export interface PanelEntry {
  id: string
  plugin: string
  title: string
  location: PanelLocation
  closable: boolean
  icon: Icon | null
  isEnabled?: () => boolean
  badge?: () => boolean
  /** The persistent container; `mount` filled it. */
  el: HTMLElement
  visible: boolean
}

export interface CommandEntry {
  id: string
  plugin: string
  title: string
  keybinding?: string
  hidden: boolean
  run: (...args: unknown[]) => unknown
}

export interface ActionEntry {
  key: string
  plugin: string
  def: ActionDefinition
  icon: Icon | null
}

export interface PresetEntry {
  id: string
  plugin: string
  name: string
  layout: unknown
}

export interface LogEntry {
  id: number
  time: number
  plugin: string
  level: 'info' | 'warn' | 'error'
  text: string
}

const MAX_LOG = 500
let nextLog = 1

/** Normalize "Ctrl+Shift+P" so stored bindings and key events compare equal. */
export function normalizeKeybinding(binding: string): string {
  const parts = binding.split('+').map((p) => p.trim().toLowerCase())
  const key = parts.pop() ?? ''
  const mods = ['ctrl', 'alt', 'shift'].filter((m) => parts.includes(m) || (m === 'ctrl' && (parts.includes('cmd') || parts.includes('meta'))))
  return [...mods, key].join('+')
}

/** The binding a key event stands for, e.g. "ctrl+shift+p". Uses the physical key for letters, digits and the backquote. */
export function keybindingOf(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key' | 'code'>): string {
  const mods = [e.ctrlKey || e.metaKey ? 'ctrl' : '', e.altKey ? 'alt' : '', e.shiftKey ? 'shift' : ''].filter(Boolean)
  // `code` for keys whose `key` changes with Shift/Alt ("KeyP" stays "p" with Shift).
  let key = e.key.toLowerCase()
  const code = /^Key([A-Z])$/.exec(e.code) ?? /^Digit([0-9])$/.exec(e.code)
  if (code) key = code[1].toLowerCase()
  else if (e.code === 'Backquote') key = '`'
  return [...mods, key].join('+')
}

export const usePlugins = defineStore('plugins', () => {
  const plugins = ref<PluginRecord[]>([])
  const panels = shallowReactive(new Map<string, PanelEntry>())
  const commands = shallowReactive(new Map<string, CommandEntry>())
  const actions = ref<ActionEntry[]>([])
  const presets = ref<PresetEntry[]>([])
  const themes = ref<ResolvedTheme[]>([])
  const log = ref<LogEntry[]>([])
  /** Plugins being reloaded: their panels stay in the dock while they re-register. */
  const reloading = new Set<string>()
  const panelCleanups = new Map<string, () => void>()
  const visibilityListeners = new Map<string, Set<(v: boolean) => void>>()
  const panelRemovedListeners = new Set<(id: string) => void>()

  const errors = computed(() => plugins.value.filter((p) => p.state === 'error'))

  function record(name: string) {
    return plugins.value.find((p) => p.name === name)
  }

  function upsertPlugin(p: PluginRecord) {
    const i = plugins.value.findIndex((x) => x.name === p.name)
    if (i >= 0) plugins.value[i] = p
    else plugins.value.push(p)
  }

  function setState(name: string, state: PluginState, error?: string) {
    const p = record(name)
    if (p) {
      p.state = state
      p.error = error
    }
  }

  function removePlugin(name: string) {
    plugins.value = plugins.value.filter((p) => p.name !== name)
  }

  function addLog(plugin: string, level: LogEntry['level'], text: string) {
    log.value.push({ id: nextLog++, time: Date.now(), plugin, level, text })
    if (log.value.length > MAX_LOG) log.value.splice(0, log.value.length - MAX_LOG)
  }

  function clearLog() {
    log.value = []
  }

  // --- Panels ---------------------------------------------------------------

  /** The icon for a plugin's `icon` string; one that's neither path data nor an .svg file is reported and ignored. */
  function iconFor(plugin: string, what: string, icon: string | undefined, url: (path: string) => string) {
    const resolved = resolveIcon(icon, url)
    if (icon && !resolved) addLog(plugin, 'warn', `${what}: "icon" must be SVG path data (like "M4 6h16") or the path of an .svg file`)
    return resolved
  }

  /** A panel; `url` turns a path inside the plugin's folder into a URL (for an icon file). */
  function registerPanel(plugin: string, id: string, def: PanelDefinition, url: (path: string) => string = (p) => p): Disposable {
    if (panels.has(id)) throw new Error(`a panel with id "${id}" is already registered`)
    const el = document.createElement('div')
    el.className = 'tk-panel-root'
    el.dataset.panelRoot = id
    const entry: PanelEntry = reactive({
      id,
      plugin,
      title: def.title,
      location: def.location ?? 'right',
      closable: def.closable ?? true,
      icon: iconFor(plugin, `panel "${id}"`, def.icon, url),
      // Called on `def`, so a plugin can use `this` in them.
      isEnabled: def.isEnabled && (() => def.isEnabled!()),
      badge: def.badge && (() => def.badge!()),
      el: markRaw(el),
      visible: false,
    })
    panels.set(id, entry)
    const listeners = new Set<(v: boolean) => void>()
    visibilityListeners.set(id, listeners)
    const ctx = {
      id,
      get visible() {
        return entry.visible
      },
      onDidChangeVisibility(l: (v: boolean) => void) {
        listeners.add(l)
        return { dispose: () => listeners.delete(l) }
      },
      setTitle(title: string) {
        entry.title = title
      },
    }
    try {
      const cleanup = def.mount(el, ctx)
      if (typeof cleanup === 'function') panelCleanups.set(id, cleanup)
    } catch (e) {
      el.textContent = `This panel failed to start: ${e instanceof Error ? e.message : String(e)}`
      addLog(plugin, 'error', `panel "${id}" failed to mount: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
    }
    return { dispose: () => unregisterPanel(id) }
  }

  function unregisterPanel(id: string) {
    const entry = panels.get(id)
    if (!entry) return
    try {
      panelCleanups.get(id)?.()
    } catch (e) {
      addLog(entry.plugin, 'warn', `panel "${id}" cleanup failed: ${String(e)}`)
    }
    panelCleanups.delete(id)
    visibilityListeners.delete(id)
    entry.el.remove()
    panels.delete(id)
    // During a reload the plugin will register it again: keep its place in the dock.
    if (!reloading.has(entry.plugin)) for (const l of panelRemovedListeners) l(id)
  }

  /** A plugin's `isEnabled` or `badge`. A broken one must not break the rail: a throw is the default. */
  function ask(fn: (() => boolean) | undefined, fallback: boolean) {
    try {
      return fn ? !!fn() : fallback
    } catch {
      return fallback
    }
  }
  const panelEnabled = (id: string) => ask(panels.get(id)?.isEnabled, true)
  const panelBadge = (id: string) => ask(panels.get(id)?.badge, false)

  /** The dock reports what's on screen; panels hear about their own changes. */
  function setPanelVisible(id: string, visible: boolean) {
    const entry = panels.get(id)
    if (!entry || entry.visible === visible) return
    entry.visible = visible
    for (const l of visibilityListeners.get(id) ?? []) {
      try {
        l(visible)
      } catch (e) {
        addLog(entry.plugin, 'error', `visibility listener of "${id}" threw: ${String(e)}`)
      }
    }
  }

  /** The dock closes panels that are gone for good (not just reloading). */
  function onPanelRemoved(listener: (id: string) => void) {
    panelRemovedListeners.add(listener)
    return () => panelRemovedListeners.delete(listener)
  }

  // --- Commands -------------------------------------------------------------

  function registerCommand(plugin: string, id: string, def: CommandDefinition): Disposable {
    if (commands.has(id)) throw new Error(`a command with id "${id}" is already registered`)
    commands.set(id, { id, plugin, title: def.title, keybinding: def.keybinding ? normalizeKeybinding(def.keybinding) : undefined, hidden: def.hidden ?? false, run: def.run })
    return { dispose: () => commands.delete(id) }
  }

  async function executeCommand(id: string, ...args: unknown[]) {
    const c = commands.get(id)
    if (!c) throw new Error(`no command "${id}"`)
    try {
      return await c.run(...args)
    } catch (e) {
      addLog(c.plugin, 'error', `command "${id}" failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
      throw e
    }
  }

  /** The command bound to a key event, if any. */
  function commandForKey(e: Parameters<typeof keybindingOf>[0]): CommandEntry | null {
    const binding = keybindingOf(e)
    for (const c of commands.values()) if (c.keybinding === binding) return c
    return null
  }

  // --- Actions and presets ----------------------------------------------------

  function registerAction(plugin: string, key: string, def: ActionDefinition, url: (path: string) => string = (p) => p): Disposable {
    if (actions.value.some((a) => a.key === key)) throw new Error(`an action with id "${key}" is already registered`)
    actions.value.push({ key, plugin, def: markRaw(def), icon: iconFor(plugin, `action "${key}"`, def.icon, url) })
    return { dispose: () => (actions.value = actions.value.filter((a) => a.key !== key)) }
  }

  function actionsIn(slot: ActionSlot) {
    return actions.value.filter((a) => a.def.slot === slot).sort((a, b) => (a.def.order ?? 100) - (b.def.order ?? 100))
  }

  function registerPreset(plugin: string, id: string, name: string, layout: unknown): Disposable {
    presets.value.push({ id, plugin, name, layout: markRaw(layout as object) })
    return { dispose: () => (presets.value = presets.value.filter((p) => p.id !== id)) }
  }

  /** A theme; `url` turns a path inside the plugin's folder into a URL (built-ins pass URLs already). */
  function registerTheme(plugin: string, id: string, def: ThemeDefinition, url: (path: string) => string): Disposable {
    if (themes.value.some((t) => t.id === id)) throw new Error(`a theme with id "${id}" is already registered`)
    if (def.kind !== 'dark' && def.kind !== 'light') throw new Error(`theme "${id}": "kind" must be "dark" or "light"`)
    const bg = def.background
    const isUrl = (s: string) => /^(https?:|data:|blob:|tinkr-plugin:|\/)/.test(s)
    const theme: ResolvedTheme = {
      id,
      plugin,
      name: def.name || id,
      kind: def.kind,
      tokens: { ...(def.tokens ?? {}) },
      background: bg?.image
        ? {
            url: isUrl(bg.image) ? bg.image : url(bg.image),
            size: bg.size ?? 'cover',
            position: bg.position ?? 'center',
            opacity: Math.min(1, Math.max(0, bg.opacity ?? 1)),
          }
        : null,
      translucency: Math.min(MAX_TRANSLUCENCY, Math.max(0, def.translucency ?? 0)),
      blur: Math.max(0, def.blur ?? 0),
      css: def.css ?? '',
    }
    themes.value.push(theme)
    return { dispose: () => (themes.value = themes.value.filter((t) => t.id !== id)) }
  }

  function beginReload(plugin: string) {
    reloading.add(plugin)
  }

  /** After a reload: panels the plugin didn't register again are closed. */
  function endReload(plugin: string, before: string[]) {
    reloading.delete(plugin)
    for (const id of before) if (!panels.has(id)) for (const l of panelRemovedListeners) l(id)
  }

  return {
    plugins, panels, commands, actions, presets, themes, log, errors,
    record, upsertPlugin, setState, removePlugin, addLog, clearLog,
    registerPanel, unregisterPanel, setPanelVisible, onPanelRemoved, panelEnabled, panelBadge,
    registerCommand, executeCommand, commandForKey,
    registerAction, actionsIn, registerPreset, registerTheme, beginReload, endReload,
  }
})
