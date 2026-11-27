// Claude writing Tinkr plugins: the permission policy for the plugins folder, and how a
// turn is set up for it. Nothing here starts Claude.

import { describe, expect, test } from 'bun:test'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CanUseTool, HookCallback } from '@anthropic-ai/claude-agent-sdk'
import type { SidecarEvent } from '../../shared/protocol'
import { Agent } from '../src/agent'
import { PLUGIN_TOOLS } from '../src/pluginTools'
import { decide, describeTool, pluginOf } from '../src/tools'

const tinkr = join(homedir(), '.config', 'tinkr')
const plugins = join(tinkr, 'plugins')
const project = join(tmpdir(), 'proj')
const file = (...parts: string[]) => ({ file_path: join(plugins, ...parts) })

describe('policy for the plugins folder', () => {
  test('edits are asked about, naming the plugin, with or without a project', () => {
    for (const open of [project, undefined]) {
      expect(decide('Write', file('notes', 'index.js'), open, plugins)).toEqual({ kind: 'ask', pluginEdit: { plugin: 'notes' } })
    }
  })

  test('a project that contains the plugins folder does not make them automatic', () => {
    expect(decide('Edit', file('notes', 'lib', 'a.js'), homedir(), plugins).kind).toBe('ask')
  })

  test('files outside any plugin have no plugin name', () => {
    expect(pluginOf(join(plugins, 'CLAUDE.md'), plugins)).toEqual({ plugin: null })
    expect(pluginOf(join(plugins, '.claude', 'settings.json'), plugins)).toEqual({ plugin: null })
  })

  test("Tinkr's settings file (plugin approvals) can't be edited, even from the home folder", () => {
    expect(decide('Edit', { file_path: join(tinkr, 'settings.json') }, homedir(), plugins).kind).toBe('deny')
    // Relative to the chat's folder, which is the home folder without a project.
    expect(decide('Write', { file_path: '.config/tinkr/settings.json' }, undefined, plugins).kind).toBe('deny')
  })

  test('".." cannot dress up a path outside as a plugin file', () => {
    expect(decide('Write', { file_path: `${plugins}/notes/../../../../elsewhere.txt` }, undefined, plugins).kind).toBe('deny')
  })

  test('other edits keep the old rules', () => {
    expect(decide('Edit', { file_path: join(project, 'a.ts') }, project, plugins)).toEqual({ kind: 'allow' })
    const denied = decide('Edit', { file_path: join(tmpdir(), 'other.ts') }, undefined, plugins)
    expect(denied.kind === 'deny' && denied.message).toContain(plugins)
  })

  test("Tinkr's plugin tools run without asking", () => {
    expect([...PLUGIN_TOOLS]).toEqual(['mcp__tinkr__reload_plugin', 'mcp__tinkr__plugin_status'])
    for (const name of PLUGIN_TOOLS) expect(decide(name, { name: 'notes' }, undefined, plugins)).toEqual({ kind: 'allow' })
    expect(decide('mcp__other__reload_plugin', {}, undefined, plugins)).toEqual({ kind: 'ask' })
    expect(describeTool('mcp__tinkr__reload_plugin', { name: 'notes' })).toBe('notes')
  })
})

/** An agent whose events the test can read, and the parts of one turn's options. */
function turn(pluginsDir?: string, open?: string) {
  const events: SidecarEvent[] = []
  const agent = new Agent(() => '/claude', (e) => events.push(e))
  const options = agent.turnOptions('t1', '/claude', open, pluginsDir, () => 's1')
  const ask = (input: Record<string, unknown>) =>
    (options.canUseTool as CanUseTool)('Write', input, { signal: new AbortController().signal, toolUseID: 'u', suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] } as never)
  const hook = (input: Record<string, unknown>) =>
    (options.hooks!.PreToolUse![0].hooks[0] as HookCallback)(
      { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: input, tool_use_id: 'u' } as never,
      'u',
      { signal: new AbortController().signal },
    )
  return { agent, events, options, ask, hook }
}

describe('a turn with a plugins folder', () => {
  test('can read it, has the plugin tools and edit tools, and says where it is', () => {
    const { options } = turn(plugins)
    expect(options.additionalDirectories).toEqual([plugins])
    expect(Object.keys(options.mcpServers ?? {})).toEqual(['tinkr'])
    expect(options.disallowedTools).toEqual([])
    expect(JSON.stringify(options.systemPrompt)).toContain('reload_plugin')
  })

  test('without one, nothing changes: no tools, and no edit tools without a project', () => {
    const { options } = turn()
    expect(options.additionalDirectories).toBeUndefined()
    expect(options.mcpServers).toBeUndefined()
    expect(options.disallowedTools).toContain('Write')
    expect(JSON.stringify(options.systemPrompt)).not.toContain('reload_plugin')
  })

  test('"allow for this chat" covers that plugin only, and adds no Claude Code rule', async () => {
    const { agent, events, ask } = turn(plugins)
    const asked = () => events.filter((e) => e.type === 'permissionRequest')
    const first = ask(file('notes', 'index.js'))
    expect(asked()[0]).toMatchObject({ pluginEdit: { plugin: 'notes' }, summary: 'notes/index.js' })
    agent.respond(asked()[0].requestId, 'allowForChat')
    expect(await first).toEqual({ behavior: 'allow', updatedInput: file('notes', 'index.js') })

    expect(await ask(file('notes', 'plugin.json'))).toMatchObject({ behavior: 'allow' })
    expect(asked()).toHaveLength(1)

    const other = ask(file('other', 'index.js'))
    expect(asked()).toHaveLength(2)
    agent.respond(asked()[1].requestId, 'deny')
    expect(await other).toMatchObject({ behavior: 'deny' })
  })

  test('"allow" covers one edit', async () => {
    const { agent, events, ask } = turn(plugins)
    for (const n of [1, 2]) {
      const answer = ask(file('notes', 'index.js'))
      const asked = events.filter((e) => e.type === 'permissionRequest')
      expect(asked).toHaveLength(n)
      agent.respond(asked[n - 1].requestId, 'allow')
      await answer
    }
  })

  test("edits in Tinkr's folder always go to the permission check, and get a review baseline", async () => {
    const { events, hook } = turn(plugins, project)
    const forced = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' } } as const
    expect(await hook(file('tinkr-test-missing', 'index.js'))).toEqual(forced)
    expect(await hook({ file_path: join(tinkr, 'settings.json') })).toEqual(forced)
    expect(await hook({ file_path: join(project, 'a.ts') })).toEqual({})
    expect(events.filter((e) => e.type === 'fileWillChange').map((e) => e.path)).toEqual([
      join(plugins, 'tinkr-test-missing', 'index.js'),
      join(project, 'a.ts'),
    ])
  })

  test('a plugin tool call waits for the app; stopping the turn answers it', async () => {
    const { agent, events } = turn(plugins)
    const first = agent.askApp('t1', 'reload', 'notes')
    const request = events.find((e) => e.type === 'pluginRequest')!
    expect(request).toMatchObject({ turnId: 't1', action: 'reload', name: 'notes' })
    agent.answerPluginRequest(request.type === 'pluginRequest' ? request.requestId : '', { text: 'on', isError: false })
    expect(await first).toEqual({ text: 'on', isError: false })

    const second = agent.askApp('t1', 'status', 'notes')
    agent.abort('t1')
    expect(await second).toMatchObject({ isError: true })
  })
})
