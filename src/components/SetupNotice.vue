<script setup lang="ts">
// Explains what's needed before chatting: install/update Claude Code, sign in, or restart
// the agent. Tinkr never logs in itself; it reuses the Claude Code login.
import { computed } from 'vue'
import { useChat } from '../stores/chat'

const chat = useChat()
const isWindows = navigator.userAgent.includes('Windows')
const installCmd = isWindows ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash'

const view = computed(() => {
  if (chat.connection === 'disconnected') return 'disconnected'
  const cli = chat.cli
  if (!cli) return null
  if (cli.state !== 'ok') return cli.state
  if (chat.auth?.state === 'signedOut') return 'signedOut'
  return null
})

function copy(text: string) {
  navigator.clipboard.writeText(text).catch(() => {})
}
</script>

<template>
  <section v-if="view" class="notice" role="status">
    <template v-if="view === 'disconnected'">
      <h2>The agent stopped</h2>
      <p>{{ chat.disconnectReason || 'The agent process exited.' }}</p>
      <div class="actions"><button class="tk-button primary" @click="chat.restart()">Restart agent</button></div>
    </template>

    <template v-else-if="view === 'missing'">
      <h2>Claude Code isn't installed</h2>
      <p>Tinkr uses your Claude Code installation and its login. Install it in a terminal:</p>
      <div class="cmd"><code>{{ installCmd }}</code><button class="tk-button" @click="copy(installCmd)">Copy</button></div>
      <p>Then open a <strong>new</strong> terminal, run <code>claude</code>, and type <code>/login</code>.</p>
      <details v-if="chat.cli?.state === 'missing'">
        <summary>Where Tinkr looked</summary>
        <ul><li v-for="p in chat.cli.searched" :key="p"><code>{{ p }}</code></li></ul>
        <p>Set <code>TINKR_CLAUDE_PATH</code> if it's installed somewhere else.</p>
      </details>
      <div class="actions"><button class="tk-button primary" @click="chat.recheck()">Check again</button></div>
    </template>

    <template v-else-if="view === 'outdated' && chat.cli?.state === 'outdated'">
      <h2>Claude Code needs an update</h2>
      <p>You have {{ chat.cli.version }}; Tinkr needs {{ chat.cli.minVersion }} or newer.</p>
      <div class="cmd"><code>claude update</code><button class="tk-button" @click="copy('claude update')">Copy</button></div>
      <div class="actions"><button class="tk-button primary" @click="chat.recheck()">Check again</button></div>
    </template>

    <template v-else-if="view === 'error' && chat.cli?.state === 'error'">
      <h2>Claude Code didn't start</h2>
      <p>Running <code>{{ chat.cli.path }} --version</code> failed:</p>
      <pre>{{ chat.cli.message }}</pre>
      <div class="actions"><button class="tk-button primary" @click="chat.recheck()">Check again</button></div>
    </template>

    <template v-else-if="view === 'signedOut'">
      <h2>Sign in to Claude Code</h2>
      <p>In a terminal, run <code>claude</code> and type <code>/login</code>. Tinkr will use the same login.</p>
      <div class="actions"><button class="tk-button primary" @click="chat.recheck()">I've signed in</button></div>
    </template>
  </section>
</template>

<style scoped>
.notice { margin: 24px auto; max-width: 560px; padding: 16px 20px; background: var(--tk-surface); border: 1px solid var(--tk-border); border-radius: var(--tk-radius); }
h2 { margin: 0 0 8px; font-size: 16px; }
p { margin: 8px 0; color: var(--tk-text-muted); }
.cmd { display: flex; gap: 8px; align-items: center; background: var(--tk-code-bg); border: 1px solid var(--tk-border); border-radius: var(--tk-radius-sm); padding: 6px 6px 6px 10px; }
.cmd code { flex: 1; overflow-x: auto; white-space: nowrap; }
pre { white-space: pre-wrap; background: var(--tk-code-bg); padding: 8px; border-radius: var(--tk-radius-sm); }
details { color: var(--tk-text-muted); font-size: 13px; }
.actions { margin-top: 12px; display: flex; justify-content: flex-end; }
</style>
