// Starting the plugin system: read settings.json, load the built-in plugins, then the
// ones on disk. The dock waits for `pluginsReady()` before laying out the saved
// arrangement, so the panels it mentions exist; new plugins are asked about after that.

import { ask } from '@tauri-apps/plugin-dialog'
import { BUILT_IN_PLUGINS } from '../builtins'
import { usePlugins } from '../stores/plugins'
import { useSettings } from '../stores/settings'
import { joinPath, parentOf, tauriFs } from '../workspace/fs'
import type { PluginManifest } from './api'
import { diskSource } from './diskSource'
import { PluginLoader, type PluginSource } from './loader'

let loader: PluginLoader | null = null
let dir: string | null = null
let resolveReady: () => void = () => {}
const ready = new Promise<void>((r) => (resolveReady = r))

/** The running loader (null before boot). The Plugins panel and commands use it. */
export const pluginLoader = () => loader
/** Where plugins are installed, once known. */
export const pluginsDir = () => dir
/** Resolves once the built-in plugins and the approved plugins on disk are loaded. */
export const pluginsReady = () => ready

/** Plugins are trusted code: say so before running one (SPEC.md "Plugin system"). */
async function approveDialog(manifest: PluginManifest, pluginDir: string) {
  const name = manifest.displayName ?? manifest.name
  const perms = manifest.permissions?.length ? `\n\nIt asks to use: ${manifest.permissions.join(', ')}.` : ''
  return ask(
    `Tinkr found a new plugin, "${name}", in\n${pluginDir}\n\n` +
      `Plugins run inside Tinkr as trusted code: they can read and change your files, ` +
      `run commands and talk to Claude. Only turn on plugins you trust.${perms}\n\nTurn it on?`,
    { title: 'New plugin', kind: 'warning', okLabel: 'Turn on', cancelLabel: 'Keep off' },
  )
}

export async function bootPlugins() {
  const registry = usePlugins()
  let source: PluginSource | null = null
  try {
    source = await diskSource()
    dir = source.dir
    await useSettings().load(tauriFs, joinPath(parentOf(source.dir), 'settings.json'))
  } catch (e) {
    registry.addLog('tinkr', 'error', `plugins on disk are off: ${String(e)}`)
  }
  loader = new PluginLoader(source, approveDialog)
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
