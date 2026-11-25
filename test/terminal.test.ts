import { beforeEach, describe, expect, test } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'
import { useTerminal, type TerminalOutput } from '../src/stores/terminal'
import type { PtyHandlers, PtyHost, PtySession } from '../src/terminal/pty'
import { terminalTheme } from '../src/terminal/theme'

/** A fake shell: records what the store sends it and lets the test play the shell's side. */
class FakeSession implements PtySession {
  written: string[] = []
  sizes: [number, number][] = []
  killed = false
  constructor(
    readonly id: number,
    readonly cwd: string,
    readonly handlers: PtyHandlers,
    readonly shellName = 'pwsh',
    readonly pid = 1000 + id,
  ) {}
  async write(data: string) {
    this.written.push(data)
  }
  async resize(cols: number, rows: number) {
    this.sizes.push([cols, rows])
  }
  async kill() {
    this.killed = true
    // A killed process still "exits"; Windows reports code 1.
    queueMicrotask(() => this.handlers.onExit(1))
  }
  /** The shell prints something. */
  print(text: string) {
    this.handlers.onData(new TextEncoder().encode(text))
  }
}

class FakePty implements PtyHost {
  sessions: FakeSession[] = []
  fail: string | null = null
  /** When set, spawn waits for this before finishing (to test closing mid-start). */
  gate: Promise<void> | null = null
  async spawn(options: { cwd: string; cols: number; rows: number }, handlers: PtyHandlers) {
    if (this.gate) await this.gate
    if (this.fail) throw new Error(this.fail)
    const s = new FakeSession(this.sessions.length + 1, options.cwd, handlers)
    s.sizes.push([options.cols, options.rows])
    this.sessions.push(s)
    return s
  }
}

/** Collects what would be written to xterm.js. */
function sink() {
  const out = { text: '', exits: [] as number[] }
  const output: TerminalOutput = {
    onData: (bytes) => (out.text += new TextDecoder().decode(bytes)),
    onExit: (code) => out.exits.push(code),
  }
  return { out, output }
}

const tick = async () => {
  for (let i = 0; i < 5; i++) await Bun.sleep(0)
}

let pty: FakePty
let term: ReturnType<typeof useTerminal>

beforeEach(() => {
  setActivePinia(createPinia())
  pty = new FakePty()
  term = useTerminal()
  term.configure({ pty })
})

describe('terminal store', () => {
  test('toggle on an empty panel opens a terminal in the folder; toggling again hides it', () => {
    expect(term.visible).toBe(false)
    term.toggle('/p')
    expect(term.visible).toBe(true)
    expect(term.tabs.map((t) => t.cwd)).toEqual(['/p'])
    term.toggle('/p')
    expect(term.visible).toBe(false)
    expect(term.tabs).toHaveLength(1) // hidden, not closed
    term.toggle('/p')
    expect(term.tabs).toHaveLength(1) // shows the existing one instead of opening another
  })

  test('start spawns at the view size; input, output and resizes pass through', async () => {
    const key = term.create('/p')
    const { out, output } = sink()
    await term.start(key, { cols: 100, rows: 30 }, output)
    const shell = pty.sessions[0]
    expect(shell.cwd).toBe('/p')
    expect(shell.sizes).toEqual([[100, 30]])
    expect(term.active?.status).toBe('running')
    expect(term.active?.title).toBe('pwsh')
    expect(term.active?.pid).toBe(shell.pid)

    term.write(key, 'ls\r')
    term.resize(key, 80, 24)
    shell.print('a.txt\r\n')
    expect(shell.written).toEqual(['ls\r'])
    expect(shell.sizes.at(-1)).toEqual([80, 24])
    expect(out.text).toBe('a.txt\r\n')
  })

  test('starting twice does not spawn a second shell', async () => {
    const key = term.create('/p')
    await term.start(key, { cols: 80, rows: 24 }, sink().output)
    await term.start(key, { cols: 80, rows: 24 }, sink().output)
    expect(pty.sessions).toHaveLength(1)
  })

  test('tabs running the same shell get numbered titles', async () => {
    for (let i = 0; i < 3; i++) await term.start(term.create('/p'), { cols: 80, rows: 24 }, sink().output)
    expect(term.tabs.map((t) => t.title)).toEqual(['pwsh', 'pwsh 2', 'pwsh 3'])
  })

  test('a clean exit closes the tab, and the panel hides with the last one', async () => {
    const key = term.create('/p')
    const { out, output } = sink()
    await term.start(key, { cols: 80, rows: 24 }, output)
    pty.sessions[0].handlers.onExit(0)
    expect(term.tabs).toHaveLength(0)
    expect(term.visible).toBe(false)
    expect(out.exits).toEqual([]) // nothing to show: the tab is gone
  })

  test('a failing exit keeps the tab and reports the code', async () => {
    const key = term.create('/p')
    const { out, output } = sink()
    await term.start(key, { cols: 80, rows: 24 }, output)
    pty.sessions[0].handlers.onExit(2)
    expect(term.active?.status).toBe('exited')
    expect(term.active?.exitCode).toBe(2)
    expect(out.exits).toEqual([2])
    expect(term.runningCount).toBe(0)
    // Writing to an exited terminal is ignored rather than throwing.
    term.write(key, 'x')
    expect(pty.sessions[0].written).toEqual([])
  })

  test('closing a tab kills its shell and selects a neighbor', async () => {
    const a = term.create('/p')
    const b = term.create('/p')
    const c = term.create('/p')
    for (const k of [a, b, c]) await term.start(k, { cols: 80, rows: 24 }, sink().output)
    term.activeKey = b
    term.close(b)
    await tick()
    expect(pty.sessions[1].killed).toBe(true)
    expect(term.tabs.map((t) => t.key)).toEqual([a, c])
    expect(term.activeKey).toBe(c) // the one that moved into its place
    term.close(c)
    expect(term.activeKey).toBe(a) // no tab to the right: take the left one
  })

  test('closeAll kills every shell (switching folders)', async () => {
    for (let i = 0; i < 2; i++) await term.start(term.create('/p'), { cols: 80, rows: 24 }, sink().output)
    expect(term.runningCount).toBe(2)
    term.closeAll()
    await tick()
    expect(pty.sessions.every((s) => s.killed)).toBe(true)
    expect(term.tabs).toHaveLength(0)
    expect(term.visible).toBe(false)
  })

  test('closing a tab while its shell is starting kills the shell once it starts', async () => {
    let release!: () => void
    pty.gate = new Promise((r) => (release = r))
    const key = term.create('/p')
    const starting = term.start(key, { cols: 80, rows: 24 }, sink().output)
    expect(term.runningCount).toBe(1) // 'starting' counts as running
    term.close(key)
    release()
    await starting
    expect(pty.sessions[0].killed).toBe(true)
    expect(term.tabs).toHaveLength(0)
  })

  test('a shell that fails to start marks the tab failed with the error', async () => {
    pty.fail = 'no shell here'
    const key = term.create('/p')
    await term.start(key, { cols: 80, rows: 24 }, sink().output)
    expect(term.active?.status).toBe('failed')
    expect(term.active?.error).toContain('no shell here')
    expect(term.runningCount).toBe(0)
  })
})

describe('terminal theme', () => {
  test('maps tokens to xterm colors, including bright variants', () => {
    const theme = terminalTheme((name) => `<${name}>`)
    expect(theme.background).toBe('<--tk-bg>')
    expect(theme.cursor).toBe('<--tk-accent>')
    expect(theme.red).toBe('<--tk-term-red>')
    expect(theme.brightRed).toBe('<--tk-term-bright-red>')
    expect(theme.brightWhite).toBe('<--tk-term-bright-white>')
  })
})
