// Open files (tabs), unsaved changes, saving, and reacting to changes on disk.
// The text lives here; EditorPane.vue keeps a CodeMirror state per tab (for undo history)
// and syncs with this store.

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { baseName, samePath } from '../workspace/fs'
import { languageOf } from '../editor/languages'
import { useReview } from './review'
import { useWorkspace } from './workspace'

/** Files above this size open as a notice instead of in the editor. */
export const MAX_EDITABLE_BYTES = 2 * 1024 * 1024

export interface Tab {
  path: string
  name: string
  language: string
  /** Current text in the editor. */
  text: string
  /** Text as last read from or written to disk. */
  savedText: string
  /** Set when the file changed on disk while there were unsaved edits. */
  conflict: boolean
  /** Why the file can't be edited (too big, binary), if so. */
  unsupported: string | null
  /** Bumped when the store replaces the text (reload), so the view resets its document. */
  revision: number
}

export const useEditor = defineStore('editor', () => {
  const tabs = ref<Tab[]>([])
  const activePath = ref<string | null>(null)
  const lastError = ref<string | null>(null)
  /**
   * Whether the editor panel is shown. The chat is the main view; the editor opens
   * beside it when a file is opened (or Claude edits one) and can be hidden again.
   */
  const panelOpen = ref(false)

  const active = computed(() => tabs.value.find((t) => t.path === activePath.value) ?? null)
  const isDirty = (t: Tab) => t.text !== t.savedText
  const dirtyCount = computed(() => tabs.value.filter(isDirty).length)
  const find = (path: string) => tabs.value.find((t) => samePath(t.path, path))

  const fs = () => useWorkspace().fs

  async function readForEditing(path: string): Promise<{ text: string; unsupported: string | null }> {
    const size = await fs().size(path)
    if (size > MAX_EDITABLE_BYTES) return { text: '', unsupported: `This file is ${(size / 1024 / 1024).toFixed(1)} MB; Tinkr opens files up to 2 MB.` }
    const text = await fs().readText(path)
    // A NUL character almost always means a binary file (image, archive, compiled code).
    if (text.includes('\u0000')) return { text: '', unsupported: "This looks like a binary file, so it isn't shown." }
    return { text, unsupported: null }
  }

  async function open(path: string) {
    lastError.value = null
    panelOpen.value = true
    const existing = find(path)
    if (existing) {
      activePath.value = existing.path
      return existing
    }
    try {
      const { text, unsupported } = await readForEditing(path)
      const name = baseName(path)
      const tab: Tab = { path, name, language: languageOf(name), text, savedText: text, conflict: false, unsupported, revision: 0 }
      tabs.value.push(tab)
      activePath.value = path
      return tab
    } catch (e) {
      lastError.value = `Couldn't open ${baseName(path)}: ${e}`
      return null
    }
  }

  function updateText(path: string, text: string) {
    const tab = find(path)
    if (tab) tab.text = text
  }

  async function save(path = activePath.value) {
    const tab = path ? find(path) : undefined
    if (!tab || tab.unsupported) return false
    try {
      const text = tab.text
      await fs().writeText(tab.path, text)
      tab.savedText = text
      tab.conflict = false
      // Hand edits to a file under review change what's left to review.
      useReview().noteText(tab.path, text)
      return true
    } catch (e) {
      lastError.value = `Couldn't save ${tab.name}: ${e}`
      return false
    }
  }

  async function saveAll() {
    for (const t of tabs.value.filter(isDirty)) await save(t.path)
  }

  /** Close a tab. Returns false if it has unsaved changes and `force` isn't set. */
  function close(path: string, force = false) {
    const i = tabs.value.findIndex((t) => samePath(t.path, path))
    if (i < 0) return true
    if (isDirty(tabs.value[i]) && !force) return false
    const [closed] = tabs.value.splice(i, 1)
    if (activePath.value === closed.path) activePath.value = tabs.value[Math.min(i, tabs.value.length - 1)]?.path ?? null
    return true
  }

  function closeAll() {
    tabs.value = []
    activePath.value = null
    panelOpen.value = false
  }

  /**
   * Files changed on disk (from the workspace watcher). Clean tabs reload silently;
   * tabs with unsaved edits are flagged so the user decides.
   */
  async function onDiskChange(paths: string[]) {
    for (const tab of tabs.value) {
      if (!paths.some((p) => samePath(p, tab.path))) continue
      let disk: string
      try {
        disk = (await readForEditing(tab.path)).text
      } catch {
        continue // deleted or unreadable: keep what's in the editor
      }
      if (disk === tab.savedText) continue // our own save, or no real change
      if (isDirty(tab)) {
        tab.conflict = disk !== tab.text
        continue
      }
      replaceText(tab, disk)
    }
  }

  /** Resolve a conflict by taking the disk version. */
  async function reloadFromDisk(path: string) {
    const tab = find(path)
    if (!tab) return
    replaceText(tab, (await readForEditing(tab.path)).text)
  }

  /** Resolve a conflict by keeping the editor's text (the next save overwrites disk). */
  function keepMine(path: string) {
    const tab = find(path)
    if (tab) tab.conflict = false
  }

  function replaceText(tab: Tab, text: string) {
    tab.text = text
    tab.savedText = text
    tab.conflict = false
    tab.revision++
  }

  return {
    tabs, activePath, active, lastError, dirtyCount, panelOpen,
    isDirty, open, updateText, save, saveAll, close, closeAll, onDiskChange, reloadFromDisk, keepMine,
  }
})
