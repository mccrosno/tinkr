import { describe, expect, test } from 'bun:test'
import { candidatePaths, compareVersions, findCli, parseVersion, type Env } from '../src/cli'

const env = (over: Partial<Env> = {}): Env => ({
  platform: 'win32',
  home: 'C:\\Users\\me',
  vars: {},
  which: () => null,
  exists: () => false,
  ...over,
})

describe('parseVersion', () => {
  test('reads the version from claude --version output', () => {
    expect(parseVersion('2.1.331 (Claude Code)\n')).toBe('2.1.331')
  })
  test('returns null for junk', () => {
    expect(parseVersion('command not found')).toBeNull()
  })
})

describe('compareVersions', () => {
  test('orders numerically, not as strings', () => {
    expect(compareVersions('2.1.331', '2.1.40')).toBeGreaterThan(0)
    expect(compareVersions('2.0.999', '2.1.0')).toBeLessThan(0)
    expect(compareVersions('2.1.331', '2.1.331')).toBe(0)
    expect(compareVersions('3', '2.9.9')).toBeGreaterThan(0)
  })
})

describe('candidatePaths', () => {
  test('override first, then PATH, then the installer folder', () => {
    const paths = candidatePaths(env({ vars: { TINKR_CLAUDE_PATH: 'D:\\claude.exe' }, which: () => 'C:\\bin\\claude.exe' }))
    expect(paths[0]).toBe('D:\\claude.exe')
    expect(paths[1]).toBe('C:\\bin\\claude.exe')
    expect(paths[2]).toMatch(/\.local[\\/]bin[\\/]claude\.exe$/)
  })
  test('no .exe on Linux/macOS', () => {
    expect(candidatePaths(env({ platform: 'linux', home: '/home/me' })).at(-1)).toMatch(/\.local[\\/]bin[\\/]claude$/)
  })
})

describe('findCli', () => {
  const at = (p: string) => env({ exists: (x) => x === p, which: () => p })

  test('missing when nothing exists', async () => {
    const s = await findCli('2.1.0', env(), async () => '9.9.9')
    expect(s.state).toBe('missing')
  })
  test('ok when new enough', async () => {
    expect(await findCli('2.1.0', at('/c'), async () => '2.1.5')).toEqual({ state: 'ok', path: '/c', version: '2.1.5' })
  })
  test('outdated when older than the SDK bundle', async () => {
    const s = await findCli('2.1.331', at('/c'), async () => '2.1.300')
    expect(s).toEqual({ state: 'outdated', path: '/c', version: '2.1.300', minVersion: '2.1.331' })
  })
  test('error when --version fails', async () => {
    const s = await findCli('2.1.0', at('/c'), async () => {
      throw new Error('boom')
    })
    expect(s).toEqual({ state: 'error', path: '/c', message: 'boom' })
  })
})
