<script setup lang="ts">
// "Claude wants to run: npm install" with Allow / Allow for this chat / Deny.
// Once answered (or the turn stopped) it shrinks to a one-line record.
import { computed } from 'vue'
import { useChat, type ChatMessage } from '../stores/chat'

const props = defineProps<{ request: NonNullable<ChatMessage['permission']> }>()
const chat = useChat()

const verb = computed(() => {
  switch (props.request.toolName) {
    case 'Bash':
      return 'run a command'
    case 'WebFetch':
      return 'fetch a web page'
    case 'WebSearch':
      return 'search the web'
    default:
      return `use ${props.request.toolName}`
  }
})

const outcome = computed(() => {
  switch (props.request.state) {
    case 'allowed':
      return 'Allowed'
    case 'allowedForChat':
      return 'Allowed for this chat'
    case 'denied':
      return 'Denied'
    case 'cancelled':
      return 'Not answered (stopped)'
    default:
      return ''
  }
})
</script>

<template>
  <div class="card" :class="request.state" data-testid="permission" role="group" :aria-label="`Permission: ${verb}`">
    <div class="head">
      <span>Claude wants to <strong>{{ verb }}</strong></span>
      <span v-if="request.state !== 'pending'" class="outcome">{{ outcome }}</span>
    </div>
    <pre v-if="request.detail || request.summary" class="detail">{{ request.detail ?? request.summary }}</pre>
    <div v-if="request.state === 'pending'" class="actions">
      <button class="tk-button primary" @click="chat.respondToPermission(request.requestId, 'allow')">Allow</button>
      <button class="tk-button" title="Also allow requests like this for the rest of the chat" @click="chat.respondToPermission(request.requestId, 'allowForChat')">
        Allow for this chat
      </button>
      <button class="tk-button" @click="chat.respondToPermission(request.requestId, 'deny')">Deny</button>
    </div>
  </div>
</template>

<style scoped>
.card { border: 1px solid var(--tk-accent); border-radius: var(--tk-radius); padding: 8px 12px; background: var(--tk-surface); display: flex; flex-direction: column; gap: 6px; }
.card:not(.pending) { border-color: var(--tk-border); padding: 5px 10px; font-size: 13px; color: var(--tk-text-muted); }
.card:not(.pending) .detail { display: none; }
.head { display: flex; gap: 8px; }
.head span:first-child { flex: 1; }
.outcome { font-size: 12px; }
.card.denied .outcome { color: var(--tk-danger); }
.card.allowed .outcome, .card.allowedForChat .outcome { color: var(--tk-ok); }
.detail { margin: 0; padding: 6px 8px; background: var(--tk-code-bg); border-radius: var(--tk-radius-sm); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 200px; overflow-y: auto; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
</style>
