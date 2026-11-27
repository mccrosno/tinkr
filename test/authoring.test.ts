// Claude writing plugins: the authoring kit, the report its tools get, and attributing
// uncaught errors to a plugin.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { KIT_MARKER, writeKit, type KitFs } from '../src/plugins/authoring/write'
import type { PluginManifest, PluginModule } from '../src/plugins/api'
import { PluginLoader, type PluginSource } from '../src/plugins/loader'
import { reportPlugin } from '../src/plugins/report'
import { logUncaught, pluginIn } from '../src/plugins/uncaught'
import { usePlugins } from '../src/stores/plugins'
import { useReview } from '../src/stores/review'
import { useSettings } from '../src/stores/settings'
import { useWorkspace } from '../src/stores/workspace'
import { FakeFs, FakeHost } from './fakeFs'

// Bun has no DOM; this is what the registry and the guide's example panel use.
const element = () => ({ className: '', dataset: {}, style: {}, textContent: '', value: '', remove() {}, append() {}, addEventListener() {} })
const realDocument = (globalThis as { document?: unknown }).document
beforeAll(() => {
  ;(globalThis as { document?: unknown }).document = { createElement: element }
})
afterAll(() => {
  ;(globalThis as { document?: unknown }).document = realDocument
})

const DIR = '/home/me/.config/tinkr/plugins'
const source = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n')

class Source implements PluginSource {
  dir = DIR
  plugins = new Map<string, { manifest: PluginManifest; module: PluginModule }>()
  imports = 0
  onChange: (paths: string[]) => void = () => {}
  add(name: string, module: PluginModule, manifest: Partial<PluginManifest> = {}) {
    this.plugins.set(name, { manifest: { name, ...manifest }, module })
  }
  async list() {
    return [...this.plugins.keys()]
  }
  async manifest(name: string) {
    const p = this.plugins.get(name)
    if (!p) throw new Error('No such file or directory (os error 2)')
    return p.manifest
  }
  async importModule(name: string) {
    this.imports++
    return this.plugins.get(name)!.module
  }
  async readFile(): Promise<string> {
    throw new Error('not found')
  }
  fileUrl(name: string, path: string) {
    return `tinkr-plugin://localhost/${name}/1/${path}`
  }
  async watch(onChange: (paths: string[]) => void) {
    this.onChange = onChange
    return () => {}
  }
}

let disk: Source
let loader: PluginLoader
let registry: ReturnType<typeof usePlugins>
let answer: boolean

beforeEach(async () => {
  setActivePinia(createPinia())
  registry = usePlugins()
  registry.dir = DIR
  await useSettings().load(new FakeFs({ '/home/me/.config/tinkr': null }), '/home/me/.config/tinkr/settings.json')
  disk = new Source()
  answer = true
  loader = new PluginLoader(disk, async () => answer, 5)
  await loader.loadFromDisk()
  await loader.askPending()
})

const report = (action: 'reload' | 'status', name: string) => reportPlugin(loader, action, name, 0)

describe('reload_plugin and plugin_status', () => {
  test('a new plugin is loaded and described', async () => {
    disk.add('notes', {
      activate(api) {
        api.panels.register({ id: 'panel', title: 'Notes', mount: () => {} })
        api.commands.register({ id: 'open', title: 'Open', keybinding: 'Ctrl+Alt+N', run() {} })
        api.actions.register({ id: 'go', slot: 'titlebar', title: 'Go', run() {} })
      },
    })
    const r = await report('reload', 'notes')
    expect(r.isError).toBe(false)
    expect(r.text).toContain('Plugin "notes": on')
    expect(r.text).toContain('panels: notes.panel; commands: notes.open (ctrl+alt+n); actions: notes.go (titlebar)')
  })

  test('a failure to load is an error, with its message', async () => {
    disk.add('broken', {
      activate() {
        throw new Error('boom')
      },
    })
    const r = await report('reload', 'broken')
    expect(r.isError).toBe(true)
    expect(r.text).toContain('failed to load')
    expect(r.text).toContain('Error: boom')
  })

  test('loading with a panel that fails to mount is reported, and a fix clears it', async () => {
    let broken = true
    disk.add('notes', {
      activate(api) {
        api.panels.register({
          id: 'panel',
          title: 'Notes',
          mount() {
            if (broken) throw new Error('no element')
          },
        })
      },
    })
    const first = await report('reload', 'notes')
    expect(first.isError).toBe(true)
    expect(first.text).toContain('on, but it logged errors')
    expect(first.text).toContain('failed to mount')
    broken = false
    const second = await report('reload', 'notes')
    expect(second.isError).toBe(false)
    expect(second.text).not.toContain('no element') // only what this load logged
  })

  test('status shows errors logged later, without reloading', async () => {
    disk.add('notes', { activate: () => {} })
    await report('reload', 'notes')
    registry.addLog('notes', 'error', 'the button did nothing')
    const r = await report('status', 'notes')
    expect(r.text).toContain('[error] the button did nothing')
    expect(disk.imports).toBe(1)
  })

  test('a plugin the user declined stays off', async () => {
    answer = false
    disk.add('notes', { activate: () => {} })
    const r = await report('reload', 'notes')
    expect(r.isError).toBe(true)
    expect(r.text).toContain('off (the user turned it off')
    expect(disk.imports).toBe(0)
  })

  test('missing folders, bad names and built-ins are refused with the reason', async () => {
    await loader.loadBuiltIns([{ manifest: { name: 'chat' }, activate: () => {} }])
    expect((await report('reload', 'nothing')).text).toContain("there's no nothing/plugin.json")
    expect((await report('status', 'nothing')).text).toContain('Call reload_plugin')
    expect((await report('reload', '../x')).text).toContain("can't be a plugin folder name")
    expect((await report('reload', 'chat')).text).toContain('built into Tinkr')
    expect(registry.record('chat')?.state).toBe('active')
    expect((await reportPlugin(null, 'reload', 'x', 0)).isError).toBe(true)
  })

  test('a plugin whose plugin.json is gone is forgotten (its new file was rejected)', async () => {
    disk.add('notes', { activate: (api) => void api.panels.register({ id: 'p', title: 'P', mount: () => {} }) })
    await report('reload', 'notes')
    const removed: string[] = []
    registry.onPanelRemoved((id) => removed.push(id))
    disk.plugins.delete('notes')
    disk.list = async () => ['notes'] // the folder is still there
    const r = await report('reload', 'notes')
    expect(r.isError).toBe(true)
    expect(registry.record('notes')).toBeUndefined()
    expect(removed).toEqual(['notes.p'])
  })

  test('a reload asked for covers the change the watcher saw, and others hear of changed files', async () => {
    disk.add('notes', { activate: () => {} })
    const changed: string[][] = []
    loader.onFilesChanged((p) => changed.push(p))
    disk.onChange([`${DIR}/notes/index.js`])
    await report('reload', 'notes')
    await new Promise((r) => setTimeout(r, 30))
    expect(disk.imports).toBe(1)
    expect(changed).toEqual([[`${DIR}/notes/index.js`]])
  })
})

describe('uncaught errors', () => {
  test('the plugin is read from a file URL, on every platform', () => {
    expect(pluginIn('at run (http://tinkr-plugin.localhost/notes/3/index.js:4:2)')).toBe('notes')
    expect(pluginIn('tinkr-plugin://localhost/word-count/12/lib/count.js')).toBe('word-count')
    expect(pluginIn('at http://localhost:1420/src/main.ts')).toBeNull()
  })

  test("an error from a plugin's code is logged under it; others are ignored", () => {
    registry.upsertPlugin({ name: 'notes', manifest: { name: 'notes' }, builtIn: false, dir: `${DIR}/notes`, state: 'active' })
    const error = new Error('later')
    error.stack = 'Error: later\n    at http://tinkr-plugin.localhost/notes/2/index.js:9:1'
    logUncaught(error)
    logUncaught(new Error('from Tinkr itself'))
    expect(registry.log).toHaveLength(1)
    expect(registry.log[0]).toMatchObject({ plugin: 'notes', level: 'error' })
    expect(registry.log[0].text).toContain('uncaught error: Error: later')
  })
})

test('files under review in the plugins folder are named from it', async () => {
  const fs = new FakeFs({ '/p/a.ts': 'a', [`${DIR}/notes/index.js`]: 'new' })
  const ws = useWorkspace()
  ws.configure({ fs, host: new FakeHost(fs) })
  await ws.openFolder('/p')
  const review = useReview()
  const path = `${DIR}/notes/index.js`
  await review.onAgentFile({ type: 'fileWillChange', turnId: 't', toolUseId: 'u', path, before: null })
  await review.onAgentFile({ type: 'fileChanged', turnId: 't', toolUseId: 'u', path })
  expect(review.files[0].relPath).toBe('plugins/notes/index.js')
})

describe('the authoring kit', () => {
  const memory = (files: Record<string, string> = {}) => {
    const store = new Map(Object.entries(files))
    const made: string[] = []
    const fs: KitFs = {
      async readText(p) {
        const text = store.get(p)
        if (text === undefined) throw new Error('not found')
        return text
      },
      writeText: async (p, text) => void store.set(p, text),
      mkdir: async (p) => void made.push(p),
    }
    return { fs, store, made }
  }
  const files = [
    { path: 'CLAUDE.md', text: `${KIT_MARKER} v2` },
    { path: '.claude/skills/x/SKILL.md', text: `${KIT_MARKER} skill` },
  ]

  test('writes missing files, creating folders, and updates only its own', async () => {
    const { fs, store, made } = memory()
    expect(await writeKit(fs, DIR, files)).toEqual(['CLAUDE.md', '.claude/skills/x/SKILL.md'])
    expect(made).toEqual([`${DIR}/.claude/skills/x`])
    expect(await writeKit(fs, DIR, files)).toEqual([]) // unchanged: not written again
    store.set(`${DIR}/CLAUDE.md`, `${KIT_MARKER} v1`)
    expect(await writeKit(fs, DIR, files)).toEqual(['CLAUDE.md'])
  })

  test("a file without Tinkr's marker is the user's", async () => {
    const { fs, store } = memory({ [`${DIR}/CLAUDE.md`]: 'my own notes' })
    await writeKit(fs, DIR, files)
    expect(store.get(`${DIR}/CLAUDE.md`)).toBe('my own notes')
  })

  test('the guide and skill carry the marker, and the skill starts with its frontmatter', () => {
    expect(source('plugins/authoring/guide.md')).toContain(KIT_MARKER)
    const skill = source('plugins/authoring/skill.md')
    expect(skill).toContain(KIT_MARKER)
    expect(skill.startsWith('---\nname: tinkr-plugin\ndescription: ')).toBe(true)
  })

  test('api.ts can ship as a .d.ts: no imports, only types', () => {
    const api = source('plugins/api.ts')
    expect(api).not.toMatch(/^\s*import\s/m)
    expect(api).not.toMatch(/^(export\s+)?(const|let|var|function|class|enum)\s/m)
  })

  test("the guide's example plugin loads", async () => {
    const guide = source('plugins/authoring/guide.md')
    const block = (lang: string) => new RegExp('```' + lang + '\\n([\\s\\S]*?)```').exec(guide)![1]
    const folder = mkdtempSync(join(tmpdir(), 'tinkr-guide-'))
    try {
      writeFileSync(join(folder, 'index.mjs'), block('js'))
      const manifest = JSON.parse(block('json')) as PluginManifest
      disk.add(manifest.name, (await import(pathToFileURL(join(folder, 'index.mjs')).href)) as PluginModule, manifest)
      const r = await report('reload', manifest.name)
      expect(r.text).toContain('panels: notes.panel; commands: notes.open (ctrl+alt+n)')
      expect(r.isError).toBe(false)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
