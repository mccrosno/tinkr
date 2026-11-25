// Runs Claude Agent SDK turns and reports them as protocol events.

import { homedir } from 'node:os'
import { query, type AccountInfo, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AuthStatus, SidecarEvent, TurnOutcome } from '../../shared/protocol'

export type Emit = (event: SidecarEvent) => void

/**
 * Options shared by every SDK call.
 * Milestone 1 is chat only: no tools, so Claude can't touch files or run commands yet
 * (that arrives with the review model in Milestone 6).
 */
function baseOptions(cliPath: string, cwd: string = homedir()): Options {
  return {
    pathToClaudeCodeExecutable: cliPath,
    // Claude Code stores sessions per working directory, so resume needs the same cwd:
    // the open project folder, or the home folder when none is open.
    cwd,
    tools: [],
    // Don't load the user's or a project's Claude Code settings/CLAUDE.md into Tinkr chats.
    settingSources: [],
    // Recommended when passing our own CLI path (see SDK docs for this option).
    mcpServersDelivery: 'initialize',
  }
}

/** Turn the SDK's account info into Tinkr's auth status. */
export function toAuthStatus(info: AccountInfo): AuthStatus {
  if (info.apiProvider && info.apiProvider !== 'firstParty') return { state: 'apiKey', source: info.apiProvider }
  if (info.subscriptionType) return { state: 'subscription', plan: info.subscriptionType }
  if (info.apiKeySource && info.apiKeySource !== 'none') return { state: 'apiKey', source: info.apiKeySource }
  if (info.tokenSource === 'none' || (!info.tokenSource && !info.email)) return { state: 'signedOut' }
  return { state: 'unknown', detail: JSON.stringify({ tokenSource: info.tokenSource, apiProvider: info.apiProvider }) }
}

/** Ask the CLI which credential it would use, without sending a prompt. */
export async function readAuth(cliPath: string): Promise<AuthStatus> {
  const abortController = new AbortController()
  // Streaming-input mode with a prompt stream that never yields: the CLI starts and
  // initializes (which is when account info is known) but no message is sent.
  const neverYields = (async function* () {
    await new Promise<never>(() => {})
  })()
  const q = query({ prompt: neverYields, options: { ...baseOptions(cliPath), abortController } })
  try {
    return toAuthStatus(await q.accountInfo())
  } catch (e) {
    return { state: 'unknown', detail: e instanceof Error ? e.message : String(e) }
  } finally {
    abortController.abort() // stop the CLI process
  }
}

interface RunningTurn {
  abort: () => void
}

/** Runs turns; each one is a single `query()` call that resumes the conversation. */
export class Agent {
  private running = new Map<string, RunningTurn>()

  constructor(
    private cliPath: () => string | null,
    private emit: Emit,
  ) {}

  async send(turnId: string, resumeSessionId: string | null, text: string, cwd?: string) {
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

    const abortController = new AbortController()
    let aborted = false
    const q = query({
      prompt: text,
      options: {
        ...baseOptions(cliPath, cwd),
        includePartialMessages: true,
        abortController,
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
          const ev = m.event
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            this.emit({ type: 'textDelta', turnId, text: ev.delta.text })
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
      this.running.delete(turnId)
    }
  }

  abort(turnId: string) {
    this.running.get(turnId)?.abort()
  }
}
