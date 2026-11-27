// "Ask Claude to fix": put a plugin's error in the message box, with where its files
// are, and bring the chat to the front. The user reads it and presses Enter (SPEC.md:
// plugin load errors are fed to the agent).

import { useChat } from '../stores/chat'
import { useLayout } from '../stores/layout'
import { usePlugins } from '../stores/plugins'

export function askClaudeToFix(plugin: string, error: string) {
  const record = usePlugins().record(plugin)
  const where = record?.dir ? ` Its files are in ${record.dir}.` : ''
  useChat().setDraft(
    `The Tinkr plugin "${plugin}" has an error.${where} Please find the cause and fix it; Tinkr reloads the plugin when its files change.\n\n${error}`,
  )
  useLayout().show('chat')
}
