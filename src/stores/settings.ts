// Tinkr's settings file, ~/.config/tinkr/settings.json (SPEC.md "Storage": JSON in the
// config folder). It holds which plugins are allowed to run and each plugin's own
// settings. Read once at startup; changes are written 300 ms after the last one.
//
// Shape: { "plugins": { "approved": { "<name>": true|false } },
//          "plugin": { "<name>": { "<key>": <json> } } }

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { FileSystem } from '../workspace/fs'

interface SettingsFile {
  plugins?: { approved?: Record<string, boolean> }
  plugin?: Record<string, Record<string, unknown>>
}

const WRITE_DELAY_MS = 300

export const useSettings = defineStore('settings', () => {
  const data = ref<SettingsFile>({})
  const loaded = ref(false)
  const error = ref<string | null>(null)
  let fs: FileSystem | null = null
  let path: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<(plugin: string, key: string) => void>()

  /** Read the file. A missing file is an empty one; an unreadable one is reported and left alone. */
  async function load(fileSystem: FileSystem, file: string) {
    fs = fileSystem
    path = file
    try {
      data.value = JSON.parse(await fs.readText(file)) as SettingsFile
    } catch (e) {
      const missing = /not found|no such file|cannot find|os error 2/i.test(String(e))
      data.value = {}
      // Don't overwrite a file we couldn't parse: someone may be editing it by hand.
      if (!missing) {
        error.value = `Couldn't read ${file}: ${String(e)}. Settings won't be saved until it's fixed.`
        path = null
      }
    }
    loaded.value = true
  }

  function scheduleWrite() {
    if (!fs || !path) return
    clearTimeout(timer)
    timer = setTimeout(() => void flush(), WRITE_DELAY_MS)
  }

  async function flush() {
    clearTimeout(timer)
    timer = undefined
    if (!fs || !path) return
    await fs.writeText(path, JSON.stringify(data.value, null, 2) + '\n')
  }

  /** null = never asked; true/false = the user's answer. */
  function approval(plugin: string): boolean | null {
    return data.value.plugins?.approved?.[plugin] ?? null
  }

  function setApproval(plugin: string, approved: boolean) {
    data.value.plugins ??= {}
    data.value.plugins.approved ??= {}
    data.value.plugins.approved[plugin] = approved
    scheduleWrite()
  }

  function pluginValue<T>(plugin: string, key: string, fallback: T): T {
    const v = data.value.plugin?.[plugin]?.[key]
    return v === undefined ? fallback : (v as T)
  }

  function setPluginValue(plugin: string, key: string, value: unknown) {
    // Through JSON, so only JSON-safe values are stored (and copies, not live objects).
    const json = value === undefined ? undefined : JSON.parse(JSON.stringify(value))
    data.value.plugin ??= {}
    data.value.plugin[plugin] ??= {}
    if (json === undefined) delete data.value.plugin[plugin][key]
    else data.value.plugin[plugin][key] = json
    scheduleWrite()
    for (const l of listeners) l(plugin, key)
  }

  function onPluginValueChange(listener: (plugin: string, key: string) => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  /** Drop everything stored about a plugin (its approval and its settings), e.g. when it's uninstalled. */
  function forgetPlugin(plugin: string) {
    delete data.value.plugins?.approved?.[plugin]
    delete data.value.plugin?.[plugin]
    scheduleWrite()
  }

  return { data, loaded, error, load, flush, approval, setApproval, forgetPlugin, pluginValue, setPluginValue, onPluginValueChange }
})
