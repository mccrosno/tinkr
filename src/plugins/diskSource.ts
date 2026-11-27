// Plugins on disk, for the loader: ~/.config/tinkr/plugins, read through Tauri's fs
// plugin (Rust adds the folder to its scope at startup) and imported over the
// `tinkr-plugin` URI scheme that Rust serves (src-tauri/src/plugins.rs).

import { invoke } from '@tauri-apps/api/core'
import { joinPath, tauriFs } from '../workspace/fs'
import type { PluginManifest, PluginModule } from './api'
import type { PluginSource } from './loader'

/** Custom schemes look like http://<scheme>.localhost on Windows (WebView2) and <scheme>://localhost elsewhere. */
export function pluginBaseUrl(windows = /Windows/i.test(navigator.userAgent)) {
  return windows ? 'http://tinkr-plugin.localhost' : 'tinkr-plugin://localhost'
}

/** The URL of a file in a plugin. Each path segment is escaped; `version` makes reloaded files new to the browser. */
export function pluginFileUrl(base: string, name: string, version: number, file: string) {
  const path = file.replace(/^\.?[\\/]/, '').split(/[\\/]/).map(encodeURIComponent).join('/')
  return `${base}/${encodeURIComponent(name)}/${version}/${path}`
}

export async function diskSource(): Promise<PluginSource> {
  const dir = await invoke<string>('plugins_dir_path')
  const base = pluginBaseUrl()
  return {
    dir,
    async list() {
      return (await tauriFs.readDir(dir)).filter((e) => e.isDir).map((e) => e.name)
    },
    async manifest(name) {
      const text = await tauriFs.readText(joinPath(joinPath(dir, name), 'plugin.json'))
      try {
        return JSON.parse(text) as PluginManifest
      } catch (e) {
        throw new Error(`plugin.json isn't valid JSON: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
    async importModule(name, main, version) {
      // `@vite-ignore`: the URL is only known at run time; Vite mustn't try to bundle it.
      return (await import(/* @vite-ignore */ pluginFileUrl(base, name, version, main))) as PluginModule
    },
    watch: (onChange) => tauriFs.watch(dir, onChange),
  }
}
