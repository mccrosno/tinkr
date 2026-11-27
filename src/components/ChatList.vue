<script setup lang="ts">
// Past chats in the current folder (or the chats without a folder), newest first, or
// with "All folders" every chat Claude Code has stored: from Tinkr, the CLI and
// Desktop's Code tab alike. Click one to show it and continue it (a chat of another
// folder asks the app to open that folder first); rename or delete it from its row.
import { computed, nextTick, ref } from 'vue'
import { ask } from '@tauri-apps/plugin-dialog'
import type { ChatSummary } from '../agent/types'
import { useChat } from '../stores/chat'
import { useWorkspace } from '../stores/workspace'
import { baseName } from '../workspace/fs'

const chat = useChat()
const ws = useWorkspace()
const emit = defineEmits<{ 'open-elsewhere': [folder: string | null, sessionId: string] }>()
const filter = ref('')
/** The chat whose name is being edited, and the text in its box. */
const renaming = ref<string | null>(null)
const renameText = ref('')
const renameInput = ref<HTMLInputElement[]>()

const shown = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return chat.chats
  return chat.chats.filter((c) => c.title.toLowerCase().includes(q) || (chat.allFolders && folderLabel(c).toLowerCase().includes(q)))
})

const folderLabel = (c: ChatSummary) => (c.folder ? baseName(c.folder) : 'No folder')

function open(c: ChatSummary) {
  if (chat.isHere(c.folder)) chat.openChat(c.sessionId)
  else emit('open-elsewhere', c.folder, c.sessionId)
}

/** "3 min ago", "Yesterday", "12 Nov": short enough for a narrow sidebar. */
function when(ms: number) {
  const minutes = Math.round((Date.now() - ms) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  const d = new Date(ms)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
}

async function startRename(id: string, title: string) {
  renaming.value = id
  renameText.value = title
  await nextTick()
  renameInput.value?.[0]?.select()
}

async function finishRename(save: boolean) {
  const id = renaming.value
  renaming.value = null
  if (save && id) await chat.renameChat(id, renameText.value)
}

async function remove(id: string, title: string) {
  const ok = await ask(`Delete “${title}”? This removes the conversation from Claude Code too, and can't be undone.`, {
    title: 'Delete chat',
    kind: 'warning',
    okLabel: 'Delete',
    cancelLabel: 'Cancel',
  })
  if (ok) await chat.deleteChat(id)
}
</script>

<template>
  <nav class="chats" aria-label="Chats">
    <div class="header">
      <span class="title" :title="chat.allFolders ? 'Every chat Claude Code has stored' : (ws.root ?? 'Chats without a folder')">
        {{ chat.allFolders ? 'All chats' : ws.root ? `Chats in ${ws.name}` : 'Chats without a folder' }}
      </span>
      <button class="tk-button" title="New chat (Ctrl+N)" :disabled="chat.busy" @click="chat.newChat()">New</button>
    </div>
    <label class="scope" title="Show chats from every folder, including ones started in the Claude Code CLI or Claude Desktop's Code tab">
      <input type="checkbox" :checked="chat.allFolders" data-testid="all-folders" @change="chat.setAllFolders(($event.target as HTMLInputElement).checked)" />
      All folders
    </label>
    <input v-if="chat.chats.length > 6" v-model="filter" class="filter" type="search" placeholder="Search chats" aria-label="Search chats" />
    <p v-if="chat.chatsError" class="error" role="alert">{{ chat.chatsError }}</p>
    <ul>
      <li
        v-for="c in shown"
        :key="c.sessionId"
        :class="{ active: c.sessionId === chat.sessionId }"
        :aria-current="c.sessionId === chat.sessionId ? 'true' : undefined"
        :data-session="c.sessionId"
      >
        <input
          v-if="renaming === c.sessionId"
          ref="renameInput"
          v-model="renameText"
          class="rename"
          aria-label="Chat name"
          @keydown.enter.prevent="finishRename(true)"
          @keydown.escape.prevent="finishRename(false)"
          @blur="finishRename(true)"
        />
        <button
          v-else
          class="open"
          :title="chat.busy && c.sessionId !== chat.sessionId ? 'Wait for the reply to finish' : [c.title, c.folder].filter(Boolean).join('\n')"
          :disabled="chat.busy && c.sessionId !== chat.sessionId"
          @click="open(c)"
          @dblclick="startRename(c.sessionId, c.title)"
        >
          <span class="name">{{ c.title }}</span>
          <span class="when">
            <template v-if="chat.allFolders"><span class="folder">{{ folderLabel(c) }}</span> · </template>{{ when(c.lastModified) }}
          </span>
        </button>
        <span v-if="renaming !== c.sessionId" class="actions">
          <button class="icon" title="Rename" :aria-label="`Rename ${c.title}`" @click="startRename(c.sessionId, c.title)">✎</button>
          <button
            class="icon"
            title="Delete"
            :aria-label="`Delete ${c.title}`"
            :disabled="chat.busy && c.sessionId === chat.sessionId"
            @click="remove(c.sessionId, c.title)"
          >
            ×
          </button>
        </span>
      </li>
    </ul>
    <p v-if="!chat.chats.length && !chat.chatsError" class="empty">
      {{ chat.allFolders ? 'No chats yet.' : ws.root ? 'No chats in this folder yet.' : 'No chats without a folder yet.' }}
    </p>
    <p v-else-if="!shown.length" class="empty">No chat matches “{{ filter }}”.</p>
  </nav>
</template>

<style scoped>
.chats { height: 100%; display: flex; flex-direction: column; background: var(--tk-surface); font-size: 13px; min-width: 0; }
.header { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px; border-bottom: 1px solid var(--tk-border); }
.title { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scope { display: flex; align-items: center; gap: 6px; padding: 6px 12px 0; color: var(--tk-text-muted); font-size: 12.5px; cursor: pointer; }
.scope input { margin: 0; accent-color: var(--tk-accent); }
.folder { color: var(--tk-text); }
.filter { margin: 8px 8px 0; padding: 4px 8px; background: var(--tk-bg); border: 1px solid var(--tk-border); border-radius: var(--tk-radius-sm); }
.filter:focus { border-color: var(--tk-accent); outline: none; }
ul { list-style: none; margin: 0; padding: 4px 0; overflow: auto; flex: 1; }
li { position: relative; display: flex; align-items: center; }
li:hover, li:focus-within { background: var(--tk-surface-2); }
li.active { background: var(--tk-selection); }
.open { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 5px 12px; border: 0; background: none; text-align: left; }
.open:disabled { opacity: 0.55; }
.name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.when { font-size: 11.5px; color: var(--tk-text-muted); }
/* Row buttons appear on hover or keyboard focus, so long titles get the full width otherwise. */
.actions { position: absolute; right: 4px; display: none; gap: 2px; background: inherit; }
li:hover .actions, li:focus-within .actions { display: flex; }
.icon { background: none; border: 0; color: var(--tk-text-muted); font-size: 14px; line-height: 1; padding: 2px 5px; border-radius: 4px; }
.icon:hover:not(:disabled) { color: var(--tk-text); background: var(--tk-bg); }
.rename { flex: 1; margin: 3px 8px; padding: 3px 6px; background: var(--tk-bg); border: 1px solid var(--tk-accent); border-radius: var(--tk-radius-sm); outline: none; }
.error, .empty { padding: 8px 12px; color: var(--tk-text-muted); margin: 0; }
.error { color: var(--tk-danger); }
</style>
