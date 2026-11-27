// The agent's state in words and as a color: which Claude Code is in use, how it's
// signed in, and whether anything needs attention. Shown by the agent status dot.

import { computed } from 'vue'
import { useChat } from '../stores/chat'

export type AgentTone = 'ok' | 'pending' | 'warn' | 'bad'

export function useAgentStatus() {
  const chat = useChat()

  const agent = computed(() => {
    if (chat.connection === 'connecting') return 'Starting agent…'
    if (chat.connection === 'disconnected') return 'Agent stopped'
    const cli = chat.cli
    if (!cli) return 'Checking Claude Code…'
    if (cli.state === 'missing') return 'Claude Code not found'
    if (cli.state === 'outdated') return `Claude Code ${cli.version} (update needed)`
    if (cli.state === 'error') return 'Claude Code error'
    return `Claude Code ${cli.version}`
  })

  const auth = computed(() => {
    const a = chat.auth
    // Login only means something once a working CLI was found.
    if (!a || chat.cli?.state !== 'ok') return ''
    switch (a.state) {
      case 'subscription':
        return a.plan
      case 'apiKey':
        return `API key (${a.source})`
      case 'signedOut':
        return 'Not signed in'
      case 'unknown':
        return 'Login unknown'
    }
  })

  const tone = computed<AgentTone>(() => {
    if (chat.connection === 'disconnected' || chat.cli?.state === 'error' || chat.cli?.state === 'missing') return 'bad'
    if (chat.connection === 'connecting' || !chat.cli || !chat.auth) return 'pending'
    if (chat.cli.state !== 'ok' || chat.auth.state === 'signedOut' || chat.auth.state === 'unknown') return 'warn'
    return 'ok'
  })

  return { agent, auth, tone }
}
