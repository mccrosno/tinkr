// In-memory FileSystem + ProjectHost for store tests. Paths use '/'.

import type { DirEntry, FileSystem } from '../src/workspace/fs'
import type { ProjectHost } from '../src/stores/workspace'

export class FakeFs implements FileSystem {
  files = new Map<string, string>()
  dirs = new Set<string>()
  writes: string[] = []
  private watchers: ((paths: string[]) => void)[] = []

  constructor(tree: Record<string, string | null>) {
    for (const [path, content] of Object.entries(tree)) {
      if (content === null) this.addDir(path)
      else this.put(path, content)
    }
  }

  private addDir(path: string) {
    for (let p = path; p && !this.dirs.has(p); p = p.slice(0, p.lastIndexOf('/'))) this.dirs.add(p)
  }
  put(path: string, content: string) {
    this.addDir(path.slice(0, path.lastIndexOf('/')))
    this.files.set(path, content)
  }
  /** Simulate another program changing a file, and fire the watcher. */
  externalWrite(path: string, content: string) {
    this.put(path, content)
    for (const w of this.watchers) w([path])
  }

  async readDir(dir: string): Promise<DirEntry[]> {
    if (!this.dirs.has(dir)) throw new Error(`no such folder: ${dir}`)
    const direct = (p: string) => p.startsWith(dir + '/') && !p.slice(dir.length + 1).includes('/')
    return [
      ...[...this.dirs].filter(direct).map((p) => ({ name: p.slice(dir.length + 1), path: p, isDir: true })),
      ...[...this.files.keys()].filter(direct).map((p) => ({ name: p.slice(dir.length + 1), path: p, isDir: false })),
    ]
  }
  async readText(path: string) {
    const text = this.files.get(path)
    if (text === undefined) throw new Error(`no such file: ${path}`)
    return text
  }
  async writeText(path: string, text: string) {
    this.writes.push(path)
    this.put(path, text)
  }
  async remove(path: string) {
    if (!this.files.delete(path)) throw new Error(`no such file: ${path}`)
    this.writes.push(path)
  }
  async size(path: string) {
    return new TextEncoder().encode(await this.readText(path)).length
  }
  async watch(_root: string, onChange: (paths: string[]) => void) {
    this.watchers.push(onChange)
    return () => (this.watchers = this.watchers.filter((w) => w !== onChange))
  }
}

export class FakeHost implements ProjectHost {
  lastProject: string | null = null
  constructor(private fs: FakeFs) {}
  async getConfig() {
    return { lastProject: this.lastProject, recentProjects: [] }
  }
  async openProject(path: string) {
    if (!this.fs.dirs.has(path)) throw new Error(`not a folder: ${path}`)
    this.lastProject = path
    return path
  }
  async closeProject() {
    this.lastProject = null
  }
  async pickFolder() {
    return null
  }
}
