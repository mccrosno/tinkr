import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'
import type { PluginManifest, PluginModule, TinkrApi } from '../src/plugins/api'
import { pluginFileUrl } from '../src/plugins/diskSource'
import { createApi } from '../src/plugins/host'
import { PluginLoader, type PluginSource } from '../src/plugins/loader'
import { keybindingOf, normalizeKeybinding, usePlugins } from '../src/stores/plugins'
import { useSettings } from '../src/stores/settings'
import { useWorkspace } from '../src/stores/workspace'
import { FakeFs } from './fakeFs'

// The registry gives each panel a container element. Bun has no DOM; this is all it uses.
class FakeElement {
  className = ''
  dataset: Record<string, string> = {}
  textContent = ''
  removed = false
  remove() {
    this.removed = true
  }
}
const realDocument = (globalThis as { document?: unknown }).document
beforeAll(() => {
  ;(globalThis as { document?: unknown }).document = { createElement: () => new FakeElement() }
})
afterAll(() => {
  ;(globalThis as { document?: unknown }).document = realDocument
})

/** Plugins defined in code, served like a plugins folder. */
class FakeSource implements PluginSource {
  dir = '/home/me/.config/tinkr/plugins'
  modules = new Map<string, PluginModule>()
  manifests = new Map<string, PluginManifest | string>()
  imports: string[] = []
  onChange: (paths: string[]) => void = () => {}
  add(name: string, module: PluginModule, manifest: Partial<PluginManifest> = {}) {
    this.manifests.set(name, { name, ...manifest })
    this.modules.set(name, module)
  }
  async list() {
    return [...this.manifests.keys()]
  }
  async manifest(name: string) {
    const m = this.manifests.get(name)
    if (m === undefined) throw new Error('not found')
    if (typeof m === 'string') throw new Error(m)
    return m
  }
  async importModule(name: string, main: string, version: number) {
    this.imports.push(`${name}@${version}`)
    const m = this.modules.get(name)
    if (!m) throw new Error(`cannot import ${main}`)
    return m
  }
  async watch(onChange: (paths: string[]) => void) {
    this.onChange = onChange
    return () => {}
  }
  /** As the watcher would report a change inside plugin `name`. */
  touch(name: string) {
    this.onChange([`${this.dir}/${name}/index.js`])
  }
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))
let source: FakeSource
let asked: string[]
let answer: boolean
let loader: PluginLoader
let registry: ReturnType<typeof usePlugins>

beforeEach(async () => {
  setActivePinia(createPinia())
  registry = usePlugins()
  await useSettings().load(new FakeFs({ '/home/me/.config/tinkr': null }), '/home/me/.config/tinkr/settings.json')
  source = new FakeSource()
  asked = []
  answer = true
  loader = new PluginLoader(source, async (m) => (asked.push(m.name), answer), 5)
})

/** Start up as the app does: built-ins, disk, then the deferred questions. */
async function boot() {
  await loader.loadFromDisk()
  await loader.askPending()
}

describe('plugin loading', () => {
  test('a new plugin is asked about once; yes loads it and is remembered', async () => {
    let activated = 0
    source.add('notes', { activate: () => void activated++ })
    await boot()
    expect(asked).toEqual(['notes'])
    expect(activated).toBe(1)
    expect(registry.record('notes')?.state).toBe('active')
    expect(useSettings().approval('notes')).toBe(true)

    // Next launch: no question.
    const again = new PluginLoader(source, async (m) => (asked.push(m.name), true), 5)
    await again.loadFromDisk()
    await again.askPending()
    expect(asked).toEqual(['notes'])
  })

  test('startup does not wait for the question; the plugin waits for the answer', async () => {
    source.add('notes', { activate: () => {} })
    await loader.loadFromDisk()
    expect(asked).toEqual([])
    expect(registry.record('notes')?.state).toBe('awaiting-approval')
    await loader.askPending()
    expect(registry.record('notes')?.state).toBe('active')
  })

  test('no keeps it off, and it can be turned on later', async () => {
    answer = false
    source.add('notes', { activate: () => {} })
    await boot()
    expect(registry.record('notes')?.state).toBe('disabled')
    expect(source.imports).toEqual([]) // its code never ran
    await loader.setEnabled('notes', true)
    expect(registry.record('notes')?.state).toBe('active')
  })

  test('errors are recorded and logged, and what it registered before failing is removed', async () => {
    source.add('broken', {
      activate(api) {
        api.commands.register({ id: 'half', title: 'Half done', run() {} })
        throw new Error('boom')
      },
    })
    await boot()
    expect(registry.record('broken')).toMatchObject({ state: 'error', error: 'boom' })
    expect(registry.commands.has('broken.half')).toBe(false)
    expect(registry.log.some((l) => l.plugin === 'broken' && l.level === 'error' && l.text.includes('boom'))).toBe(true)
  })

  test('bad manifests: invalid JSON, a name that does not match the folder, no activate()', async () => {
    source.manifests.set('badjson', "plugin.json isn't valid JSON: Unexpected token")
    source.add('renamed', { activate: () => {} }, { name: 'other' })
    source.add('noactivate', {} as PluginModule)
    await boot()
    expect(registry.record('badjson')?.state).toBe('error')
    expect(registry.record('renamed')?.error).toMatch(/must match/)
    expect(registry.record('noactivate')?.error).toMatch(/activate\(api\)/)
  })

  test('a folder without plugin.json is skipped quietly (it may be half written)', async () => {
    source.manifests.set('halfway', undefined as unknown as string)
    source.manifests.delete('halfway')
    await boot()
    expect(registry.plugins).toEqual([])
  })

  test('hot reload: a change re-imports with a new version and re-activates; panels keep their place', async () => {
    let n = 0
    source.add('notes', {
      activate(api) {
        n++
        api.panels.register({ id: 'main', title: `Notes ${n}`, mount: () => {} })
      },
      deactivate() {
        n += 100
      },
    })
    await boot()
    const removed: string[] = []
    registry.onPanelRemoved((id) => removed.push(id))
    source.touch('notes')
    source.touch('notes') // a burst of writes reloads once
    await tick(60)
    expect(source.imports).toEqual(['notes@1', 'notes@2'])
    expect(registry.panels.get('notes.main')?.title).toBe('Notes 102')
    expect(removed).toEqual([]) // re-registered: the dock keeps it where it was
  })

  test('a panel the reloaded plugin no longer registers is removed', async () => {
    let first = true
    source.add('notes', {
      activate(api) {
        if (first) api.panels.register({ id: 'old', title: 'Old', mount: () => {} })
        first = false
      },
    })
    await boot()
    const removed: string[] = []
    registry.onPanelRemoved((id) => removed.push(id))
    await loader.reload('notes')
    expect(removed).toEqual(['notes.old'])
  })

  test('a deleted plugin folder unloads the plugin', async () => {
    let cleaned = false
    source.add('notes', { activate: (api) => void api.panels.register({ id: 'p', title: 'P', mount: () => () => (cleaned = true) }) })
    await boot()
    source.manifests.delete('notes')
    source.touch('notes')
    await tick(60)
    expect(cleaned).toBe(true)
    expect(registry.record('notes')).toBeUndefined()
    expect(registry.panels.size).toBe(0)
  })

  test('built-ins always run and keep bare ids', async () => {
    await loader.loadBuiltIns([{ manifest: { name: 'core' }, activate: (api) => void api.commands.register({ id: 'chat.new', title: 'New chat', run: () => 7 }) }])
    expect(await registry.executeCommand('chat.new')).toBe(7)
  })
})

describe('the plugin API', () => {
  let api: TinkrApi
  beforeEach(() => {
    api = createApi({ name: 'notes', manifest: { name: 'notes' }, dir: '/p/notes', builtIn: false }).api
  })

  test('ids are prefixed with the plugin name; duplicates are refused', () => {
    api.commands.register({ id: 'go', title: 'Go', keybinding: 'Ctrl+Alt+G', run() {} })
    expect(registry.commands.get('notes.go')?.keybinding).toBe('ctrl+alt+g')
    expect(() => api.commands.register({ id: 'go', title: 'Again', run() {} })).toThrow(/already registered/)
  })

  test('disposeAll removes everything the plugin registered', () => {
    const handle = createApi({ name: 'x', manifest: { name: 'x' }, dir: null, builtIn: false })
    handle.api.commands.register({ id: 'a', title: 'A', run() {} })
    handle.api.actions.register({ id: 'b', slot: 'titlebar', title: 'B', run() {} })
    handle.api.panels.register({ id: 'c', title: 'C', mount: () => {} })
    handle.api.layout.registerPreset({ id: 'd', name: 'D', layout: {} })
    handle.disposeAll()
    expect([registry.commands.size, registry.actions.length, registry.panels.size, registry.presets.length]).toEqual([0, 0, 0, 0])
  })

  test('agent, fs and pty need their permission; using them without it explains how to ask', () => {
    expect(() => api.agent.busy()).toThrow(/needs "agent" in the "permissions" list of notes\/plugin.json/)
    expect(() => api.terminal.create()).toThrow(/"pty"/)
    expect(() => api.workspace.readText('a.txt')).toThrow(/"fs"/)
    expect(api.workspace.root()).toBeNull() // reading the folder's path is always allowed
  })

  test('file access stays inside the open folder', async () => {
    const withFs = createApi(
      { name: 'files', manifest: { name: 'files', permissions: ['fs'] }, dir: null, builtIn: false },
      new FakeFs({ '/proj/a.txt': 'hello', '/secret.txt': 'no' }),
    ).api
    useWorkspace().root = '/proj'
    expect(await withFs.workspace.readText('a.txt')).toBe('hello')
    expect(await withFs.workspace.readText('/proj/a.txt')).toBe('hello')
    await expect(withFs.workspace.readText('/secret.txt')).rejects.toThrow(/outside the open folder/)
    await expect(withFs.workspace.readText('../secret.txt')).rejects.toThrow(/".." isn't allowed/)
  })

  test('settings are per plugin and survive as JSON', async () => {
    await api.settings.set('count', 3)
    const heard: string[] = []
    api.settings.onDidChange((k) => heard.push(k))
    await api.settings.set('list', [1, 2])
    expect(api.settings.get('count', 0)).toBe(3)
    expect(api.settings.get('missing', 'x')).toBe('x')
    expect(heard).toEqual(['list'])
    expect(useSettings().data.plugin?.notes).toEqual({ count: 3, list: [1, 2] })
  })

  test('panels: mounted once into their own element, told about visibility, cleaned up on dispose', () => {
    const seen: boolean[] = []
    let mounts = 0
    let cleaned = false
    const d = api.panels.register({
      id: 'main',
      title: 'Main',
      location: 'bottom',
      mount(el, ctx) {
        mounts++
        ;(el as unknown as FakeElement).textContent = 'hi'
        ctx.onDidChangeVisibility((v) => seen.push(v))
        ctx.setTitle('Renamed')
        return () => (cleaned = true)
      },
    })
    const entry = registry.panels.get('notes.main')!
    expect(entry).toMatchObject({ title: 'Renamed', location: 'bottom', closable: true })
    registry.setPanelVisible('notes.main', true)
    registry.setPanelVisible('notes.main', true) // no change, no call
    registry.setPanelVisible('notes.main', false)
    expect(seen).toEqual([true, false])
    expect(mounts).toBe(1)
    d.dispose()
    expect(cleaned).toBe(true)
    expect((entry.el as unknown as FakeElement).removed).toBe(true)
  })

  test('a panel whose mount throws shows the error instead of breaking the app', () => {
    api.panels.register({
      id: 'bad',
      title: 'Bad',
      mount() {
        throw new Error('nope')
      },
    })
    expect((registry.panels.get('notes.bad')!.el as unknown as FakeElement).textContent).toMatch(/failed to start: nope/)
  })
})

describe('keys and URLs', () => {
  test('key events match normalized bindings (Cmd counts as Ctrl; letters by physical key)', () => {
    const ev = (key: string, code: string, mods: Partial<KeyboardEvent> = {}) =>
      ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key, code, ...mods }) as KeyboardEvent
    expect(keybindingOf(ev('P', 'KeyP', { ctrlKey: true, shiftKey: true }))).toBe(normalizeKeybinding('Ctrl+Shift+P'))
    expect(keybindingOf(ev('o', 'KeyO', { metaKey: true }))).toBe(normalizeKeybinding('Cmd+O'))
    expect(keybindingOf(ev('¡', 'Digit1', { ctrlKey: true, altKey: true }))).toBe(normalizeKeybinding('Ctrl+Alt+1'))
    expect(keybindingOf(ev('`', 'Backquote', { ctrlKey: true }))).toBe(normalizeKeybinding('Ctrl+`'))
  })

  test('plugin file URLs: one escaped segment per path part, the version in front', () => {
    expect(pluginFileUrl('http://tinkr-plugin.localhost', 'notes', 3, 'index.js')).toBe('http://tinkr-plugin.localhost/notes/3/index.js')
    expect(pluginFileUrl('tinkr-plugin://localhost', 'notes', 4, './lib\\my file.js')).toBe('tinkr-plugin://localhost/notes/4/lib/my%20file.js')
  })
})
