// The open project folder and its file tree. Folders load lazily when expanded, and a
// recursive watcher refreshes loaded folders and tells the editor about changed files.

import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { baseName, parentOf, samePath, tauriFs, type DirEntry, type FileSystem } from '../workspace/fs'
import { flattenTree, sortEntries } from '../workspace/tree'

/** Rust-side config/project commands (src-tauri/src/config.rs). Swappable for tests. */
export interface ProjectHost {
  getConfig(): Promise<{ lastProject: string | null; recentProjects: string[] }>
  openProject(path: string): Promise<string>
  closeProject(): Promise<void>
  pickFolder(): Promise<string | null>
}

export const tauriHost: ProjectHost = {
  getConfig: () => invoke('get_config'),
  openProject: (path) => invoke('open_project', { path }),
  closeProject: () => invoke('close_project'),
  async pickFolder() {
    const picked = await openDialog({ directory: true, multiple: false, title: 'Open folder' })
    return typeof picked === 'string' ? picked : null
  },
}

export const useWorkspace = defineStore('workspace', () => {
  const fs = shallowRef<FileSystem>(tauriFs)
  const host = shallowRef<ProjectHost>(tauriHost)
  const root = ref<string | null>(null)
  const recent = ref<string[]>([])
  const children = ref(new Map<string, DirEntry[]>())
  const expanded = ref(new Set<string>())
  const error = ref<string | null>(null)
  /** Listeners for changed file paths (the editor subscribes). */
  const changeListeners = new Set<(paths: string[]) => void>()
  let unwatch: (() => void) | null = null

  const name = computed(() => (root.value ? baseName(root.value) : null))
  const rows = computed(() => (root.value ? flattenTree(root.value, children.value, expanded.value) : []))

  /** Use a different fs/host (tests). */
  function configure(deps: { fs?: FileSystem; host?: ProjectHost }) {
    if (deps.fs) fs.value = deps.fs
    if (deps.host) host.value = deps.host
  }

  async function loadDir(dir: string) {
    try {
      children.value.set(dir, sortEntries(await fs.value.readDir(dir)))
    } catch (e) {
      // Deleted or unreadable: drop it from the tree.
      children.value.delete(dir)
      if (root.value && samePath(dir, root.value)) error.value = `Couldn't read ${dir}: ${e}`
    }
  }

  async function init() {
    try {
      const config = await host.value.getConfig()
      recent.value = config.recentProjects
      if (config.lastProject) await openFolder(config.lastProject)
    } catch (e) {
      error.value = String(e)
    }
  }

  async function openFolder(path: string) {
    error.value = null
    try {
      const opened = await host.value.openProject(path)
      closeWatcher()
      root.value = opened
      children.value = new Map()
      expanded.value = new Set()
      await loadDir(opened)
      recent.value = [opened, ...recent.value.filter((p) => !samePath(p, opened))].slice(0, 10)
      unwatch = await fs.value.watch(opened, onDiskChange).catch((e) => {
        error.value = `File watching is off: ${e}`
        return null
      })
    } catch (e) {
      error.value = String(e)
    }
  }

  async function pickAndOpen() {
    const path = await host.value.pickFolder()
    if (path) await openFolder(path)
  }

  async function closeFolder() {
    closeWatcher()
    root.value = null
    children.value = new Map()
    expanded.value = new Set()
    await host.value.closeProject().catch(() => {})
  }

  function closeWatcher() {
    unwatch?.()
    unwatch = null
  }

  async function toggle(dir: string) {
    if (expanded.value.has(dir)) {
      expanded.value.delete(dir)
    } else {
      expanded.value.add(dir)
      if (!children.value.has(dir)) await loadDir(dir)
    }
  }

  /** Watcher callback: refresh affected folders that are loaded, then tell listeners. */
  async function onDiskChange(paths: string[]) {
    const dirs = new Set<string>()
    for (const p of paths) {
      for (const dir of [parentOf(p), p]) {
        for (const loaded of children.value.keys()) if (samePath(loaded, dir)) dirs.add(loaded)
      }
    }
    await Promise.all([...dirs].map(loadDir))
    for (const l of changeListeners) l(paths)
  }

  function onFilesChanged(listener: (paths: string[]) => void) {
    changeListeners.add(listener)
    return () => changeListeners.delete(listener)
  }

  return {
    fs, root, recent, children, expanded, error, name, rows,
    configure, init, openFolder, pickAndOpen, closeFolder, toggle, loadDir, onDiskChange, onFilesChanged,
  }
})
