<script setup lang="ts">
// Past chats in the current folder (or the chats without a folder), grouped by day, or
// with "All folders" every chat Claude Code has stored: from Tinkr, the CLI and
// Desktop's Code tab alike. Click one to show it and continue it (a chat of another
// folder asks the app to open that folder first); rename or delete it from its row.
import { computed, nextTick, ref } from 'vue'
import { ask } from '@tauri-apps/plugin-dialog'
import type { ChatSummary } from '../agent/types'
import { UI_ICONS } from '../builtins/icons'
import { groupByDay, timeAgo } from '../chat/dates'
import { useChat } from '../stores/chat'
import { useWorkspace } from '../stores/workspace'
import { baseName } from '../workspace/fs'
import AppIcon from './AppIcon.vue'

const chat = useChat()
const ws = useWorkspace()
const emit = defineEmits<{
  'new-chat': []
  /** A chat of this folder was picked: the Chat panel should be on screen. */
  'show-chat': []
  'open-elsewhere': [folder: string | null, sessionId: string]
}>()
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
const groups = computed(() => groupByDay(shown.value))

function open(c: ChatSummary) {
  if (!chat.isHere(c.folder)) return emit('open-elsewhere', c.folder, c.sessionId)
  emit('show-chat')
  // The current chat only needs showing; loading it again would lose its place.
  if (c.sessionId !== chat.sessionId) chat.openChat(c.sessionId)
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
    <button type="button" class="new-chat" title="New chat (Ctrl+N)" data-testid="new-chat" :disabled="chat.busy" @click="emit('new-chat')">
      <AppIcon :icon="{ path: UI_ICONS.plus }" :size="16" />
      New chat
    </button>
    <div class="scope" role="group" aria-label="Which chats to list">
      <button
        type="button"
        :aria-pressed="!chat.allFolders"
        :title="ws.root ?? 'Chats without a folder'"
        data-testid="this-folder"
        @click="chat.setAllFolders(false)"
      >
        {{ ws.root ? 'This folder' : 'No folder' }}
      </button>
      <button
        type="button"
        :aria-pressed="chat.allFolders"
        title="Chats from every folder, including ones started in the Claude Code CLI or Claude Desktop's Code tab"
        data-testid="all-folders"
        @click="chat.setAllFolders(true)"
      >
        All folders
      </button>
    </div>
    <input v-if="chat.chats.length > 6" v-model="filter" class="filter" type="search" placeholder="Search chats" aria-label="Search chats" />
    <p v-if="chat.chatsError" class="error" role="alert">{{ chat.chatsError }}</p>
    <div class="list">
      <section v-for="group in groups" :key="group.label" :aria-label="group.label">
        <h3>{{ group.label }}</h3>
        <ul>
          <li
            v-for="c in group.chats"
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
                <template v-if="chat.allFolders"><span class="folder">{{ folderLabel(c) }}</span> · </template>{{ timeAgo(c.lastModified) }}
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
      </section>
    </div>
    <p v-if="!chat.chats.length && !chat.chatsError" class="empty">
      {{ chat.allFolders ? 'No chats yet.' : ws.root ? 'No chats in this folder yet.' : 'No chats without a folder yet.' }}
    </p>
    <p v-else-if="!shown.length" class="empty">No chat matches “{{ filter }}”.</p>
  </nav>
</template>

<style scoped>
.chats { height: 100%; display: flex; flex-direction: column; gap: 8px; padding-top: 4px; font-size: 13px; min-width: 0; }
.new-chat { flex: none; display: flex; align-items: center; justify-content: center; gap: 6px; height: 30px; margin: 0 8px; border: 1px solid var(--tk-border); border-radius: 8px; background: none; font-weight: 600; white-space: nowrap; }
.new-chat:hover:not(:disabled) { background: var(--tk-surface-2); }
.new-chat:disabled { opacity: 0.5; }
.scope { flex: none; display: flex; gap: 2px; margin: 0 8px; padding: 2px; border-radius: 8px; background: var(--tk-surface); }
.scope button { flex: 1; min-width: 0; height: 24px; overflow: hidden; border: 0; border-radius: 6px; background: none; color: var(--tk-text-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.scope button[aria-pressed='true'] { background: var(--tk-surface-2); color: var(--tk-text); }
.folder { color: var(--tk-text); }
.filter { flex: none; margin: 0 8px; padding: 4px 8px; background: var(--tk-bg); border: 1px solid var(--tk-border); border-radius: var(--tk-radius-sm); }
.filter:focus { border-color: var(--tk-accent); outline: none; }
.list { flex: 1; overflow: auto; padding-bottom: 4px; }
h3 { margin: 0; padding: 6px 12px 2px; font-size: 11px; font-weight: 600; color: var(--tk-text-muted); }
ul { list-style: none; margin: 0; padding: 0; }
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
