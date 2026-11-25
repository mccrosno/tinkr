<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { agent, sendMessage } from '../agent'

const draft = ref('')
const list = ref<HTMLElement>()

function submit() {
  const text = draft.value.trim()
  if (!text || agent.busy) return
  draft.value = ''
  sendMessage(text)
}

// Keep the newest message in view while text streams in.
watch(
  () => agent.messages.map((m) => m.text.length).join(),
  async () => {
    await nextTick()
    list.value?.scrollTo({ top: list.value.scrollHeight })
  },
)
</script>

<template>
  <div class="chat">
    <div ref="list" class="messages">
      <p v-if="!agent.messages.length" class="empty">Ask Claude something.</p>
      <div v-for="(m, i) in agent.messages" :key="i" :class="['msg', m.role]">
        <div class="text">{{ m.text }}</div>
        <div v-if="m.meta" class="meta">{{ m.meta }}</div>
      </div>
    </div>
    <form class="composer" @submit.prevent="submit">
      <textarea
        v-model="draft"
        rows="2"
        placeholder="Message Claude (Enter to send, Shift+Enter for a new line)"
        @keydown.enter.exact.prevent="submit"
      />
      <button type="submit" :disabled="agent.busy || !draft.trim()">{{ agent.busy ? '…' : 'Send' }}</button>
    </form>
  </div>
</template>

<style scoped>
.chat { display: flex; flex-direction: column; height: 100%; }
.messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.empty { color: var(--tk-muted); margin: auto; }
.msg { max-width: 85%; padding: 8px 12px; border-radius: 8px; white-space: pre-wrap; line-height: 1.45; }
.msg.user { align-self: flex-end; background: var(--tk-accent-bg); }
.msg.assistant { align-self: flex-start; background: var(--tk-surface-2); }
.msg.error { align-self: stretch; background: var(--tk-error-bg); color: var(--tk-error); }
.meta { margin-top: 4px; font-size: 11px; color: var(--tk-muted); }
.composer { display: flex; gap: 8px; padding: 8px; border-top: 1px solid var(--tk-border); }
textarea { flex: 1; resize: none; font: inherit; color: inherit; background: var(--tk-surface-2); border: 1px solid var(--tk-border); border-radius: 6px; padding: 6px 8px; }
button { padding: 0 16px; border-radius: 6px; border: 0; background: var(--tk-accent); color: var(--tk-on-accent); font: inherit; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
</style>
