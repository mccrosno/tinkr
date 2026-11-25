// Terminal tabs and their shells. The store owns the lifecycle (spawn, exit, close);
// each tab's xterm.js instance lives in TerminalView.vue, which calls `start()` once it
// knows how many columns and rows fit, and receives the shell's output.

import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { tauriPty, type PtyHost, type PtySession } from '../terminal/pty'

export type TerminalStatus = 'starting' | 'running' | 'exited' | 'failed'

export interface TerminalTab {
  key: number
  title: string
  cwd: string
  status: TerminalStatus
  /** The shell's process id once it has started. */
  pid: number | null
  exitCode: number | null
  error: string | null
}

/** Where a tab's output goes (its xterm.js instance). */
export interface TerminalOutput {
  onData(bytes: Uint8Array): void
  /** The shell exited with a non-zero code (the tab stays open to show it). */
  onExit(exitCode: number): void
}

let nextKey = 1

export const useTerminal = defineStore('terminal', () => {
  const pty = shallowRef<PtyHost>(tauriPty)
  const tabs = ref<TerminalTab[]>([])
  const activeKey = ref<number | null>(null)
  const visible = ref(false)
  /** Live shells by tab key. Not reactive: these are handles, not UI state. */
  const sessions = new Map<number, PtySession>()

  const active = computed(() => tabs.value.find((t) => t.key === activeKey.value) ?? null)
  const runningCount = computed(() => tabs.value.filter((t) => t.status === 'running' || t.status === 'starting').length)

  /** Use a different PTY host (tests). */
  function configure(deps: { pty?: PtyHost }) {
    if (deps.pty) pty.value = deps.pty
  }

  // Look tabs up by key each time rather than holding on to an object: `tabs` holds
  // reactive proxies, and writes must go through them for the UI to update.
  const find = (key: number) => tabs.value.find((t) => t.key === key)

  /** Add a terminal tab working in `cwd` and show it. Its shell starts when the view calls `start`. */
  function create(cwd: string) {
    const key = nextKey++
    tabs.value.push({ key, title: 'Terminal', cwd, status: 'starting', pid: null, exitCode: null, error: null })
    activeKey.value = key
    visible.value = true
    return key
  }

  /** Start the shell for tab `key`, sized to its view. */
  async function start(key: number, size: { cols: number; rows: number }, output: TerminalOutput) {
    const tab = find(key)
    if (!tab || sessions.has(key)) return
    let session: PtySession
    try {
      session = await pty.value.spawn(
        { cwd: tab.cwd, ...size },
        {
          onData: (bytes) => output.onData(bytes),
          onExit: (code) => onExit(key, code, output),
        },
      )
    } catch (e) {
      const t = find(key)
      if (t) Object.assign(t, { status: 'failed', error: String(e) })
      return
    }
    const t = find(key)
    if (!t) {
      // The tab was closed while the shell was starting.
      session.kill().catch(() => {})
      return
    }
    sessions.set(key, session)
    // Already exited (a shell that failed instantly)? Then leave its status alone.
    if (t.status === 'starting') t.status = 'running'
    t.pid = session.pid
    t.title = uniqueTitle(session.shellName, key)
  }

  /** "pwsh", then "pwsh 2", "pwsh 3" for more tabs running the same shell. */
  function uniqueTitle(name: string, key: number) {
    const taken = new Set(tabs.value.filter((t) => t.key !== key).map((t) => t.title))
    if (!taken.has(name)) return name
    let n = 2
    while (taken.has(`${name} ${n}`)) n++
    return `${name} ${n}`
  }

  function onExit(key: number, exitCode: number, output: TerminalOutput) {
    sessions.delete(key)
    const tab = find(key)
    if (!tab) return // closed by the user; nothing to show
    // A clean exit (typing `exit`) closes the tab, like VS Code. Otherwise keep it so
    // the user can see what went wrong.
    if (exitCode === 0) return close(key)
    Object.assign(tab, { status: 'exited', exitCode })
    output.onExit(exitCode)
  }

  function write(key: number, data: string) {
    sessions.get(key)?.write(data).catch(() => {})
  }

  function resize(key: number, cols: number, rows: number) {
    sessions.get(key)?.resize(cols, rows).catch(() => {})
  }

  /** Close a tab, killing its shell. Hides the panel when the last tab closes. */
  function close(key: number) {
    const i = tabs.value.findIndex((t) => t.key === key)
    if (i < 0) return
    tabs.value.splice(i, 1)
    sessions.get(key)?.kill().catch(() => {})
    sessions.delete(key)
    if (activeKey.value === key) activeKey.value = (tabs.value[i] ?? tabs.value[i - 1])?.key ?? null
    if (!tabs.value.length) visible.value = false
  }

  /** Close every terminal (switching or closing the project folder). */
  function closeAll() {
    for (const t of [...tabs.value]) close(t.key)
  }

  /** Show or hide the panel. Showing an empty panel opens a terminal in `cwd`. */
  function toggle(cwd: string) {
    if (visible.value) visible.value = false
    else if (tabs.value.length) visible.value = true
    else create(cwd)
  }

  return { tabs, activeKey, active, visible, runningCount, configure, create, start, write, resize, close, closeAll, toggle }
})
