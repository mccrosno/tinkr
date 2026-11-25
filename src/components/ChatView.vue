<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useChat } from '../stores/chat'
import MessageBody from './MessageBody.vue'
import SetupNotice from './SetupNotice.vue'

const chat = useChat()
const draft = ref('')
const scroller = ref<HTMLElement>()
const input = ref<HTMLTextAreaElement>()
const root = ref<HTMLElement>()

async function submit() {
  if (await chat.send(draft.value)) draft.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    submit()
  } else if (e.key === 'Escape' && chat.busy) {
    chat.stop()
  }
}

// Follow the newest text while it streams, unless the user scrolled up to read.
watch(
  () => chat.messages.reduce((n, m) => n + m.text.length, chat.messages.length),
  async () => {
    const el = scroller.value
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    await nextTick()
    if (nearBottom) el.scrollTop = el.scrollHeight
  },
)

// Put the cursor back in the box when a turn ends, but only if the user is still in
// the chat (or nowhere). If they moved to the editor or a terminal meanwhile, taking
// the focus would send their next keystrokes to the wrong place.
watch(
  () => chat.busy,
  (busy) => {
    const focused = document.activeElement
    const inChat = !focused || focused === document.body || root.value?.contains(focused)
    if (!busy && inChat) input.value?.focus()
  },
)

const formatMeta = (d: NonNullable<(typeof chat.messages)[number]['done']>) =>
  [
    d.outcome === 'aborted' ? 'stopped' : null,
    `${(d.durationMs / 1000).toFixed(1)} s`,
    d.costUsd !== undefined ? `~$${d.costUsd.toFixed(4)} est.` : null,
  ]
    .filter(Boolean)
    .join(' · ')
</script>

<template>
  <div ref="root" class="chat">
    <div ref="scroller" class="scroller">
      <div class="column">
        <SetupNotice />
        <div v-if="!chat.messages.length && !chat.blocker" class="empty">
          <h1>What are we building?</h1>
          <p>
            Chat with Claude. It can't read or change your files yet, and it doesn't know how Tinkr works;
            file tools arrive with diff review, and Tinkr-aware plugin authoring after that.
          </p>
        </div>
        <article v-for="m in chat.messages" :key="m.id" :class="['msg', m.role]" :data-outcome="m.done?.outcome">
          <div v-if="m.role === 'user'" class="bubble">{{ m.text }}</div>
          <template v-else-if="m.role === 'assistant'">
            <MessageBody :text="m.text" :streaming="!m.done" />
            <div v-if="m.done" class="meta">{{ formatMeta(m.done) }}</div>
          </template>
          <div v-else class="error-box">{{ m.text }}</div>
        </article>
        <div v-if="chat.busy && !chat.messages.some((m) => m.turnId === chat.activeTurnId)" class="thinking">Thinking…</div>
      </div>
    </div>

    <form class="composer" @submit.prevent="submit">
      <div class="column box">
        <textarea
          ref="input"
          v-model="draft"
          rows="3"
          :placeholder="chat.blocker ?? 'Message Claude (Enter to send, Shift+Enter for a new line)'"
          :disabled="!!chat.blocker"
          aria-label="Message"
          @keydown="onKeydown"
        />
        <div class="row">
          <span class="hint">{{ chat.sessionId ? 'Continuing this chat' : 'New chat' }}</span>
          <button v-if="chat.busy" type="button" class="tk-button" title="Stop (Esc)" @click="chat.stop()">Stop</button>
          <button v-else type="submit" class="tk-button primary" :disabled="!chat.canSend || !draft.trim()">Send</button>
        </div>
      </div>
    </form>
  </div>
</template>

<style scoped>
.chat { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.scroller { flex: 1; overflow-y: auto; }
.column { max-width: 780px; margin: 0 auto; padding: 0 20px; }
.scroller .column { padding-top: 16px; padding-bottom: 24px; display: flex; flex-direction: column; gap: 14px; }
.empty { text-align: center; margin-top: 18vh; color: var(--tk-text-muted); }
.empty h1 { color: var(--tk-text); font-size: 22px; font-weight: 600; margin: 0 0 6px; }
.msg.user { align-self: flex-end; max-width: 80%; }
.bubble { background: var(--tk-user-bubble); border-radius: var(--tk-radius); padding: 8px 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.msg.assistant { overflow-wrap: anywhere; }
.meta { margin-top: 4px; font-size: 12px; color: var(--tk-text-muted); }
.error-box { background: var(--tk-danger-bg); color: var(--tk-danger); border-radius: var(--tk-radius-sm); padding: 8px 12px; white-space: pre-wrap; }
.thinking { color: var(--tk-text-muted); font-style: italic; }
.composer { border-top: 1px solid var(--tk-border); background: var(--tk-surface); padding: 12px 0; }
.box { display: flex; flex-direction: column; gap: 6px; }
textarea { width: 100%; resize: none; background: var(--tk-bg); border: 1px solid var(--tk-border); border-radius: var(--tk-radius); padding: 8px 10px; }
textarea:focus { border-color: var(--tk-accent); outline: none; }
.row { display: flex; align-items: center; gap: 8px; }
.hint { flex: 1; font-size: 12px; color: var(--tk-text-muted); }
</style>
