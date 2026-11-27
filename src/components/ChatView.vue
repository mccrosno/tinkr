<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useChat, type ChatMessage } from '../stores/chat'
import { useEditor } from '../stores/editor'
import { useWorkspace } from '../stores/workspace'
import { joinPath } from '../workspace/fs'
import type { EffortLevel } from '../agent/types'
import { UI_ICONS } from '../builtins/icons'
import ActionSlot from './ActionSlot.vue'
import AppIcon from './AppIcon.vue'
import AttachmentChip from './AttachmentChip.vue'
import ChangesBar from './ChangesBar.vue'
import MessageBody from './MessageBody.vue'
import PermissionCard from './PermissionCard.vue'
import RefChip from './RefChip.vue'
import SetupNotice from './SetupNotice.vue'

const chat = useChat()
const editor = useEditor()
const ws = useWorkspace()
const scroller = ref<HTMLElement>()
const input = ref<HTMLTextAreaElement>()
const root = ref<HTMLElement>()
const filePicker = ref<HTMLInputElement>()
/** Files are being dragged over the chat (shows the drop hint). */
const dragging = ref(false)

// Attachments: pasted images or files, files dropped anywhere on the chat, or the
// Attach button. All arrive as browser File objects (Tauri's own drag-and-drop is
// turned off in tauri.conf.json so the webview gets the drop).
function onPaste(e: ClipboardEvent) {
  const files = [...(e.clipboardData?.files ?? [])]
  if (!files.length) return // plain text: let the textarea paste it
  e.preventDefault()
  chat.addAttachments(files)
}

const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files')
function onDragOver(e: DragEvent) {
  if (!hasFiles(e) || chat.blocker) return
  e.preventDefault() // allows the drop
  dragging.value = true
}
function onDragLeave(e: DragEvent) {
  // dragleave also fires when moving onto a child element; only the chat's own edge counts.
  if (!root.value?.contains(e.relatedTarget as Node | null)) dragging.value = false
}
function onDrop(e: DragEvent) {
  dragging.value = false
  if (!hasFiles(e) || chat.blocker) return
  e.preventDefault()
  chat.addAttachments([...(e.dataTransfer?.files ?? [])])
}
function onPicked() {
  const input = filePicker.value
  if (input?.files?.length) chat.addAttachments([...input.files])
  if (input) input.value = '' // so picking the same file again still fires `change`
}

const EFFORT_LABELS: Record<EffortLevel, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }
/** The display name for a turn's model id ("claude-opus-5-5" -> "Opus 5.5"). */
function modelName(id: string | undefined) {
  if (!id) return null
  const m = chat.models.find((x) => x.resolvedModel === id && x.value !== 'default') ?? chat.models.find((x) => x.value === id)
  return m?.displayName ?? id
}

const canSubmit = computed(() => chat.canSend && !!(chat.draft.trim() || chat.draftRefs.length || chat.draftAttachments.length))

async function submit() {
  if (await chat.send(chat.draft)) chat.draft = ''
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
  if (chat.draftAttachments.length) return 'Ask about the attached files (Enter to send)'
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
    modelName(d.model),
    `${(d.durationMs / 1000).toFixed(1)} s`,
    d.costUsd !== undefined ? `~$${d.costUsd.toFixed(4)} est.` : null,
  ]
    .filter(Boolean)
    .join(' · ')
</script>

<template>
  <div ref="root" class="chat" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <div v-if="dragging" class="drop-hint" aria-hidden="true">Drop files to attach them</div>
    <div ref="scroller" class="scroller">
      <div class="column">
        <SetupNotice />
        <div v-if="chat.openingChat" class="thinking">Opening chat…</div>
        <div v-else-if="!chat.messages.length && !chat.blocker" class="empty">
          <h1>What are we building?</h1>
          <p v-if="ws.root">
            Claude works in <strong>{{ ws.name }}</strong>. Its edits show up as diffs you accept or reject. Select code in
            the editor and press Ctrl+L to ask about it.
          </p>
          <p v-else>
            Chat with Claude, and paste or drop images and files to ask about them. Open a folder to let it read and edit
            your code.
          </p>
        </div>
        <article v-for="m in chat.messages" :key="m.id" :class="['msg', m.role]" :data-outcome="m.done?.outcome">
          <template v-if="m.role === 'user'">
            <div v-if="m.attachments" class="refs"><AttachmentChip v-for="(a, i) in m.attachments" :key="i" :file="a" /></div>
            <div v-if="m.refs" class="refs"><RefChip v-for="(r, i) in m.refs" :key="i" :ref-data="r" /></div>
            <div v-if="m.text" class="bubble">{{ m.text }}</div>
          </template>
          <template v-else-if="m.role === 'assistant'">
            <MessageBody v-if="m.text" :text="m.text" :streaming="m.id === chat.streamingId" />
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
      <div class="box">
        <div v-if="chat.draftRefs.length" class="refs" data-testid="draft-refs">
          <RefChip v-for="(r, i) in chat.draftRefs" :key="`${r.path}:${r.fromLine}-${r.toLine}`" :ref-data="r" removable @remove="chat.removeRef(i)" />
        </div>
        <div v-if="chat.draftAttachments.length" class="refs" data-testid="draft-attachments">
          <AttachmentChip v-for="a in chat.draftAttachments" :key="a.id" :file="a" removable @remove="chat.removeAttachment(a.id)" />
        </div>
        <p v-if="chat.attachError" class="attach-error" role="alert">{{ chat.attachError }}</p>
        <textarea
          ref="input"
          v-model="chat.draft"
          rows="2"
          :placeholder="placeholder"
          :disabled="!!chat.blocker"
          aria-label="Message"
          @keydown="onKeydown"
          @paste="onPaste"
        />
        <div class="row">
          <input ref="filePicker" type="file" multiple hidden data-testid="file-picker" @change="onPicked" />
          <button
            type="button"
            class="tk-icon-button"
            aria-label="Attach files"
            title="Attach images, PDFs or text files"
            data-testid="attach"
            :disabled="!!chat.blocker"
            @click="filePicker?.click()"
          >
            <AppIcon :icon="{ path: UI_ICONS.attach }" />
          </button>
          <select
            v-if="chat.models.length"
            class="picker"
            aria-label="Model"
            :title="chat.modelOption?.description"
            :value="chat.modelOption?.value"
            @change="chat.setModel(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="m in chat.models" :key="m.value" :value="m.value" :title="m.description">{{ m.displayName }}</option>
          </select>
          <select
            v-if="chat.effortLevels.length"
            class="picker effort"
            aria-label="Effort"
            title="How much Claude thinks before answering"
            :value="chat.effectiveEffort ?? ''"
            @change="chat.setEffort((($event.target as HTMLSelectElement).value || null) as EffortLevel | null)"
          >
            <option value="">Default effort</option>
            <option v-for="level in chat.effortLevels" :key="level" :value="level">{{ EFFORT_LABELS[level] }} effort</option>
          </select>
          <ActionSlot slot-name="chat-toolbar" />
          <span class="spacer" />
          <button v-if="chat.busy" type="button" class="round" aria-label="Stop" title="Stop (Esc)" data-testid="stop" @click="chat.stop()">
            <AppIcon :icon="{ path: UI_ICONS.stop }" :size="16" />
          </button>
          <button v-else type="submit" class="round" aria-label="Send" title="Send (Enter)" data-testid="send" :disabled="!canSubmit">
            <AppIcon :icon="{ path: UI_ICONS.send }" :size="16" />
          </button>
        </div>
      </div>
    </form>
  </div>
</template>

<style scoped>
.chat { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; }
.drop-hint { position: absolute; inset: 8px; z-index: 5; display: flex; align-items: center; justify-content: center; border: 2px dashed var(--tk-accent); border-radius: var(--tk-radius); background: var(--tk-surface); color: var(--tk-text); font-size: 15px; opacity: 0.92; pointer-events: none; }
/* `field-sizing` makes each box as wide as its current choice, not its longest option. */
.picker { min-width: 0; max-width: 220px; field-sizing: content; height: 28px; padding: 0 4px; background: transparent; border: 0; border-radius: 7px; color: var(--tk-text-muted); font-size: 12.5px; text-overflow: ellipsis; cursor: pointer; }
/* In a narrow card the model's name is cut short first; the effort stays readable. */
.picker.effort { flex: none; }
.picker:hover { background: var(--tk-surface-2); color: var(--tk-text); }
/* The open list is drawn by the system and would otherwise inherit the transparent box. */
.picker option { background: var(--tk-popup); color: var(--tk-text); }
.attach-error { margin: 0; color: var(--tk-danger); font-size: 12.5px; }
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
.composer { padding: 0 12px 12px; }
.box { display: flex; flex-direction: column; gap: 6px; max-width: 720px; margin: 0 auto; padding: 8px 8px 8px 10px; background: var(--tk-surface); border: 1px solid var(--tk-border); border-radius: 14px; }
.box:focus-within { border-color: var(--tk-accent); }
/* Two lines, growing with the text where the webview supports `field-sizing`. */
textarea { width: 100%; max-height: 40vh; resize: none; field-sizing: content; background: transparent; border: 0; outline: none; padding: 2px 2px 0; }
.row { display: flex; align-items: center; gap: 4px; min-width: 0; }
.spacer { flex: 1; }
.round { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 50%; background: var(--tk-accent); color: var(--tk-on-accent); }
.round:hover:not(:disabled) { background: var(--tk-accent-hover); }
.round:disabled { background: var(--tk-surface-2); color: var(--tk-text-muted); }
</style>
