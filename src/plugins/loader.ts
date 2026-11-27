// Loads plugins: the built-in ones (compiled into Tinkr), then the ones in
// ~/.config/tinkr/plugins/<name>/. Watches that folder and reloads a plugin when its
// files change ("hot reload"), loads new ones and unloads deleted ones.
//
// A plugin Tinkr hasn't seen before doesn't run until the user approves it: plugins
// are trusted code with access to the files, terminals and Claude. The answer is
// remembered in settings.json.
//
// Disk access and `import()` go through `PluginSource`, so tests can feed plugins in.

import { usePlugins } from '../stores/plugins'
import { useSettings } from '../stores/settings'
import type { PluginManifest, PluginModule, ThemeFile } from './api'
import { createApi, type PluginHandle } from './host'

/** A plugin compiled into Tinkr. */
export interface BuiltInPlugin {
  manifest: PluginManifest
  activate: PluginModule['activate']
}

export interface PluginSource {
  /** Absolute path of the plugins folder. */
  dir: string
  /** Folder names inside it. */
  list(): Promise<string[]>
  /** plugin.json, parsed (throws if missing or invalid). */
  manifest(name: string): Promise<PluginManifest>
  /** Import the plugin's entry module. `version` must differ between reloads. */
  importModule(name: string, main: string, version: number): Promise<PluginModule>
  /** A text file in the plugin's folder (theme JSON, CSS). */
  readFile(name: string, path: string): Promise<string>
  /** A URL for a file in the plugin's folder (images); `version` as for importModule. */
  fileUrl(name: string, path: string, version: number): string
  /** Watch the folder; the callback gets changed absolute paths. Returns an unwatch function. */
  watch(onChange: (paths: string[]) => void): Promise<() => void>
}

/** Asks the user whether a newly found plugin may run. */
export type Approve = (manifest: PluginManifest, dir: string) => Promise<boolean>

const VALID_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/
/** Can a plugin folder be called this? (Letters, digits, `-`, `_`, `.`, not starting with a dot.) */
export const isPluginName = (name: string) => VALID_NAME.test(name)

interface Loaded {
  handle: PluginHandle
  module: PluginModule | null
}

export class PluginLoader {
  private loaded = new Map<string, Loaded>()
  private version = 0
  private unwatch: (() => void) | null = null
  /** Reloads queued by the watcher, per plugin, so a burst of writes reloads once. */
  private pending = new Map<string, ReturnType<typeof setTimeout>>()
  /** One operation per plugin at a time (a reload while loading would race). */
  private queue = new Map<string, Promise<void>>()
  /**
   * While the first load runs at startup, new plugins aren't asked about yet (a dialog
   * would hold up the window); they're collected here and asked by `askPending`.
   */
  private deferApprovals = true
  private awaiting: string[] = []
  /** Told which files changed under the plugins folder (editor tabs and reviews follow them). */
  private fileListeners = new Set<(paths: string[]) => void>()

  constructor(
    private source: PluginSource | null,
    private approve: Approve,
    private reloadDelayMs = 250,
  ) {}

  private get registry() {
    return usePlugins()
  }

  /** Run `op` for `name` after any operation already running for it. */
  private serial(name: string, op: () => Promise<void>) {
    const next = (this.queue.get(name) ?? Promise.resolve()).then(op, op)
    this.queue.set(name, next)
    return next
  }

  /** Activate the built-in plugins. They always run and can't be disabled. */
  async loadBuiltIns(builtIns: BuiltInPlugin[]) {
    for (const b of builtIns) {
      const name = b.manifest.name
      this.registry.upsertPlugin({ name, manifest: b.manifest, builtIn: true, dir: null, state: 'loading' })
      const handle = createApi({ name, manifest: b.manifest, dir: null, builtIn: true })
      try {
        await b.activate(handle.api)
        this.loaded.set(name, { handle, module: null })
        this.registry.setState(name, 'active')
      } catch (e) {
        handle.disposeAll()
        this.fail(name, e)
      }
    }
  }

  /** Find and load the plugins on disk, then start watching for changes. */
  async loadFromDisk() {
    if (!this.source) return
    let names: string[]
    try {
      names = await this.source.list()
    } catch (e) {
      this.registry.addLog('tinkr', 'error', `couldn't read the plugins folder ${this.source.dir}: ${String(e)}`)
      return
    }
    for (const name of names.sort()) await this.serial(name, () => this.discover(name))
    try {
      this.unwatch = await this.source.watch((paths) => this.onDiskChange(paths))
    } catch (e) {
      this.registry.addLog('tinkr', 'warn', `hot reload is off (couldn't watch the plugins folder): ${String(e)}`)
    }
  }

  /** Ask about the new plugins found at startup, one at a time. From then on, new plugins are asked about right away. */
  async askPending() {
    this.deferApprovals = false
    const names = this.awaiting.splice(0)
    for (const name of names) await this.serial(name, () => this.discover(name))
  }

  onFilesChanged(listener: (paths: string[]) => void) {
    this.fileListeners.add(listener)
    return () => this.fileListeners.delete(listener)
  }

  stop() {
    this.unwatch?.()
    this.unwatch = null
    for (const t of this.pending.values()) clearTimeout(t)
    this.pending.clear()
  }

  private pluginDir(name: string) {
    const dir = this.source!.dir
    return dir + (dir.includes('\\') ? '\\' : '/') + name
  }

  /** Read a plugin's manifest and load it, or wait for approval / stay disabled. */
  private async discover(name: string) {
    const dir = this.pluginDir(name)
    if (!VALID_NAME.test(name)) return // not a plugin folder (e.g. ".git", "my plugin")
    let manifest: PluginManifest
    try {
      manifest = await this.source!.manifest(name)
      if (manifest.name !== name) throw new Error(`plugin.json says "name": "${manifest.name}", but the folder is "${name}"; they must match`)
    } catch (e) {
      if (this.registry.record(name)?.builtIn) return
      // A folder without plugin.json is skipped quietly: Claude may be about to write it,
      // or the user rejected the new file (then forget what was loaded from it).
      if (/not found|no such file|cannot find|os error 2/i.test(String(e))) {
        if (this.registry.record(name)?.builtIn === false) this.registry.removePlugin(name)
        return
      }
      this.registry.upsertPlugin({ name, manifest: { name }, builtIn: false, dir, state: 'error' })
      this.fail(name, e)
      return
    }
    if (this.registry.record(name)?.builtIn) {
      this.registry.addLog('tinkr', 'error', `a plugin folder is named "${name}", like a built-in plugin; rename it`)
      return
    }
    this.registry.upsertPlugin({ name, manifest, builtIn: false, dir, state: 'loading' })

    const settings = useSettings()
    let approved = settings.approval(name)
    if (approved === null) {
      this.registry.setState(name, 'awaiting-approval')
      if (this.deferApprovals) {
        this.awaiting.push(name)
        return
      }
      approved = await this.approve(manifest, dir)
      settings.setApproval(name, approved)
    }
    if (!approved) {
      this.registry.setState(name, 'disabled')
      return
    }
    await this.activate(name, manifest)
  }

  private async activate(name: string, manifest: PluginManifest) {
    this.registry.setState(name, 'loading')
    const version = ++this.version
    const source = this.source!
    const handle = createApi({ name, manifest, dir: this.pluginDir(name), builtIn: false, fileUrl: (p) => source.fileUrl(name, p, version) })
    try {
      // Register in `loaded` first, so whatever a failing plugin registered is still undone.
      this.loaded.set(name, { handle, module: null })
      // Themes listed in plugin.json: JSON (and CSS) files, no code needed.
      for (const file of manifest.themes ?? []) {
        let theme: ThemeFile
        try {
          theme = JSON.parse(await source.readFile(name, file)) as ThemeFile
        } catch (e) {
          throw new Error(`theme file ${file}: ${e instanceof Error ? e.message : String(e)}`)
        }
        const { cssFile, ...def } = theme
        const css = cssFile ? await source.readFile(name, cssFile) : undefined
        handle.api.themes.register({ ...def, ...(css !== undefined ? { css } : {}) })
      }
      // A themes-only plugin (no "main") runs no code.
      if (manifest.themes?.length && !manifest.main) {
        this.registry.setState(name, 'active')
        this.registry.addLog(name, 'info', `loaded ${manifest.themes.length} theme(s)`)
        return
      }
      const module = await source.importModule(name, manifest.main ?? 'index.js', version)
      if (typeof module.activate !== 'function') throw new Error(`${manifest.main ?? 'index.js'} doesn't export an activate(api) function`)
      this.loaded.set(name, { handle, module })
      await module.activate(handle.api)
      this.registry.setState(name, 'active')
      this.registry.addLog(name, 'info', `loaded${manifest.version ? ` (version ${manifest.version})` : ''}`)
    } catch (e) {
      await this.deactivate(name)
      handle.disposeAll()
      this.fail(name, e)
    }
  }

  /** Undo everything the plugin did. */
  private async deactivate(name: string) {
    const entry = this.loaded.get(name)
    if (!entry) return
    this.loaded.delete(name)
    try {
      await entry.module?.deactivate?.()
    } catch (e) {
      this.registry.addLog(name, 'warn', `deactivate() failed: ${String(e)}`)
    }
    entry.handle.disposeAll()
  }

  private fail(name: string, e: unknown) {
    const text = e instanceof Error ? (e.stack ?? e.message) : String(e)
    this.registry.setState(name, 'error', e instanceof Error ? e.message : String(e))
    this.registry.addLog(name, 'error', `failed to load: ${text}`)
  }

  /** Reload a plugin from disk (its files changed, or the user asked). Its panels keep their place. */
  reload(name: string) {
    // This reload covers any change the watcher was about to reload for.
    clearTimeout(this.pending.get(name))
    this.pending.delete(name)
    return this.serial(name, async () => {
      const panelsBefore = [...this.registry.panels.values()].filter((p) => p.plugin === name).map((p) => p.id)
      this.registry.beginReload(name)
      try {
        await this.deactivate(name)
        await this.discover(name)
      } finally {
        this.registry.endReload(name, panelsBefore)
      }
    })
  }

  /** The user turned a plugin on or off (Plugins panel). */
  setEnabled(name: string, enabled: boolean) {
    useSettings().setApproval(name, enabled)
    return this.serial(name, async () => {
      if (enabled) await this.discover(name)
      else {
        await this.deactivate(name)
        this.registry.setState(name, 'disabled')
      }
    })
  }

  /** Changed paths under the plugins folder: reload (or load, or unload) each plugin they belong to. */
  private onDiskChange(paths: string[]) {
    for (const l of this.fileListeners) l(paths)
    const root = this.source!.dir.replace(/[\\/]+$/, '')
    for (const p of paths) {
      if (p.length <= root.length || p.slice(0, root.length).toLowerCase() !== root.toLowerCase()) continue
      const name = p.slice(root.length + 1).split(/[\\/]/)[0]
      if (!name || !VALID_NAME.test(name)) continue
      clearTimeout(this.pending.get(name))
      this.pending.set(
        name,
        setTimeout(() => {
          this.pending.delete(name)
          void this.onPluginChanged(name)
        }, this.reloadDelayMs),
      )
    }
  }

  private async onPluginChanged(name: string) {
    if (this.registry.record(name)?.builtIn) return // a stray folder named like a built-in
    const names = await this.source!.list().catch(() => null)
    if (names && !names.includes(name)) {
      // The folder is gone: unload it and forget it.
      await this.serial(name, async () => {
        await this.deactivate(name)
        this.registry.removePlugin(name)
      })
      return
    }
    const state = this.registry.record(name)?.state
    if (state === 'disabled' || state === 'awaiting-approval') return
    await this.reload(name)
  }
}
