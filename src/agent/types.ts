// The AgentProvider interface (SPEC.md "Agent layer"). UI code talks to agents only
// through this; Claude (via the sidecar) is the only implementation in v1.

import type { AuthStatus, CliStatus, PermissionDecision, TurnOutcome } from '@shared/protocol'

export type { AuthStatus, CliStatus, PermissionDecision, TurnOutcome }

/** Provider-neutral events the UI consumes. */
export type AgentEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; reason: string }
  | { type: 'status'; cli: CliStatus; auth: AuthStatus }
  | { type: 'turnStarted'; turnId: string; sessionId: string; model: string }
  | { type: 'text'; turnId: string; text: string }
  | { type: 'toolUse'; turnId: string; toolUseId: string; name: string; summary: string }
  | { type: 'toolResult'; turnId: string; toolUseId: string; isError: boolean }
  /** An edit is about to change `path`; `before` is its text (null = new file). For review baselines. */
  | { type: 'fileWillChange'; turnId: string; toolUseId: string; path: string; before: string | null }
  /** That edit finished; the file on disk may have changed. */
  | { type: 'fileChanged'; turnId: string; toolUseId: string; path: string }
  | { type: 'permissionRequest'; turnId: string; requestId: string; toolName: string; summary: string; detail?: string }
  | { type: 'permissionCancelled'; requestId: string }
  | { type: 'turnFinished'; turnId: string; sessionId: string | null; outcome: TurnOutcome; durationMs: number; costUsd?: number; message?: string }
  | { type: 'log'; message: string }

export interface AgentProvider {
  readonly id: string
  readonly label: string
  /** Start listening for events. Resolves once the provider can take requests. */
  connect(): Promise<void>
  onEvent(listener: (event: AgentEvent) => void): () => void
  /** Re-check installation and login; answered with a `status` event. */
  refreshStatus(): Promise<void>
  /** Send a message. `sessionId` continues a conversation; null starts a new one. Returns the turn id. */
  send(sessionId: string | null, text: string, options?: { cwd?: string }): Promise<string>
  abort(turnId: string): Promise<void>
  /** Answer a `permissionRequest` event. */
  respondToPermission(requestId: string, decision: PermissionDecision): Promise<void>
  /** Restart the agent process (e.g. after installing or signing in to the CLI). */
  restart(): Promise<void>
}
