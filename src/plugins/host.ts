// Builds the `TinkrApi` object a plugin's `activate` receives. Each plugin gets its own:
// ids it registers are prefixed with its name (built-ins keep bare ids), everything it
// registers is tracked so unloading removes it, and the "agent", "fs" and "pty" parts
// only work if plugin.json asks for them.

import type { AgentEvent } from '../agent/types'
import { useChat } from '../stores/chat'
import { useEditor } from '../stores/editor'
import { useLayout } from '../stores/layout'
import { useNotifications } from '../stores/notifications'
import { usePlugins } from '../stores/plugins'
import { useSettings } from '../stores/settings'
import { useTerminal } from '../stores/terminal'
import { useWorkspace } from '../stores/workspace'
import { joinPath, relativeTo, samePath, tauriFs, type FileSystem } from '../workspace/fs'
import type { Disposable, Permission, PluginManifest, TinkrApi } from './api'

/** What `createApi` needs to know about the plugin. */
export interface PluginIdentity {
  name: string
  manifest: PluginManifest
  dir: string | null
  builtIn: boolean
  /** A URL for a file in the plugin's folder (plugins on disk; built-ins use URLs directly). */
  fileUrl?: (path: string) => string
}

/** The API plus the means to undo everything the plugin registered. */
export interface PluginHandle {
  api: TinkrApi
  /** Dispose everything registered through `api`, newest first. */
  disposeAll(): void
}

const format = (parts: unknown[]) =>
  parts.map((p) => (p instanceof Error ? (p.stack ?? p.message) : typeof p === 'string' ? p : safeJson(p))).join(' ')

function safeJson(v: unknown) {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** Is `path` the folder `root` or inside it? Either slash, any case on Windows (like `samePath`). */
function isInside(path: string, root: string) {
  return samePath(path, root) || relativeTo(root, path) !== path
}

export function createApi(plugin: PluginIdentity, fs: FileSystem = tauriFs): PluginHandle {
  const registry = usePlugins()
  const disposables: Disposable[] = []
  const track = (d: Disposable) => (disposables.push(d), d)
  const listen = (unsubscribe: () => void) => track({ dispose: unsubscribe })
  /** Built-ins use bare ids ("chat"); plugins get "<plugin>.<id>" so they can't collide. */
  const fullId = (id: string) => (plugin.builtIn ? id : `${plugin.name}.${id}`)
  const granted = new Set<Permission>(plugin.manifest.permissions ?? [])

  /**
   * `impl` if the plugin has the permission; otherwise the same functions, each throwing
   * an error that says what to add. (Not a proxy that throws on access: the object gets
   * spread and copied, which reads every property.)
   */
  function needs<T extends Record<string, unknown>>(permission: Permission, part: string, impl: T): T {
    if (plugin.builtIn || granted.has(permission)) return impl
    const refuse = () => {
      throw new Error(`api.${part} needs "${permission}" in the "permissions" list of ${plugin.name}/plugin.json`)
    }
    return Object.fromEntries(Object.keys(impl).map((k) => [k, refuse])) as T
  }

  /** A path the plugin gave, made absolute and checked to be inside the open folder. */
  function projectPath(path: string) {
    const root = useWorkspace().root
    if (!root) throw new Error('no folder is open')
    // "a/../../x" starts with the root but leaves it; refuse ".." outright.
    if (/(^|[\\/])\.\.([\\/]|$)/.test(path)) throw new Error(`${path}: ".." isn't allowed in paths`)
    const absolute = /^([a-zA-Z]:[\\/]|[\\/])/.test(path) ? path : joinPath(root, root.includes('\\') ? path.replaceAll('/', '\\') : path)
    if (!isInside(absolute, root)) throw new Error(`${path} is outside the open folder`)
    return absolute
  }

  const log = (level: 'info' | 'warn' | 'error') => (...parts: unknown[]) => registry.addLog(plugin.name, level, format(parts))
  const toast = (level: 'info' | 'warn' | 'error') => (message: string) => {
    useNotifications().show({ level, text: message, source: plugin.manifest.displayName ?? plugin.name })
    registry.addLog(plugin.name, level, message)
  }

  const api: TinkrApi = {
    version: 1,
    plugin: { name: plugin.name, dir: plugin.dir, manifest: plugin.manifest, url: (path) => plugin.fileUrl?.(path) ?? path },

    panels: {
      register: (def) => track(registry.registerPanel(plugin.name, fullId(def.id), def)),
    },

    commands: {
      register: (def) => track(registry.registerCommand(plugin.name, fullId(def.id), def)),
      execute: (id, ...args) => registry.executeCommand(id, ...args),
    },

    actions: {
      register: (def) => track(registry.registerAction(plugin.name, fullId(def.id), def)),
    },

    layout: {
      show: (id) => useLayout().show(id),
      hide: (id) => useLayout().hide(id),
      toggle: (id) => useLayout().toggle(id),
      registerPreset: (p) => track(registry.registerPreset(plugin.name, `plugin:${fullId(p.id)}`, p.name, p.layout)),
    },

    themes: {
      register: (def) => track(registry.registerTheme(plugin.name, fullId(def.id), def, (path) => plugin.fileUrl?.(path) ?? path)),
    },

    workspace: {
      root: () => useWorkspace().root,
      onDidChangeRoot(listener) {
        const ws = useWorkspace()
        let last = ws.root
        // The workspace store has no event of its own for this; Pinia's $subscribe fires on any change to it.
        return listen(ws.$subscribe(() => {
          if (ws.root !== last) listener((last = ws.root))
        }))
      },
      onDidChangeFiles: (listener) => listen(useWorkspace().onFilesChanged(listener)),
      ...needs('fs', 'workspace', {
        readText: async (path: string) => fs.readText(projectPath(path)),
        writeText: async (path: string, text: string) => fs.writeText(projectPath(path), text),
        readDir: async (path: string) => (await fs.readDir(projectPath(path))).map((e) => ({ name: e.name, isDir: e.isDir })),
      }),
    },

    editor: {
      open: async (path) => {
        await useEditor().open(projectPath(path))
      },
      activePath: () => useEditor().activePath,
    },

    agent: needs('agent', 'agent', {
      send: (text: string) => useChat().send(text),
      setDraft: (text: string) => useChat().setDraft(text),
      addReference(ref: { path: string; fromLine: number; toLine: number; text: string; purpose?: 'question' | 'change' }) {
        const root = useWorkspace().root
        useChat().addRef({ ...ref, purpose: ref.purpose ?? 'question', relPath: relativeTo(root, ref.path).replaceAll('\\', '/') })
      },
      busy: () => useChat().busy,
      onDidReceive(listener: (e: { type: 'text'; text: string } | { type: 'done'; outcome: 'success' | 'aborted' | 'error' }) => void) {
        return listen(
          useChat().onAgentEvent((e: AgentEvent) => {
            if (e.type === 'text') listener({ type: 'text', text: e.text })
            else if (e.type === 'turnFinished') listener({ type: 'done', outcome: e.outcome })
          }),
        )
      },
    }),

    terminal: needs('pty', 'terminal', {
      async create() {
        const root = useWorkspace().root
        if (!root) throw new Error('no folder is open')
        useTerminal().create(root)
      },
      async sendText(text: string) {
        const t = useTerminal()
        if (t.activeKey === null) throw new Error('no terminal is open')
        t.write(t.activeKey, text)
      },
    }),

    settings: {
      get: (key, fallback) => useSettings().pluginValue(plugin.name, key, fallback),
      set: async (key, value) => useSettings().setPluginValue(plugin.name, key, value),
      onDidChange: (listener) =>
        listen(useSettings().onPluginValueChange((p, key) => {
          if (p === plugin.name) listener(key)
        })),
    },

    notifications: { info: toast('info'), warn: toast('warn'), error: toast('error') },
    log: { info: log('info'), warn: log('warn'), error: log('error') },
  }

  function disposeAll() {
    while (disposables.length) {
      try {
        disposables.pop()!.dispose()
      } catch (e) {
        registry.addLog(plugin.name, 'warn', `cleanup failed: ${String(e)}`)
      }
    }
  }

  return { api, disposeAll }
}
