// Asking Claude about plugins, from buttons and commands: put a request in the message
// box and bring the chat to the front. The user reads it, finishes it and presses Enter.

import { useChat } from '../stores/chat'
import { useLayout } from '../stores/layout'
import { usePlugins } from '../stores/plugins'

const CREATE = 'Make me a Tinkr plugin that '

/** "New plugin with Claude": start the request, keeping anything already typed. */
export function askClaudeToCreate() {
  const chat = useChat()
  const typed = chat.draft.trimEnd()
  chat.setDraft(typed ? `${typed}\n\n${CREATE}` : CREATE)
  useLayout().show('chat')
}

/** "Ask Claude to fix": a plugin's error, and where its files are (SPEC.md: plugin errors are fed to the agent). */
export function askClaudeToFix(plugin: string, error: string) {
  const record = usePlugins().record(plugin)
  const where = record?.dir ? ` Its files are in ${record.dir}.` : ''
  useChat().setDraft(
    `The Tinkr plugin "${plugin}" has an error.${where} Please find the cause and fix it, then check it with reload_plugin.\n\n${error}`,
  )
  useLayout().show('chat')
}
