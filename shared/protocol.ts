// The sidecar protocol: the only definition of the messages exchanged between the
// webview and the agent sidecar. Both sides import this file.
//
// Transport: one JSON object per line over the sidecar's stdio. Rust relays lines
// without parsing them (see src-tauri/src/sidecar.rs).

/** Bump when a message changes shape in a way the other side must know about. */
export const PROTOCOL_VERSION = 1

// ---------------------------------------------------------------------------
// Webview -> sidecar
// ---------------------------------------------------------------------------

export type SidecarRequest =
  /** Re-check the CLI and the login, then reply with a `status` event. */
  | { type: 'status' }
  /**
   * Run one agent turn. `resumeSessionId` continues an earlier conversation
   * (Claude Code stores sessions itself, per working directory); null starts a new one.
   * `cwd` is the open project folder; omitted means the user's home folder.
   */
  | { type: 'send'; turnId: string; resumeSessionId: string | null; text: string; cwd?: string }
  /** Stop a running turn. The turn still ends with `turnFinished` (outcome "aborted"). */
  | { type: 'abort'; turnId: string }

// ---------------------------------------------------------------------------
// Sidecar -> webview
// ---------------------------------------------------------------------------

/** Whether a usable Claude Code CLI was found. */
export type CliStatus =
  | { state: 'ok'; path: string; version: string }
  | { state: 'missing'; searched: string[] }
  | { state: 'outdated'; path: string; version: string; minVersion: string }
  | { state: 'error'; path: string; message: string }

/** Which credential the CLI will use. Tinkr never logs in itself. */
export type AuthStatus =
  | { state: 'subscription'; plan: string }
  | { state: 'apiKey'; source: string }
  | { state: 'signedOut' }
  | { state: 'unknown'; detail: string }

export type TurnOutcome = 'success' | 'aborted' | 'error'

export type SidecarEvent =
  /** First line the sidecar writes. */
  | { type: 'ready'; protocol: number; sdkVersion: string; minCliVersion: string }
  | { type: 'status'; cli: CliStatus; auth: AuthStatus }
  | { type: 'turnStarted'; turnId: string; sessionId: string; model: string }
  | { type: 'textDelta'; turnId: string; text: string }
  | {
      type: 'turnFinished'
      turnId: string
      sessionId: string | null
      outcome: TurnOutcome
      durationMs: number
      /** Estimated API cost. Subscriptions report it too, but aren't charged it. */
      costUsd?: number
      message?: string
    }
  /** A problem not tied to a turn, e.g. a malformed request. */
  | { type: 'error'; message: string }

/** Parse one protocol line, or return null if it isn't a JSON object with a `type`. */
export function parseLine<T extends { type: string }>(line: string): T | null {
  try {
    const value = JSON.parse(line)
    return value && typeof value === 'object' && typeof value.type === 'string' ? (value as T) : null
  } catch {
    return null
  }
}
