// Answers Claude's plugin tools (`reload_plugin`, `plugin_status`): reload a plugin if
// asked, then describe it in text Claude can act on - its state, what it registered and
// what it logged.

import { usePlugins, type LogEntry } from '../stores/plugins'
import type { PluginAction } from '../agent/types'
import { isPluginName, type PluginLoader } from './loader'

/** After a reload, how long to wait for errors from code that runs on later (a failed request, a timer). */
const SETTLE_MS = 500
const MAX_LINES = 30
const MAX_LINE = 2000

export interface Report {
  text: string
  isError: boolean
}

const failure = (text: string): Report => ({ text, isError: true })

const STATES = {
  loading: 'still loading',
  active: 'on',
  error: 'failed to load',
  disabled: 'off (the user turned it off or declined it; ask them to turn it on in the Plugins panel)',
  'awaiting-approval': "waiting for the user's OK to run",
} as const

/** "panels: notes.panel; commands: notes.open (ctrl+alt+n)", or "nothing". */
function registered(name: string) {
  const r = usePlugins()
  const mine = <T extends { plugin: string }>(items: Iterable<T>) => [...items].filter((i) => i.plugin === name)
  const parts = [
    ['panels', mine(r.panels.values()).map((p) => p.id)],
    ['commands', mine(r.commands.values()).map((c) => (c.keybinding ? `${c.id} (${c.keybinding})` : c.id))],
    ['actions', mine(r.actions).map((a) => `${a.key} (${a.def.slot})`)],
    ['themes', mine(r.themes).map((t) => t.id)],
    ['layout presets', mine(r.presets).map((p) => p.name)],
  ] as const
  return parts.flatMap(([what, ids]) => (ids.length ? [`${what}: ${ids.join(', ')}`] : [])).join('; ') || 'nothing'
}

function lines(entries: LogEntry[]) {
  const clip = (s: string) => (s.length > MAX_LINE ? s.slice(0, MAX_LINE) + '…' : s)
  const earlier = entries.length - MAX_LINES
  return [...(earlier > 0 ? [`(${earlier} earlier messages left out)`] : []), ...entries.slice(-MAX_LINES).map((l) => `[${l.level}] ${clip(l.text)}`)]
}

export async function reportPlugin(loader: PluginLoader | null, action: PluginAction, name: string, settleMs = SETTLE_MS): Promise<Report> {
  const registry = usePlugins()
  if (!loader || !registry.dir) return failure("Tinkr's plugins folder isn't available, so plugins can't be loaded.")
  if (!isPluginName(name)) return failure(`"${name}" can't be a plugin folder name: use letters, digits, "-", "_" and ".", not starting with a dot.`)
  if (registry.record(name)?.builtIn) return failure(`"${name}" is built into Tinkr, so it can't be reloaded or changed. Pick another folder name.`)

  /** Log ids only grow, so this marks where the reload's messages begin. */
  const mark = registry.log.at(-1)?.id ?? 0
  if (action === 'reload') {
    await loader.reload(name)
    await new Promise((r) => setTimeout(r, settleMs))
  }

  const log = registry.log.filter((l) => l.plugin === name && (action === 'status' || l.id > mark))
  const record = registry.record(name)
  if (!record) {
    const missing =
      action === 'reload'
        ? `No plugin was loaded: there's no ${name}/plugin.json in ${registry.dir}.`
        : `Tinkr hasn't loaded a plugin named "${name}". Call reload_plugin to load it from ${registry.dir}.`
    return failure([missing, ...lines(log)].join('\n'))
  }

  const errors = action === 'reload' && log.some((l) => l.level === 'error')
  const text = [
    `Plugin "${name}": ${STATES[record.state]}${record.state === 'active' && errors ? ', but it logged errors' : ''}`,
    ...(record.error ? [`Error: ${record.error}`] : []),
    ...(record.state === 'active' ? [`Registered ${registered(name)}`] : []),
    log.length ? `\n${action === 'reload' ? 'Logged during this load' : 'Recent log'}:` : '\nNothing logged.',
    ...lines(log),
  ].join('\n')
  return { text, isError: errors || record.state !== 'active' }
}
