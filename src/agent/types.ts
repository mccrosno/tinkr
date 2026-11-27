// The AgentProvider interface (SPEC.md "Agent layer"). UI code talks to agents only
// through this; Claude (via the sidecar) is the only implementation in v1.

import type {
  Attachment, AttachmentPreview, AuthStatus, ChatSummary, CliStatus, EffortLevel, HistoryItem, ModelOption, PermissionDecision, TurnOutcome,
} from '@shared/protocol'

export type {
  Attachment, AttachmentPreview, AuthStatus, ChatSummary, CliStatus, EffortLevel, HistoryItem, ModelOption, PermissionDecision, TurnOutcome,
}

/** What a message is sent with, besides its text. `cwd` omitted = a chat without a folder. */
export interface SendOptions {
  cwd?: string
  /** A `ModelOption.value`; omitted = Claude Code's default. */
  model?: string
  effort?: EffortLevel
  attachments?: Attachment[]
}

/** Provider-neutral events the UI consumes. */
export type AgentEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; reason: string }
  | { type: 'status'; cli: CliStatus; auth: AuthStatus; models: ModelOption[] }
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
  send(sessionId: string | null, text: string, options?: SendOptions): Promise<string>
  abort(turnId: string): Promise<void>
  /** Answer a `permissionRequest` event. */
  respondToPermission(requestId: string, decision: PermissionDecision): Promise<void>
  // Conversation history, per folder (`cwd` omitted = chats without a folder).
  /** Past chats, newest first: in one folder, or with `allFolders` every chat Claude Code has stored. */
  listChats(cwd?: string, allFolders?: boolean): Promise<ChatSummary[]>
  /** A past chat's messages, to show it again before continuing it. */
  loadChat(sessionId: string, cwd?: string): Promise<HistoryItem[]>
  renameChat(sessionId: string, title: string, cwd?: string): Promise<void>
  deleteChat(sessionId: string, cwd?: string): Promise<void>
  /** Restart the agent process (e.g. after installing or signing in to the CLI). */
  restart(): Promise<void>
}
