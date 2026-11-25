<script setup lang="ts">
import { computed, ref } from 'vue'
import { useChat } from '../stores/chat'

const chat = useChat()
const showLog = ref(false)

const agentLabel = computed(() => {
  if (chat.connection === 'connecting') return 'Starting agent…'
  if (chat.connection === 'disconnected') return 'Agent stopped'
  const cli = chat.cli
  if (!cli) return 'Checking Claude Code…'
  if (cli.state === 'missing') return 'Claude Code not found'
  if (cli.state === 'outdated') return `Claude Code ${cli.version} (update needed)`
  if (cli.state === 'error') return 'Claude Code error'
  return `Claude Code ${cli.version}`
})

const authLabel = computed(() => {
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

const tone = computed(() => {
  if (chat.connection === 'disconnected' || chat.cli?.state === 'error' || chat.cli?.state === 'missing') return 'bad'
  if (chat.connection === 'connecting' || !chat.cli || !chat.auth) return 'pending'
  if (chat.cli.state !== 'ok' || chat.auth.state === 'signedOut' || chat.auth.state === 'unknown') return 'warn'
  return 'ok'
})
</script>

<template>
  <footer class="statusbar">
    <span class="dot" :class="tone" aria-hidden="true" />
    <span class="agent" data-testid="agent-status">{{ agentLabel }}</span>
    <span v-if="authLabel" class="auth" data-testid="auth-status">{{ authLabel }}</span>
    <span class="spacer" />
    <button class="link" :aria-expanded="showLog" @click="showLog = !showLog">Log</button>
    <button class="link" title="Restart the agent process" @click="chat.restart()">Restart agent</button>
    <pre v-if="showLog" class="log" data-testid="log">{{ chat.log.join('\n') || 'Nothing yet.' }}</pre>
  </footer>
</template>

<style scoped>
.statusbar { position: relative; display: flex; align-items: center; gap: 10px; padding: 3px 12px; font-size: 12px; color: var(--tk-text-muted); background: var(--tk-surface); border-top: 1px solid var(--tk-border); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--tk-text-muted); }
.dot.ok { background: var(--tk-ok); }
.dot.warn { background: var(--tk-warn); }
.dot.bad { background: var(--tk-danger); }
.auth::before { content: '·'; margin-right: 10px; }
.spacer { flex: 1; }
.link { background: none; border: 0; padding: 2px 4px; color: var(--tk-text-muted); }
.link:hover { color: var(--tk-text); }
.log { position: absolute; right: 8px; bottom: calc(100% + 6px); width: min(640px, calc(100vw - 16px)); max-height: 40vh; overflow: auto; margin: 0; padding: 8px 10px; background: var(--tk-surface); border: 1px solid var(--tk-border); border-radius: var(--tk-radius-sm); font-size: 11.5px; white-space: pre-wrap; color: var(--tk-text-muted); }
</style>
