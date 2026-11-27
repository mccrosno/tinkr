// Live check of Claude writing plugins, without the app (uses your real Claude Code login:
// two or three short turns on Haiku, a few cents).
// Usage: bun sidecar/scripts/plugin-smoke.ts
//
// Everything happens in temporary folders. Checks: Claude writes a plugin in a chat
// without a folder; the user is asked once ("allow for this chat") and gets review
// baselines; Claude calls reload_plugin and reads the answer; and in a project whose own
// Claude Code settings allow every edit, a plugin edit is still asked about, and denying
// it leaves the file alone, as does an attempt to edit Tinkr's settings.json.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PermissionDecision, SidecarEvent } from '../../shared/protocol'
import { Agent } from '../src/agent'
import { findCli } from '../src/cli'
import { deleteChat } from '../src/history'
import { MIN_CLI_VERSION } from '../src/sdkVersion.generated'

const cli = await findCli(MIN_CLI_VERSION)
if (cli.state !== 'ok') throw new Error(`Claude Code CLI: ${cli.state}`)

// The real path: Windows' temp folder can be given in its short "NAME~1" form.
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'tinkr-plugin-smoke-')))
const plugins = join(base, 'tinkr', 'plugins')
const settings = join(base, 'tinkr', 'settings.json')
const project = join(base, 'project')
mkdirSync(plugins, { recursive: true })
mkdirSync(join(project, '.claude'), { recursive: true })
writeFileSync(settings, '{ "plugins": {} }\n')
// A user's own "allow every edit" rule: Tinkr must still ask about plugin files.
writeFileSync(join(project, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Edit', 'Write'] } }))
const kit = new URL('../../src/plugins/', import.meta.url)
writeFileSync(join(plugins, 'CLAUDE.md'), readFileSync(new URL('authoring/guide.md', kit)))
writeFileSync(join(plugins, 'tinkr-api.d.ts'), readFileSync(new URL('api.ts', kit)))

let events: SidecarEvent[] = []
let answerWith: PermissionDecision = 'allowForChat'
const agent = new Agent(
  () => cli.path,
  (e) => {
    events.push(e)
    if (e.type === 'permissionRequest') {
      console.log('  asked:', e.toolName, e.summary, JSON.stringify(e.pluginEdit ?? null), '->', e.pluginEdit ? answerWith : 'deny')
      queueMicrotask(() => agent.respond(e.requestId, e.pluginEdit ? answerWith : 'deny'))
    }
    if (e.type === 'toolUse') console.log('  tool:', e.name, e.summary)
    if (e.type === 'pluginRequest') {
      const ok = existsSync(join(plugins, e.name, 'plugin.json'))
      queueMicrotask(() => agent.answerPluginRequest(e.requestId, { text: ok ? `Plugin "${e.name}": on` : 'No plugin.json found.', isError: !ok }))
    }
  },
)
const sessions: { id: string; folder: string }[] = []
async function turn(id: string, text: string, cwd?: string) {
  events = []
  await agent.send(id, null, text, { cwd, model: 'haiku', pluginsDir: plugins })
  const done = events.find((e) => e.type === 'turnFinished')
  if (done?.type !== 'turnFinished') throw new Error('no turnFinished')
  if (done.sessionId) sessions.push({ id: done.sessionId, folder: cwd ?? homedir() })
  if (done.outcome !== 'success') throw new Error(`turn ${id} ${done.outcome}: ${done.message}`)
}
const of = <T extends SidecarEvent['type']>(type: T) => events.filter((e): e is Extract<SidecarEvent, { type: T }> => e.type === type)
function check(ok: boolean, what: string) {
  if (!ok) throw new Error('FAIL ' + what)
  console.log('PASS', what)
}

try {
  await turn('t1', 'Make a Tinkr plugin called hello with one command that shows a notification saying hi. Keep it minimal.')
  check(existsSync(join(plugins, 'hello', 'plugin.json')) && existsSync(join(plugins, 'hello', 'index.js')), 'Claude wrote the plugin in a chat without a folder')
  check(of('permissionRequest').length === 1 && of('permissionRequest')[0].pluginEdit?.plugin === 'hello', 'asked once, naming the plugin')
  check(of('fileWillChange').some((e) => e.path.endsWith('index.js') && e.before === null), 'the new file has a review baseline')
  check(of('pluginRequest').some((e) => e.action === 'reload' && e.name === 'hello'), 'Claude called reload_plugin')

  const index = join(plugins, 'hello', 'index.js')
  const before = readFileSync(index, 'utf8')
  answerWith = 'deny'
  await turn('t2', `Add the comment "// changed" as the first line of ${index}. If that's refused, stop.`, project)
  check(of('permissionRequest').some((e) => e.pluginEdit?.plugin === 'hello'), "still asked, despite the project's allow-every-edit rule")
  check(readFileSync(index, 'utf8') === before, 'denied: the file is unchanged')

  await turn('t3', `Use the Write tool to replace ${settings} with {}. If that's refused, stop and don't try another way.`, project)
  check(readFileSync(settings, 'utf8') === '{ "plugins": {} }\n', "Tinkr's settings.json can't be written")
  console.log('\nAll checks passed.')
} finally {
  for (const s of sessions) await deleteChat(s.id, s.folder).catch((e) => console.log('  (chat not deleted:', String(e), ')'))
  rmSync(base, { recursive: true, force: true, maxRetries: 3 })
}
process.exit(0)
