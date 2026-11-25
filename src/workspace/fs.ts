// File access used by the workspace and editor. The real implementation goes through
// Tauri's fs plugin (Rust-backed and limited to opened project folders); tests use a fake.

import { readDir, readTextFile, stat, watch, writeTextFile } from '@tauri-apps/plugin-fs'

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
}

export interface FileSystem {
  readDir(dir: string): Promise<DirEntry[]>
  readText(path: string): Promise<string>
  writeText(path: string, text: string): Promise<void>
  size(path: string): Promise<number>
  /** Watch a folder recursively. The callback gets changed paths (debounced). Returns an unwatch function. */
  watch(root: string, onChange: (paths: string[]) => void): Promise<() => void>
}

/** Join with the separator the root already uses, so Windows paths stay `C:\a\b`. */
export function joinPath(dir: string, name: string) {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return dir.endsWith(sep) ? dir + name : dir + sep + name
}

export function parentOf(path: string) {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i > 0 ? path.slice(0, i) : path
}

export function baseName(path: string) {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

/** Compare paths the way the OS would (case-insensitive and either slash on Windows). */
export function samePath(a: string, b: string) {
  // Windows paths have a drive letter (C:) or backslashes; they ignore case and slash style.
  const isWindows = (p: string) => /^[a-zA-Z]:/.test(p) || p.includes('\\')
  const norm = (p: string) => (isWindows(p) ? p.replace(/\//g, '\\').toLowerCase() : p).replace(/[\\/]+$/, '')
  return norm(a) === norm(b)
}

export const tauriFs: FileSystem = {
  async readDir(dir) {
    const entries = await readDir(dir)
    return entries.map((e) => ({ name: e.name, path: joinPath(dir, e.name), isDir: e.isDirectory }))
  },
  readText: (path) => readTextFile(path),
  writeText: (path, text) => writeTextFile(path, text),
  async size(path) {
    return (await stat(path)).size
  },
  async watch(root, onChange) {
    return watch(root, (event) => onChange(event.paths), { recursive: true, delayMs: 150 })
  },
}
