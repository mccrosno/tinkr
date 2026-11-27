// Review of Claude's file edits (SPEC.md "Review model").
//
// Before each edit the sidecar sends the file's text. The first one we see for a file
// becomes its *baseline*: what the file looked like before Claude touched it. The file
// is "changed" while its text on disk differs from the baseline. Accepting moves the
// baseline forward (all at once, or chunk by chunk in the editor); rejecting writes the
// baseline back to disk. Baselines carry across turns until everything is reviewed.

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { Text } from '@codemirror/state'
import { Chunk } from '@codemirror/merge'
import type { FileEvent } from './chat'
import { useWorkspace } from './workspace'
import { relativeTo, samePath } from '../workspace/fs'

export interface ReviewFile {
  /** Absolute path. */
  path: string
  /** Path relative to the project, for display. */
  relPath: string
  /** The text before Claude's edits; null if Claude created the file. */
  baseline: string | null
  /** The text on disk now; null if the file is gone. */
  current: string | null
  added: number
  removed: number
}

const toText = (s: string | null) => Text.of((s ?? '').split('\n'))

/** Lines added and removed between two versions, counted per changed chunk. */
export function lineStats(before: string | null, after: string | null) {
  const a = toText(before)
  const b = toText(after)
  let added = 0
  let removed = 0
  for (const c of Chunk.build(a, b)) {
    // A chunk covers whole lines; `endA`/`endB` is the end of its last line.
    if (c.toA > c.fromA) removed += a.lineAt(c.endA).number - a.lineAt(c.fromA).number + 1
    if (c.toB > c.fromB) added += b.lineAt(c.endB).number - b.lineAt(c.fromB).number + 1
  }
  // A created file starts empty: don't count its one empty "line" as removed.
  if (before === null) removed = 0
  return { added, removed }
}

export const useReview = defineStore('review', () => {
  const files = ref<ReviewFile[]>([])
  /** Baselines announced by `fileWillChange` whose edit hasn't finished yet. */
  const pending = new Map<string, string | null>()
  /** Listeners told when Claude changed a file (App opens it in the editor). */
  const changeListeners = new Set<(path: string) => void>()

  const count = computed(() => files.value.length)
  const totals = computed(() =>
    files.value.reduce((t, f) => ({ added: t.added + f.added, removed: t.removed + f.removed }), { added: 0, removed: 0 }),
  )

  const fs = () => useWorkspace().fs
  const find = (path: string) => files.value.find((f) => samePath(f.path, path))
  const pendingKey = (path: string) => [...pending.keys()].find((k) => samePath(k, path))

  async function readDisk(path: string): Promise<string | null> {
    try {
      return await fs().readText(path)
    } catch {
      return null // deleted (or unreadable)
    }
  }

  /** Add, update or drop a file's entry for its current text. */
  function update(path: string, baseline: string | null, current: string | null) {
    const existing = find(path)
    if (current === baseline) {
      if (existing) files.value.splice(files.value.indexOf(existing), 1)
      return false
    }
    const stats = lineStats(baseline, current)
    if (existing) Object.assign(existing, { baseline, current, ...stats })
    else files.value.push({ path, relPath: relativeTo(useWorkspace().root, path), baseline, current, ...stats })
    return true
  }

  /** Events from the agent (wired up via `chat.onFileEvent`). */
  async function onAgentFile(e: FileEvent) {
    if (e.type === 'fileWillChange') {
      // Keep the oldest baseline: the one from before Claude's first edit.
      if (!find(e.path) && pendingKey(e.path) === undefined) pending.set(e.path, e.before)
      return
    }
    const key = pendingKey(e.path)
    const tracked = find(e.path)
    if (!tracked && key === undefined) return
    const baseline = tracked ? tracked.baseline : pending.get(key!)!
    if (key !== undefined) pending.delete(key)
    if (update(tracked?.path ?? e.path, baseline, await readDisk(e.path))) {
      for (const l of changeListeners) l(tracked?.path ?? e.path)
    }
  }

  /** A file's text changed outside Claude's tools (the user saved, or another program wrote it). */
  function noteText(path: string, text: string) {
    const f = find(path)
    if (f) update(f.path, f.baseline, text)
  }

  /** Files changed on disk (workspace watcher): refresh the ones under review. */
  async function onDiskChange(paths: string[]) {
    for (const f of [...files.value]) {
      if (paths.some((p) => samePath(p, f.path))) update(f.path, f.baseline, await readDisk(f.path))
    }
  }

  /** Accepted part of a file's changes in the editor: `baseline` is the new reference text. */
  function setBaseline(path: string, baseline: string) {
    const f = find(path)
    if (f) update(f.path, baseline, f.current)
  }

  /** Keep all of Claude's changes to a file. */
  function accept(path: string) {
    const f = find(path)
    if (f) files.value.splice(files.value.indexOf(f), 1)
  }

  /** Undo all of Claude's changes to a file: write the baseline back (or delete a created file). */
  async function reject(path: string) {
    const f = find(path)
    if (!f) return
    if (f.baseline === null) await fs().remove(f.path)
    else await fs().writeText(f.path, f.baseline)
    files.value.splice(files.value.indexOf(f), 1)
  }

  function acceptAll() {
    files.value = []
  }

  async function rejectAll() {
    for (const f of [...files.value]) await reject(f.path)
  }

  /** Forget everything (switching folders). */
  function clear() {
    files.value = []
    pending.clear()
  }

  function onChanged(listener: (path: string) => void) {
    changeListeners.add(listener)
    return () => changeListeners.delete(listener)
  }

  return { files, count, totals, find, onAgentFile, noteText, onDiskChange, setBaseline, accept, reject, acceptAll, rejectAll, clear, onChanged }
})
