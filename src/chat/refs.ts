// Code references: a piece of a file the user selected and sent to the chat with
// "Ask Claude" or "Request changes". Shown as chips in the composer, and sent to Claude
// as <selection> blocks (the sidecar's system prompt explains the format).

export type RefPurpose = 'question' | 'change'

export interface CodeRef {
  /** Absolute path (for opening the file). */
  path: string
  /** Path relative to the project, as Claude sees it. */
  relPath: string
  /** 1-based, inclusive. */
  fromLine: number
  toLine: number
  text: string
  purpose: RefPurpose
}

/** "src/a.ts:3-7", or "src/a.ts:3" for one line. */
export function refLabel(r: Pick<CodeRef, 'relPath' | 'fromLine' | 'toLine'>) {
  return r.fromLine === r.toLine ? `${r.relPath}:${r.fromLine}` : `${r.relPath}:${r.fromLine}-${r.toLine}`
}

/** Escape what would break out of an XML attribute. */
const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * The prompt sent to Claude: each reference as a <selection> block, then the user's text.
 * With no text, a reference still makes a sensible request ("Explain ...").
 */
export function formatPrompt(text: string, refs: CodeRef[]): string {
  const body = text.trim() || (refs.length ? defaultRequest(refs) : '')
  if (!refs.length) return body
  const blocks = refs.map(
    (r) =>
      `<selection file="${attr(r.relPath)}" lines="${r.fromLine}-${r.toLine}" purpose="${r.purpose}">\n${r.text}\n</selection>`,
  )
  return `${blocks.join('\n\n')}\n\n${body}`
}

function defaultRequest(refs: CodeRef[]) {
  return refs.some((r) => r.purpose === 'change') ? 'Improve the selected code.' : 'Explain the selected code.'
}

/** Two references to the same lines of the same file are the same reference. */
export const sameRef = (a: CodeRef, b: CodeRef) => a.path === b.path && a.fromLine === b.fromLine && a.toLine === b.toLine

const unattr = (s: string) => s.replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

/**
 * The reverse of `formatPrompt`, for chats loaded from history: split a stored prompt
 * back into the user's text and their code references. `joinRoot` turns a project-relative
 * path into an absolute one (so the chip can open the file); without a project, the
 * relative path is used as is.
 */
export function parsePrompt(prompt: string, joinRoot?: (relPath: string) => string): { text: string; refs: CodeRef[] } {
  const refs: CodeRef[] = []
  const re = /<selection file="([^"]*)" lines="(\d+)-(\d+)" purpose="(question|change)">\n([\s\S]*?)\n<\/selection>\s*/g
  const rest = prompt.replace(re, (_all, file: string, from: string, to: string, purpose: RefPurpose, text: string) => {
    const relPath = unattr(file)
    refs.push({ path: joinRoot ? joinRoot(relPath) : relPath, relPath, fromLine: Number(from), toLine: Number(to), text, purpose })
    return ''
  })
  let text = rest.trim()
  // A reference sent without a question got a stock request; don't show that as typed text.
  if (refs.length && text === defaultRequest(refs)) text = ''
  return { text, refs }
}
