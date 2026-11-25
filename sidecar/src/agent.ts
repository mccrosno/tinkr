// Runs Claude Agent SDK turns and reports them as protocol events.

import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { query, type AccountInfo, type CanUseTool, type HookCallback, type ModelInfo, type Options, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { Attachment, AuthStatus, EffortLevel, ModelOption, PermissionDecision, SidecarEvent, TurnOutcome } from '../../shared/protocol'
import { messageContent, type ContentBlock } from './attachments'
import { EDIT_TOOLS, decide, describeTool, editTarget, forThisChat, isInside, permissionDetail, readBaseline } from './tools'

export type Emit = (event: SidecarEvent) => void

/**
 * The folder a chat runs in: its project, or the home folder for a chat without one.
 * Claude Code files sessions by working folder, so using the home folder (as the CLI
 * does when started there) means these chats and the CLI's/Desktop's home-folder
 * sessions see each other: `claude --resume` from home lists Tinkr's chats, and
 * Tinkr's list shows theirs.
 */
export const chatFolder = (project: string | undefined) => project ?? homedir()

/** Options shared by every SDK call (the login check uses only these). */
function baseOptions(cliPath: string, cwd: string = homedir()): Options {
  return {
    pathToClaudeCodeExecutable: cliPath,
    // Claude Code stores sessions per working directory, so resume needs the same cwd:
    // the open project folder, or the home folder when none is open.
    cwd,
    tools: [],
    settingSources: [],
    // Recommended when passing our own CLI path (see SDK docs for this option).
    mcpServersDelivery: 'initialize',
  }
}

/** Added to Claude Code's own system prompt, so Claude knows where it's running. */
export const TINKR_PROMPT = `You are running inside Tinkr, a desktop app where the chat is the main window and an editor sits beside it.
- Your file edits are shown to the user as diffs, which they accept or reject piece by piece. Make focused edits rather than rewriting whole files.
- The user's message may contain <selection file="..." lines="..." purpose="..."> blocks: code they selected in Tinkr's editor (paths relative to the project, 1-based line numbers). purpose="change" means edit that code in the file as they ask. purpose="question" means answer about it; only edit if they ask you to.`

/** Turn the SDK's account info into Tinkr's auth status. */
export function toAuthStatus(info: AccountInfo): AuthStatus {
  if (info.apiProvider && info.apiProvider !== 'firstParty') return { state: 'apiKey', source: info.apiProvider }
  if (info.subscriptionType) return { state: 'subscription', plan: info.subscriptionType }
  if (info.apiKeySource && info.apiKeySource !== 'none') return { state: 'apiKey', source: info.apiKeySource }
  if (info.tokenSource === 'none' || (!info.tokenSource && !info.email)) return { state: 'signedOut' }
  return { state: 'unknown', detail: JSON.stringify({ tokenSource: info.tokenSource, apiProvider: info.apiProvider }) }
}

/** Claude Code's model list, in the protocol's shape. */
export function toModelOption(m: ModelInfo): ModelOption {
  return {
    value: m.value,
    resolvedModel: m.resolvedModel,
    displayName: m.displayName,
    description: m.description,
    efforts: m.supportsEffort ? (m.supportedEffortLevels ?? []) : [],
  }
}

/**
 * Ask the CLI which credential it would use, and which models that account can pick,
 * without sending a prompt.
 */
export async function readAccount(cliPath: string): Promise<{ auth: AuthStatus; models: ModelOption[] }> {
  const abortController = new AbortController()
  // Streaming-input mode with a prompt stream that never yields: the CLI starts and
  // initializes (which is when account info is known) but no message is sent.
  const neverYields = (async function* () {
    await new Promise<never>(() => {})
  })()
  const q = query({ prompt: neverYields, options: { ...baseOptions(cliPath), abortController } })
  try {
    const auth = toAuthStatus(await q.accountInfo())
    if (auth.state === 'signedOut') return { auth, models: [] }
    // A failed model list shouldn't hide the login status: the picker just stays empty.
    const models = await q.supportedModels().then((list) => list.map(toModelOption), () => [])
    return { auth, models }
  } catch (e) {
    return { auth: { state: 'unknown', detail: e instanceof Error ? e.message : String(e) }, models: [] }
  } finally {
    abortController.abort() // stop the CLI process
  }
}

interface RunningTurn {
  abort: () => void
}

/** What a turn is sent with, besides its text. */
export interface TurnInput {
  /** The project folder; undefined = a chat without a folder. */
  cwd?: string
  model?: string
  effort?: EffortLevel
  attachments?: Attachment[]
}

/** A permission request waiting for the user's answer. */
interface PendingPermission {
  turnId: string
  resolve: (answer: PermissionDecision | 'cancelled') => void
}

/** Runs turns; each one is a single `query()` call that resumes the conversation. */
export class Agent {
  private running = new Map<string, RunningTurn>()
  private permissions = new Map<string, PendingPermission>()
  private nextPermission = 0
  /** Edit tool calls we sent a baseline for: tool use id -> absolute path. */
  private editsInFlight = new Map<string, string>()

  constructor(
    private cliPath: () => string | null,
    private emit: Emit,
  ) {}

  async send(turnId: string, resumeSessionId: string | null, text: string, input: TurnInput = {}) {
    const { cwd, model, effort, attachments = [] } = input
    const started = Date.now()
    const finish = (outcome: TurnOutcome, extra: { sessionId?: string | null; costUsd?: number; message?: string } = {}) =>
      this.emit({
        type: 'turnFinished',
        turnId,
        sessionId: extra.sessionId ?? sessionId,
        outcome,
        durationMs: Date.now() - started,
        costUsd: extra.costUsd,
        message: extra.message,
      })

    let sessionId: string | null = resumeSessionId
    const cliPath = this.cliPath()
    if (!cliPath) return finish('error', { message: 'Claude Code CLI is not available. Check the status bar.' })
    if (this.running.has(turnId)) return finish('error', { message: `turn ${turnId} is already running` })

    let content: ContentBlock[]
    try {
      content = messageContent(text, attachments)
    } catch (e) {
      return finish('error', { message: e instanceof Error ? e.message : String(e) })
    }

    // The message goes in as a one-item stream (that's how the SDK takes content blocks
    // such as images). The stream stays open until the turn ends: the CLI reads
    // permission answers over the same connection, so closing it early could cut them off.
    let endInput = () => {}
    const inputDone = new Promise<void>((r) => (endInput = r))
    async function* prompt(): AsyncGenerator<SDKUserMessage> {
      yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }
      await inputDone
    }

    const abortController = new AbortController()
    let aborted = false
    const q = query({
      prompt: prompt(),
      options: {
        ...this.turnOptions(turnId, cliPath, cwd),
        includePartialMessages: true,
        abortController,
        // "default" is Claude Code's own default; leaving the option out means the same.
        ...(model && model !== 'default' ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
      },
    })
    this.running.set(turnId, {
      abort: () => {
        aborted = true
        // Ask the CLI to stop politely; kill it if it hasn't within 3 s.
        q.interrupt().catch(() => {})
        setTimeout(() => abortController.abort(), 3000).unref?.()
      },
    })

    try {
      for await (const m of q as AsyncIterable<SDKMessage>) {
        if (m.type === 'system' && m.subtype === 'init') {
          sessionId = m.session_id
          this.emit({ type: 'turnStarted', turnId, sessionId, model: m.model })
        } else if (m.type === 'stream_event') {
          // Skip text from sub-agents (the Task tool): only Claude's own reply goes in the chat.
          const ev = m.event
          if (m.parent_tool_use_id === null && ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            this.emit({ type: 'textDelta', turnId, text: ev.delta.text })
          }
        } else if (m.type === 'assistant' && m.parent_tool_use_id === null) {
          for (const block of m.message.content) {
            if (block.type !== 'tool_use') continue
            this.emit({ type: 'toolUse', turnId, toolUseId: block.id, name: block.name, summary: describeTool(block.name, block.input, cwd) })
          }
        } else if (m.type === 'user' && Array.isArray(m.message.content)) {
          // Tool results come back as a "user" message. A result for an edit we took a
          // baseline for means the edit is done (or failed): tell the UI to look at the file.
          for (const block of m.message.content) {
            if (block.type !== 'tool_result') continue
            const edited = this.editsInFlight.get(block.tool_use_id)
            if (edited) {
              this.editsInFlight.delete(block.tool_use_id)
              this.emit({ type: 'fileChanged', turnId, toolUseId: block.tool_use_id, path: edited })
            }
            if (m.parent_tool_use_id === null) {
              this.emit({ type: 'toolResult', turnId, toolUseId: block.tool_use_id, isError: block.is_error === true })
            }
          }
        } else if (m.type === 'result') {
          sessionId = m.session_id
          if (aborted) return finish('aborted', { costUsd: m.total_cost_usd })
          if (m.subtype === 'success' && !m.is_error) return finish('success', { costUsd: m.total_cost_usd })
          const message = m.subtype === 'success' ? m.result : m.errors.join('\n') || m.subtype
          return finish('error', { costUsd: m.total_cost_usd, message })
        }
      }
      // The stream ended without a result message (e.g. killed after an abort).
      finish(aborted ? 'aborted' : 'error', { message: aborted ? undefined : 'the agent stopped without a result' })
    } catch (e) {
      finish(aborted ? 'aborted' : 'error', { message: aborted ? undefined : e instanceof Error ? e.message : String(e) })
    } finally {
      endInput()
      this.running.delete(turnId)
      this.cancelPermissions(turnId)
    }
  }

  abort(turnId: string) {
    this.running.get(turnId)?.abort()
    this.cancelPermissions(turnId)
  }

  /** The user answered a permission request. */
  respond(requestId: string, decision: PermissionDecision) {
    this.permissions.get(requestId)?.resolve(decision)
  }

  private cancelPermissions(turnId: string) {
    for (const p of this.permissions.values()) if (p.turnId === turnId) p.resolve('cancelled')
  }

  /**
   * Options for a chat turn: Claude Code's full toolset, the user's Claude Code
   * settings and CLAUDE.md files, and Tinkr's permission policy (see `decide`).
   * `project` is undefined when no folder is open; then Claude can't edit files.
   */
  private turnOptions(turnId: string, cliPath: string, project: string | undefined): Options {
    // Permission requests: allow/deny by policy, or ask the user in the chat and wait.
    const canUseTool: CanUseTool = async (toolName, input, { signal, suggestions }) => {
      const policy = decide(toolName, input, project)
      if (policy.kind === 'allow') return { behavior: 'allow', updatedInput: input }
      if (policy.kind === 'deny') return { behavior: 'deny', message: policy.message }

      const requestId = `${turnId}-p${++this.nextPermission}`
      const answer = await new Promise<PermissionDecision | 'cancelled'>((resolveAnswer) => {
        this.permissions.set(requestId, { turnId, resolve: resolveAnswer })
        signal.addEventListener('abort', () => resolveAnswer('cancelled'), { once: true })
        this.emit({
          type: 'permissionRequest',
          turnId,
          requestId,
          toolName,
          summary: describeTool(toolName, input, project),
          detail: permissionDetail(toolName, input),
        })
      })
      this.permissions.delete(requestId)
      if (answer === 'cancelled') {
        this.emit({ type: 'permissionCancelled', requestId })
        return { behavior: 'deny', message: 'The user stopped this turn.', interrupt: true }
      }
      if (answer === 'deny') return { behavior: 'deny', message: 'The user declined this in Tinkr.' }
      return {
        behavior: 'allow',
        updatedInput: input,
        ...(answer === 'allowForChat' ? { updatedPermissions: forThisChat(suggestions) } : {}),
      }
    }

    // Before an edit tool runs, send the file's current text as the review baseline.
    // (This hook runs before the permission check. If the edit is then denied, the file
    // ends up unchanged and the UI has nothing to review.)
    const beforeEdit: HookCallback = async (input) => {
      if (input.hook_event_name !== 'PreToolUse' || !project) return {}
      const target = editTarget(input.tool_name, input.tool_input)
      if (!target) return {}
      const path = resolve(project, target)
      if (!isInside(path, project)) return {}
      const before = await readBaseline(path)
      if (before === undefined) return {} // can't be diffed, so it isn't reviewed
      this.editsInFlight.set(input.tool_use_id, path)
      this.emit({ type: 'fileWillChange', turnId, toolUseId: input.tool_use_id, path, before })
      return {}
    }

    return {
      ...baseOptions(cliPath, chatFolder(project)),
      tools: { type: 'preset', preset: 'claude_code' },
      // Without a project there's nowhere to review edits, so leave the edit tools out.
      disallowedTools: project ? [] : [...EDIT_TOOLS],
      // Load the user's Claude Code settings and CLAUDE.md files, as the CLI would.
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: TINKR_PROMPT },
      // "default" sends everything that isn't clearly safe to `canUseTool`, which
      // applies Tinkr's policy. Read-only tools and safe commands never get there.
      permissionMode: 'default',
      canUseTool,
      hooks: { PreToolUse: [{ matcher: [...EDIT_TOOLS].join('|'), hooks: [beforeEdit] }] },
    }
  }
}
