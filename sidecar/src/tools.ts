// Helpers for Claude's tool calls: which tools edit files, whether a path is inside the
// project or the plugins folder, short labels for the UI, and the permission policy.
// Pure functions (plus one file read), so they're unit-tested without running Claude.

import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type { PluginEdit } from '../../shared/protocol'
import { PLUGIN_TOOLS } from './pluginTools'

/** Tools that write files. Their edits are allowed inside the project and reviewed afterwards. */
export const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

/** Same limit as the editor: bigger files aren't diffed. */
export const MAX_BASELINE_BYTES = 2 * 1024 * 1024

/** The file an edit tool targets, or null if this isn't an edit tool (or has no path). */
export function editTarget(toolName: string, input: unknown): string | null {
  if (!EDIT_TOOLS.has(toolName) || !input || typeof input !== 'object') return null
  const i = input as { file_path?: unknown; notebook_path?: unknown }
  const p = i.file_path ?? i.notebook_path
  return typeof p === 'string' && p ? p : null
}

/** Is `path` inside `root` (or `root` itself)? Case-insensitive on Windows. */
export function isInside(path: string, root: string, windows = process.platform === 'win32') {
  const norm = (p: string) => (windows ? resolve(p).toLowerCase() : resolve(p))
  const rel = relative(norm(root), norm(path))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Which plugin a file in the plugins folder belongs to. `plugin` is null for a file
 * that isn't in a plugin: the folder's own CLAUDE.md, or anything under ".claude".
 */
export function pluginOf(path: string, pluginsDir: string): PluginEdit {
  const [first, ...rest] = relative(resolve(pluginsDir), resolve(path)).split(sep)
  return { plugin: rest.length && !first.startsWith('.') ? first : null }
}

/** Show paths relative to the project when they're inside it. */
function shortPath(p: string, cwd: string | undefined) {
  if (cwd && isInside(p, cwd)) return relative(cwd, p).replaceAll('\\', '/') || '.'
  return p
}

const clip = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/** A short label for a tool call, shown next to the tool name in the chat. */
export function describeTool(name: string, input: unknown, cwd?: string): string {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const str = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '')
  const target = editTarget(name, input) ?? (name === 'Read' ? str('file_path') : '')
  if (target) return shortPath(target, cwd)
  switch (name) {
    case 'Bash':
      return clip(str('command').split('\n')[0])
    case 'Glob':
    case 'Grep':
      return clip(str('pattern'))
    case 'WebFetch':
      return clip(str('url'))
    case 'WebSearch':
      return clip(str('query'))
    case 'Task':
    case 'Agent':
      return clip(str('description'))
    default:
      return PLUGIN_TOOLS.has(name) ? clip(str('name')) : ''
  }
}

/** The longer text shown in a permission card (e.g. a whole multi-line command). */
export function permissionDetail(name: string, input: unknown): string | undefined {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  if (name === 'Bash' && typeof i.command === 'string') return i.command
  if (name === 'WebFetch' && typeof i.url === 'string') return i.url
  return undefined
}

export type PolicyDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; message: string }
  /** Ask the user in the chat. `pluginEdit` is set for an edit in the plugins folder. */
  | { kind: 'ask'; pluginEdit?: PluginEdit }

/** Tinkr's own settings file, beside the plugins folder. It records which plugins the user turned on. */
const settingsFile = (pluginsDir: string) => join(dirname(pluginsDir), 'settings.json')

/**
 * What to do when Claude Code asks for permission (it already allows read-only tools
 * and safe commands by itself, so this only sees the rest).
 * - Tinkr's plugin tools: allow. A new plugin still needs the user's OK to run.
 * - Edits to Tinkr's settings file: deny, or Claude could approve its own plugin.
 * - Edits in the plugins folder: ask, even if it's inside the project. Plugin code runs
 *   in Tinkr as soon as it's saved, before the user has reviewed the diff.
 * - Other edits inside the project: allow. The user reviews them as diffs afterwards.
 * - Edits anywhere else: deny. Tinkr only lets Claude change what it can show for review.
 * - Everything else: ask the user.
 */
export function decide(toolName: string, input: unknown, project: string | undefined, pluginsDir?: string): PolicyDecision {
  if (PLUGIN_TOOLS.has(toolName)) return { kind: 'allow' }
  const target = editTarget(toolName, input)
  if (target === null && !EDIT_TOOLS.has(toolName)) return { kind: 'ask' }

  if (target !== null) {
    // A relative path means relative to the chat's folder.
    const path = resolve(project ?? homedir(), target)
    if (pluginsDir) {
      if (isInside(path, settingsFile(pluginsDir))) {
        return { kind: 'deny', message: "Tinkr manages its settings file itself; Claude can't edit it." }
      }
      if (isInside(path, pluginsDir)) return { kind: 'ask', pluginEdit: pluginOf(path, pluginsDir) }
    }
    if (project && isInside(path, project)) return { kind: 'allow' }
  }

  return {
    kind: 'deny',
    message: project
      ? `Tinkr only lets Claude edit files inside the open project folder (${project})${pluginsDir ? ` and the plugins folder (${pluginsDir})` : ''}.`
      : `No project folder is open in Tinkr, so Claude cannot edit files in this chat${pluginsDir ? ` outside the plugins folder (${pluginsDir})` : ''}.`,
  }
}

/**
 * For "allow for this chat": Claude Code suggests rules to remember, often saved to
 * the project's `.claude/settings.local.json`. Tinkr keeps them for this session only,
 * so it never writes to the user's settings files.
 */
export function forThisChat(suggestions: PermissionUpdate[] | undefined): PermissionUpdate[] {
  return (suggestions ?? []).map((s) => ({ ...s, destination: 'session' }) as PermissionUpdate)
}

/**
 * The text of a file before an edit, for review. null = the file doesn't exist yet.
 * undefined = it can't be diffed (too big, binary, unreadable), so it isn't reviewed.
 */
export async function readBaseline(path: string): Promise<string | null | undefined> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_BASELINE_BYTES) return undefined
    const text = await readFile(path, 'utf8')
    return text.includes('\u0000') ? undefined : text
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? null : undefined
  }
}
