// Starting the plugin system: read settings.json, write the authoring kit into the
// plugins folder, load the built-in plugins, then the ones on disk. The dock waits for
// `pluginsReady()` before laying out the saved arrangement, so the panels it mentions
// exist; new plugins are asked about after that.

import { ask } from '@tauri-apps/plugin-dialog'
import { mkdir } from '@tauri-apps/plugin-fs'
import { BUILT_IN_PLUGINS } from '../builtins'
import { usePlugins } from '../stores/plugins'
import { useSettings } from '../stores/settings'
import { joinPath, parentOf, tauriFs } from '../workspace/fs'
import type { PluginManifest } from './api'
import { approvalPrompt, type ApprovalRequest } from './approval'
import { KIT } from './authoring/kit'
import { writeKit } from './authoring/write'
import { diskSource } from './diskSource'
import { PluginLoader, type PluginSource } from './loader'
import { watchUncaughtErrors } from './uncaught'

let loader: PluginLoader | null = null
let resolveReady: () => void = () => {}
const ready = new Promise<void>((r) => (resolveReady = r))

/** The running loader (null before boot). The Plugins panel and commands use it. */
export const pluginLoader = () => loader
/** Resolves once the built-in plugins and the approved plugins on disk are loaded. */
export const pluginsReady = () => ready

/** Plugins are trusted code: say so before running one (SPEC.md "Plugin system"). */
async function approveDialog(manifest: PluginManifest, pluginDir: string, request: ApprovalRequest) {
  const { title, message, okLabel } = approvalPrompt(manifest, pluginDir, request)
  return ask(message, { title, kind: 'warning', okLabel, cancelLabel: 'Keep off' })
}

/** `onFilesChanged` hears about every change under the plugins folder. */
export async function bootPlugins(onFilesChanged: (paths: string[]) => void = () => {}) {
  const registry = usePlugins()
  watchUncaughtErrors()
  let source: PluginSource | null = null
  try {
    source = await diskSource()
    await useSettings().load(tauriFs, joinPath(parentOf(source.dir), 'settings.json'))
  } catch (e) {
    registry.addLog('tinkr', 'error', `plugins on disk are off: ${String(e)}`)
  }
  if (source) {
    registry.dir = source.dir
    const kitFs = { ...tauriFs, mkdir: (path: string) => mkdir(path, { recursive: true }) }
    // Before the watcher starts. Without the kit plugins still load; Claude just has less to go on.
    await writeKit(kitFs, source.dir, KIT).catch((e) => registry.addLog('tinkr', 'warn', `couldn't write the plugin authoring files: ${String(e)}`))
  }
  loader = new PluginLoader(source, approveDialog)
  loader.onFilesChanged(onFilesChanged)
  try {
    await loader.loadBuiltIns(BUILT_IN_PLUGINS)
    await loader.loadFromDisk()
  } finally {
    resolveReady()
  }
}

/** After the window is laid out: ask about plugins found at startup that are new. */
export function askAboutNewPlugins() {
  return loader?.askPending()
}
