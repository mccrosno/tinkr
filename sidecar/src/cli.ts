// Finding the user's Claude Code CLI and checking its version.
// Tinkr doesn't bundle the CLI (see SPEC.md "Shipping the CLI"): the user installs and
// signs in to Claude Code themselves, and Tinkr reuses it.

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CliStatus } from '../../shared/protocol'

export interface Env {
  platform: NodeJS.Platform
  home: string
  vars: Record<string, string | undefined>
  /** Look a command up on PATH. */
  which: (cmd: string) => string | null
  exists: (path: string) => boolean
}

export const realEnv = (): Env => ({
  platform: process.platform,
  home: homedir(),
  vars: process.env,
  which: (cmd) => Bun.which(cmd),
  exists: existsSync,
})

/**
 * Where to look, in order: an explicit override, PATH, then the native installer's
 * default folder (on Windows it isn't always added to PATH).
 */
export function candidatePaths(env: Env): string[] {
  const exe = env.platform === 'win32' ? 'claude.exe' : 'claude'
  const list: string[] = []
  const override = env.vars.TINKR_CLAUDE_PATH
  if (override) list.push(override)
  const onPath = env.which('claude')
  if (onPath) list.push(onPath)
  list.push(join(env.home, '.local', 'bin', exe))
  return [...new Set(list)]
}

/** "2.1.331 (Claude Code)" -> "2.1.331" */
export function parseVersion(output: string): string | null {
  return output.match(/\d+\.\d+\.\d+/)?.[0] ?? null
}

/** Compare dotted numeric versions: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** Run `<path> --version` with a timeout. */
async function readVersion(path: string): Promise<string> {
  const proc = Bun.spawn([path, '--version'], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  const timeout = setTimeout(() => proc.kill(), 15_000)
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  clearTimeout(timeout)
  if (code !== 0) throw new Error((err || out).trim() || `exited with code ${code}`)
  const version = parseVersion(out)
  if (!version) throw new Error(`unexpected --version output: ${out.trim()}`)
  return version
}

export async function findCli(minVersion: string, env: Env = realEnv(), getVersion = readVersion): Promise<CliStatus> {
  const searched = candidatePaths(env)
  const path = searched.find((p) => env.exists(p))
  if (!path) return { state: 'missing', searched }
  try {
    const version = await getVersion(path)
    if (compareVersions(version, minVersion) < 0) return { state: 'outdated', path, version, minVersion }
    return { state: 'ok', path, version }
  } catch (e) {
    return { state: 'error', path, message: e instanceof Error ? e.message : String(e) }
  }
}
