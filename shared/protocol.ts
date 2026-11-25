// The sidecar protocol: the only definition of the messages exchanged between the
// webview and the agent sidecar. Both sides import this file.
//
// Transport: one JSON object per line over the sidecar's stdio. Rust relays lines
// without parsing them (see src-tauri/src/sidecar.rs).

/** Bump when a message changes shape in a way the other side must know about. */
export const PROTOCOL_VERSION = 2

// ---------------------------------------------------------------------------
// Webview -> sidecar
// ---------------------------------------------------------------------------

export type SidecarRequest =
  /** Re-check the CLI and the login, then reply with a `status` event. */
  | { type: 'status' }
  /**
   * Run one agent turn. `resumeSessionId` continues an earlier conversation
   * (Claude Code stores sessions itself, per working directory); null starts a new one.
   * `cwd` is the open project folder; omitted means the user's home folder, and then
   * Claude gets no file-editing tools (edits are only reviewable inside a project).
   */
  | { type: 'send'; turnId: string; resumeSessionId: string | null; text: string; cwd?: string }
  /** Stop a running turn. The turn still ends with `turnFinished` (outcome "aborted"). */
  | { type: 'abort'; turnId: string }
  /** The user's answer to a `permissionRequest`. */
  | { type: 'permissionResponse'; requestId: string; decision: PermissionDecision }

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

/** "allowForChat" also allows similar requests for the rest of this conversation. */
export type PermissionDecision = 'allow' | 'allowForChat' | 'deny'

export type SidecarEvent =
  /** First line the sidecar writes. */
  | { type: 'ready'; protocol: number; sdkVersion: string; minCliVersion: string }
  | { type: 'status'; cli: CliStatus; auth: AuthStatus }
  | { type: 'turnStarted'; turnId: string; sessionId: string; model: string }
  | { type: 'textDelta'; turnId: string; text: string }
  /** Claude is calling a tool. `summary` is a short human label, e.g. "src/main.ts" or "npm test". */
  | { type: 'toolUse'; turnId: string; toolUseId: string; name: string; summary: string }
  | { type: 'toolResult'; turnId: string; toolUseId: string; isError: boolean }
  /**
   * A file-editing tool is about to change `path` (absolute). `before` is its current
   * text, or null if the file doesn't exist yet. Sent before the change is applied, so
   * the UI can keep it as the baseline for review. Files Tinkr can't diff (over 2 MB,
   * binary) are skipped.
   */
  | { type: 'fileWillChange'; turnId: string; toolUseId: string; path: string; before: string | null }
  /** The tool that announced `fileWillChange` has finished (the file may or may not have changed). */
  | { type: 'fileChanged'; turnId: string; toolUseId: string; path: string }
  /** Claude wants to do something that needs the user's OK. Answer with `permissionResponse`. */
  | { type: 'permissionRequest'; turnId: string; requestId: string; toolName: string; summary: string; detail?: string }
  /** A pending request no longer needs an answer (the turn was stopped). */
  | { type: 'permissionCancelled'; requestId: string }
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
