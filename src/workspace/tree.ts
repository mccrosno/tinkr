// Pure helpers for the file tree.

import type { DirEntry } from './fs'

/** Folders that are noise in a code project. Hidden from the tree (still on disk, of course). */
export const IGNORED = new Set(['.git', 'node_modules', 'target', '.DS_Store', 'Thumbs.db', '__pycache__', '.venv', '.idea'])

/** Folders first, then files, each sorted case-insensitively with numbers in order. */
export function sortEntries(entries: DirEntry[]): DirEntry[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return entries
    .filter((e) => !IGNORED.has(e.name))
    .sort((a, b) => (a.isDir === b.isDir ? collator.compare(a.name, b.name) : a.isDir ? -1 : 1))
}

/** Rows to render for a tree: depth-first through expanded folders. */
export interface TreeRow {
  entry: DirEntry
  depth: number
  expanded: boolean
}

export function flattenTree(
  root: string,
  children: ReadonlyMap<string, DirEntry[]>,
  expanded: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (dir: string, depth: number) => {
    for (const entry of children.get(dir) ?? []) {
      const isOpen = entry.isDir && expanded.has(entry.path)
      rows.push({ entry, depth, expanded: isOpen })
      if (isOpen) walk(entry.path, depth + 1)
    }
  }
  walk(root, 0)
  return rows
}
