<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useChat, type ChatMessage } from '../stores/chat'
import { useEditor } from '../stores/editor'
import { useWorkspace } from '../stores/workspace'
import { joinPath } from '../workspace/fs'
import ChangesBar from './ChangesBar.vue'
import MessageBody from './MessageBody.vue'
import PermissionCard from './PermissionCard.vue'
import RefChip from './RefChip.vue'
import SetupNotice from './SetupNotice.vue'

const chat = useChat()
const editor = useEditor()
const ws = useWorkspace()
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

// "Ask Claude" / "Request changes" in the editor: jump to the composer.
watch(() => chat.focusRequests, () => nextTick(() => input.value?.focus()))

const placeholder = computed(() => {
  if (chat.blocker) return chat.blocker
  const last = chat.draftRefs.at(-1)
  if (last?.purpose === 'change') return 'Describe the change you want (Enter to send)'
  if (last) return 'Ask about the selected code (Enter to send)'
  return 'Message Claude (Enter to send, Shift+Enter for a new line)'
})

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
/** Tool calls on project files link to the file (the summary is its relative path). */
function toolFile(m: ChatMessage) {
  const t = m.tool
  // Absolute summaries are files outside the project; those don't get a link.
  if (!t || !ws.root || !(EDIT_TOOLS.has(t.name) || t.name === 'Read') || !t.summary || /^([a-zA-Z]:|[\\/])/.test(t.summary)) return null
  return joinPath(ws.root, ws.root.includes('\\') ? t.summary.replaceAll('/', '\\') : t.summary)
}

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
          <p v-if="ws.root">
            Claude works in <strong>{{ ws.name }}</strong>. Its edits show up as diffs you accept or reject. Select code in
            the editor and press Ctrl+L to ask about it.
          </p>
          <p v-else>Chat with Claude. Open a folder to let it read and edit your code.</p>
        </div>
        <article v-for="m in chat.messages" :key="m.id" :class="['msg', m.role]" :data-outcome="m.done?.outcome">
          <template v-if="m.role === 'user'">
            <div v-if="m.refs" class="refs"><RefChip v-for="(r, i) in m.refs" :key="i" :ref-data="r" /></div>
            <div v-if="m.text" class="bubble">{{ m.text }}</div>
          </template>
          <template v-else-if="m.role === 'assistant'">
            <MessageBody v-if="m.text" :text="m.text" :streaming="!m.done" />
            <div v-if="m.done" class="meta">{{ formatMeta(m.done) }}</div>
          </template>
          <div v-else-if="m.role === 'tool' && m.tool" class="tool" :class="m.tool.status" :data-tool="m.tool.name">
            <span class="status" aria-hidden="true" />
            <span class="name">{{ m.tool.name }}</span>
            <button v-if="toolFile(m)" class="summary link" :title="toolFile(m)!" @click="editor.open(toolFile(m)!)">{{ m.tool.summary }}</button>
            <span v-else class="summary">{{ m.tool.summary }}</span>
          </div>
          <PermissionCard v-else-if="m.role === 'permission' && m.permission" :request="m.permission" />
          <div v-else class="error-box">{{ m.text }}</div>
        </article>
        <div v-if="chat.busy && !chat.messages.some((m) => m.turnId === chat.activeTurnId)" class="thinking">Thinking…</div>
      </div>
    </div>

    <ChangesBar />
    <form class="composer" @submit.prevent="submit">
      <div class="column box">
        <div v-if="chat.draftRefs.length" class="refs" data-testid="draft-refs">
          <RefChip v-for="(r, i) in chat.draftRefs" :key="`${r.path}:${r.fromLine}-${r.toLine}`" :ref-data="r" removable @remove="chat.removeRef(i)" />
        </div>
        <textarea
          ref="input"
          v-model="draft"
          rows="3"
          :placeholder="placeholder"
          :disabled="!!chat.blocker"
          aria-label="Message"
          @keydown="onKeydown"
        />
        <div class="row">
          <span class="hint">{{ chat.sessionId ? 'Continuing this chat' : 'New chat' }}</span>
          <button v-if="chat.busy" type="button" class="tk-button" title="Stop (Esc)" @click="chat.stop()">Stop</button>
          <button v-else type="submit" class="tk-button primary" :disabled="!chat.canSend || (!draft.trim() && !chat.draftRefs.length)">Send</button>
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
.msg.user { align-self: flex-end; max-width: 80%; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.refs { display: flex; flex-wrap: wrap; gap: 4px; }
.msg.tool, .msg.permission { margin-top: -6px; }
.tool { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--tk-text-muted); min-width: 0; }
.tool .status { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--tk-text-muted); }
.tool.running .status { background: var(--tk-accent); animation: pulse 1s ease-in-out infinite alternate; }
.tool.done .status { background: var(--tk-ok); }
.tool.error .status { background: var(--tk-danger); }
.tool .name { color: var(--tk-text); }
.tool .summary { font-family: var(--tk-font-mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool .link { border: 0; padding: 0; background: none; color: inherit; }
.tool .link:hover { color: var(--tk-accent); text-decoration: underline; }
@keyframes pulse { to { opacity: 0.3; } }
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
