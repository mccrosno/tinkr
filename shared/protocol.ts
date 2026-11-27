// The sidecar protocol: the only definition of the messages exchanged between the
// webview and the agent sidecar. Both sides import this file.
//
// Transport: one JSON object per line over the sidecar's stdio. Rust relays lines
// without parsing them (see src-tauri/src/sidecar.rs).

/** Bump when a message changes shape in a way the other side must know about. */
export const PROTOCOL_VERSION = 4

// ---------------------------------------------------------------------------
// Webview -> sidecar
// ---------------------------------------------------------------------------

export type SidecarRequest =
  /** Re-check the CLI and the login, then reply with a `status` event. */
  | { type: 'status' }
  /**
   * Run one agent turn. `resumeSessionId` continues an earlier conversation
   * (Claude Code stores sessions itself, per working directory); null starts a new one.
   * `cwd` is the open project folder. Omitted means a chat without a folder: it runs in
   * the home folder (like the CLI started there), and Claude gets no file-editing tools
   * (edits are only reviewable inside a project or the plugins folder). `model` and
   * `effort` omitted = Claude Code's defaults.
   * `pluginsDir` is Tinkr's plugins folder. With it, Claude can write plugins: it may
   * read the folder, edit it (after asking the user), and use the plugin tools (see
   * `pluginRequest`).
   */
  | {
      type: 'send'
      turnId: string
      resumeSessionId: string | null
      text: string
      cwd?: string
      model?: string
      effort?: EffortLevel
      attachments?: Attachment[]
      pluginsDir?: string
    }
  /** Stop a running turn. The turn still ends with `turnFinished` (outcome "aborted"). */
  | { type: 'abort'; turnId: string }
  /** The user's answer to a `permissionRequest`. */
  | { type: 'permissionResponse'; requestId: string; decision: PermissionDecision }
  /**
   * The app's answer to a `pluginRequest`: `text` is the report Claude reads, and
   * `isError` says the plugin isn't working.
   */
  | { type: 'pluginResponse'; requestId: string; text: string; isError: boolean }
  // Conversation history. Each of these is answered by an event with the same
  // `requestId`: `chatList`, `chatHistory`, or `requestDone` (also used for failures).
  // `cwd` means the same as in `send` (omitted = chats without a folder).
  /**
   * The chats in a folder, newest first, or with `allFolders` every chat Claude Code has
   * stored (from the CLI, Desktop's Code tab and Tinkr alike). Answered with `chatList`.
   */
  | { type: 'listChats'; requestId: string; cwd?: string; allFolders?: boolean }
  /** One chat's messages, to show it again. Answered with `chatHistory`. */
  | { type: 'loadChat'; requestId: string; sessionId: string; cwd?: string }
  | { type: 'renameChat'; requestId: string; sessionId: string; title: string; cwd?: string }
  | { type: 'deleteChat'; requestId: string; sessionId: string; cwd?: string }

/** How much thinking Claude does (the API's effort levels). */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** A file sent with a message. Images and PDFs go to Claude as-is; text files as text documents. */
export interface Attachment {
  name: string
  /** image/png, image/jpeg, image/gif, image/webp, application/pdf, or text/plain. */
  mediaType: string
  /** The file's bytes, base64-encoded. */
  data: string
}

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

/** Set on a permission request to edit Tinkr's plugins folder. `plugin` is null for a file outside any plugin. */
export interface PluginEdit {
  plugin: string | null
}

/** What Claude's plugin tools ask the app to do: load a plugin afresh and report, or just report. */
export type PluginAction = 'reload' | 'status'

/** A model the user can pick (from Claude Code's list, so it follows the user's plan). */
export interface ModelOption {
  /** Passed back as `send.model`. "default" means Claude Code's default model. */
  value: string
  /** The model id it resolves to, e.g. "claude-opus-5-5" (matches `turnStarted.model`). */
  resolvedModel?: string
  displayName: string
  description: string
  /** Empty if the model has no effort setting. */
  efforts: EffortLevel[]
}

/** A past conversation, for the history list. */
export interface ChatSummary {
  sessionId: string
  title: string
  /** The folder the chat belongs to; null = no folder (the home folder). */
  folder: string | null
  /** Milliseconds since the epoch. */
  lastModified: number
}

/** A file shown on a message from history. `data` (base64) is included for images only. */
export interface AttachmentPreview {
  name: string
  mediaType: string
  data?: string
}

/** One row of a past conversation, in order. */
export type HistoryItem =
  | { kind: 'user'; text: string; attachments: AttachmentPreview[] }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; toolUseId: string; name: string; summary: string; isError: boolean }

export type SidecarEvent =
  /** First line the sidecar writes. */
  | { type: 'ready'; protocol: number; sdkVersion: string; minCliVersion: string }
  /** `models` is empty until signed in (Claude Code lists them per account). */
  | { type: 'status'; cli: CliStatus; auth: AuthStatus; models: ModelOption[] }
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
  | { type: 'permissionRequest'; turnId: string; requestId: string; toolName: string; summary: string; detail?: string; pluginEdit?: PluginEdit }
  /** A pending request no longer needs an answer (the turn was stopped). */
  | { type: 'permissionCancelled'; requestId: string }
  /**
   * Claude used one of its plugin tools. Plugins run in the app, not the sidecar, so
   * the app does the work and answers with `pluginResponse`.
   */
  | { type: 'pluginRequest'; turnId: string; requestId: string; action: PluginAction; name: string }
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
  /** Answers to the history requests (see `listChats` and friends). */
  | { type: 'chatList'; requestId: string; chats: ChatSummary[] }
  | { type: 'chatHistory'; requestId: string; items: HistoryItem[] }
  /** A history request finished; `error` is set if it failed. */
  | { type: 'requestDone'; requestId: string; error?: string }
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
