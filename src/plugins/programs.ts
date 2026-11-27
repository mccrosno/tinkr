// Running programs for plugins (`api.programs`). The work is done in Rust
// (src-tauri/src/programs.rs); host.ts takes a `ProgramRunner` so tests can fake it.

import { invoke } from '@tauri-apps/api/core'
import type { ProgramResult } from './api'

export interface ProgramRequest {
  program: string
  args: string[]
  /** Absolute folder to run in; null = the home folder. */
  cwd: string | null
  /** Text for the program's input, or null. */
  input: string | null
  timeoutMs: number
}

export type ProgramRunner = (request: ProgramRequest) => Promise<ProgramResult>

export const tauriRunner: ProgramRunner = async (request) => {
  try {
    return await invoke<ProgramResult>('run_program', { ...request })
  } catch (e) {
    // A Rust `Err(String)` arrives as a bare string; plugins expect an Error.
    throw new Error(String(e))
  }
}
