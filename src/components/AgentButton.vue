<script setup lang="ts">
// The agent status dot. Its menu has the Claude Code version, the active login, the
// agent's log and "Restart agent". It sits at the bottom of the rail, or in the title
// bar while the rail is collapsed.
import { ref } from 'vue'
import { useAgentStatus } from '../app/agentStatus'
import { useChat } from '../stores/chat'
import PopupBox from './PopupBox.vue'

/** Which side of the dot the menu opens on. */
const props = defineProps<{ side: 'right' | 'below' }>()
const chat = useChat()
const { agent, auth, tone } = useAgentStatus()
const button = ref<HTMLButtonElement>()
const at = ref<{ x: number; y: number } | null>(null)
const showLog = ref(false)

function toggle() {
  if (at.value) return void (at.value = null)
  showLog.value = false
  const r = button.value!.getBoundingClientRect()
  // Beside the rail the popup would run off the bottom; PopupBox moves it up to fit.
  at.value = props.side === 'right' ? { x: r.right + 8, y: r.top } : { x: r.left, y: r.bottom + 4 }
}

function restart() {
  at.value = null
  chat.restart()
}
</script>

<template>
  <button
    ref="button"
    type="button"
    class="tk-icon-button agent-button"
    :data-tone="tone"
    :aria-label="`Agent: ${[agent, auth].filter(Boolean).join(', ')}`"
    :title="[agent, auth].filter(Boolean).join(' · ')"
    aria-haspopup="menu"
    :aria-expanded="!!at"
    data-testid="agent-button"
    @click="toggle"
  >
    <span class="dot" aria-hidden="true" />
  </button>
  <PopupBox v-if="at" v-bind="at" label="Agent" :anchor="button" @close="at = null">
    <div class="status">
      <span data-testid="agent-status">{{ agent }}</span>
      <span v-if="auth" class="auth" data-testid="auth-status">{{ auth }}</span>
    </div>
    <div class="tk-menu-sep" role="separator" />
    <button type="button" class="tk-menu-item" role="menuitem" :aria-expanded="showLog" data-testid="show-log" @click="showLog = !showLog">
      {{ showLog ? 'Hide agent log' : 'Show agent log' }}
    </button>
    <button type="button" class="tk-menu-item" role="menuitem" data-testid="restart-agent" @click="restart">Restart agent</button>
    <pre v-if="showLog" class="log" data-testid="log">{{ chat.log.join('\n') || 'Nothing yet.' }}</pre>
  </PopupBox>
</template>

<style scoped>
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--tk-text-muted); }
[data-tone='ok'] .dot { background: var(--tk-ok); }
[data-tone='warn'] .dot { background: var(--tk-warn); }
[data-tone='bad'] .dot { background: var(--tk-danger); }
.status { display: flex; flex-direction: column; padding: 4px 10px; }
.auth { font-size: 11.5px; color: var(--tk-text-muted); }
.log { width: min(600px, calc(100vw - 80px)); max-height: 40vh; overflow: auto; margin: 4px 0 0; padding: 8px 10px; border-top: 1px solid var(--tk-border); font-size: 11.5px; white-space: pre-wrap; color: var(--tk-text-muted); }
</style>
