// The AgentProvider interface (SPEC.md "Agent layer"). UI code talks to agents only
// through this; Claude (via the sidecar) is the only implementation in v1.
//
// Not in Milestone 1 yet: permission requests (tools are off until the review model).

import type { AuthStatus, CliStatus, TurnOutcome } from '@shared/protocol'

export type { AuthStatus, CliStatus, TurnOutcome }

/** Provider-neutral events the UI consumes. */
export type AgentEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; reason: string }
  | { type: 'status'; cli: CliStatus; auth: AuthStatus }
  | { type: 'turnStarted'; turnId: string; sessionId: string; model: string }
  | { type: 'text'; turnId: string; text: string }
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
  send(sessionId: string | null, text: string): Promise<string>
  abort(turnId: string): Promise<void>
  /** Restart the agent process (e.g. after installing or signing in to the CLI). */
  restart(): Promise<void>
}
