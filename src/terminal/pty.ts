// Shells in pseudo-terminals, run by Rust (src-tauri/src/pty.rs). The terminal store
// uses this interface, so tests can swap in a fake.

import { Channel, invoke } from '@tauri-apps/api/core'

export interface PtyHandlers {
  /** Raw output bytes. xterm.js decodes them, including UTF-8 split across chunks. */
  onData(bytes: Uint8Array): void
  /** The shell exited. Called once, after the last `onData`. */
  onExit(exitCode: number): void
}

export interface PtySession {
  readonly id: number
  /** The shell's process id, if the OS reported one. */
  readonly pid: number | null
  /** Short shell name for the tab title, e.g. "pwsh" or "zsh". */
  readonly shellName: string
  write(data: string): Promise<void>
  resize(cols: number, rows: number): Promise<void>
  /** Kill the shell. `onExit` still fires afterwards. */
  kill(): Promise<void>
}

export interface PtyHost {
  spawn(options: { cwd: string; cols: number; rows: number }, handlers: PtyHandlers): Promise<PtySession>
}

/** What `pty_spawn` returns (Rust struct `Spawned`). */
interface Spawned {
  id: number
  pid: number | null
  shellName: string
}

export const tauriPty: PtyHost = {
  async spawn({ cwd, cols, rows }, handlers) {
    // One channel per terminal: output arrives as ArrayBuffers, then a single
    // `{ exitCode }` object when the shell exits (in that order; channels are ordered).
    const onEvent = new Channel<ArrayBuffer | { exitCode: number }>()
    onEvent.onmessage = (message) => {
      if (message instanceof ArrayBuffer) handlers.onData(new Uint8Array(message))
      else handlers.onExit(message.exitCode)
    }
    const { id, pid, shellName } = await invoke<Spawned>('pty_spawn', { cwd, cols, rows, onEvent })
    return {
      id,
      pid,
      shellName,
      write: (data) => invoke('pty_write', { id, data }),
      resize: (cols, rows) => invoke('pty_resize', { id, cols, rows }),
      kill: () => invoke('pty_kill', { id }),
    }
  },
}
