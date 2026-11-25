<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { ask } from '@tauri-apps/plugin-dialog'
import { ClaudeSidecarProvider } from './agent/claudeSidecar'
import ChatView from './components/ChatView.vue'
import EditorPane from './components/EditorPane.vue'
import EditorTabs from './components/EditorTabs.vue'
import FileTree from './components/FileTree.vue'
import Splitter from './components/Splitter.vue'
import StatusBar from './components/StatusBar.vue'
import Welcome from './components/Welcome.vue'
import { useChat } from './stores/chat'
import { useEditor } from './stores/editor'
import { useWorkspace } from './stores/workspace'

const chat = useChat()
const ws = useWorkspace()
const editor = useEditor()

// Panel widths, remembered per user (a convenience; fine if storage is unavailable).
function stored(key: string, fallback: number) {
  try {
    return Number(localStorage.getItem(key)) || fallback
  } catch {
    return fallback
  }
}
const treeWidth = ref(stored('tinkr.treeWidth', 240))
const chatWidth = ref(stored('tinkr.chatWidth', 400))
watch([treeWidth, chatWidth], ([t, c]) => {
  try {
    localStorage.setItem('tinkr.treeWidth', String(t))
    localStorage.setItem('tinkr.chatWidth', String(c))
  } catch {
    /* not persisted */
  }
})

/** Ask before discarding unsaved edits. Returns true if it's OK to continue. */
async function confirmDiscard() {
  if (!editor.dirtyCount) return true
  return ask(`You have unsaved changes in ${editor.dirtyCount} file(s). Discard them?`, {
    title: 'Unsaved changes',
    kind: 'warning',
    okLabel: 'Discard changes',
    cancelLabel: 'Cancel',
  })
}

async function openFolder(path?: string) {
  if (!(await confirmDiscard())) return
  const before = ws.root
  if (path) await ws.openFolder(path)
  else await ws.pickAndOpen()
  if (ws.root !== before) editor.closeAll()
}

async function closeFolder() {
  if (!(await confirmDiscard())) return
  editor.closeAll()
  await ws.closeFolder()
}

// The chat works in the open folder; switching folders starts a new conversation.
watch(() => ws.root, (root) => chat.setProject(root))

onMounted(() => {
  ws.onFilesChanged((paths) => editor.onDiskChange(paths))
  chat.connect(new ClaudeSidecarProvider())
  ws.init()
})

// Ctrl/Cmd+O opens a folder from anywhere (Ctrl+S is handled inside the editor).
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'o') {
    e.preventDefault()
    openFolder()
  }
}

// Dev only: hooks for the e2e scripts (folder pickers can't be driven over CDP).
if (import.meta.env.DEV) Object.assign(window, { __tinkrOpenFolder: (p: string) => openFolder(p) })
</script>

<template>
  <div class="app" @keydown="onKeydown">
    <header class="titlebar">
      <strong>Tinkr</strong>
      <span v-if="ws.name" class="project" :title="ws.root ?? ''">{{ ws.name }}</span>
      <span class="spacer" />
      <button class="tk-button" title="Open folder (Ctrl+O)" @click="openFolder()">Open folder…</button>
      <button class="tk-button" :disabled="chat.busy || !chat.messages.length" @click="chat.newChat()">New chat</button>
    </header>

    <main class="main">
      <template v-if="ws.root">
        <aside class="side" :style="{ width: `${treeWidth}px` }"><FileTree @close-folder="closeFolder" /></aside>
        <Splitter v-model:size="treeWidth" :min="160" :max="520" side="left" label="Resize file tree" />
        <section class="center">
          <EditorTabs v-if="editor.tabs.length" />
          <p v-if="editor.lastError" class="error" role="alert">{{ editor.lastError }}</p>
          <EditorPane v-if="editor.tabs.length" class="editor" />
          <div v-else class="no-file">Pick a file from the tree.</div>
        </section>
      </template>
      <section v-else class="center"><Welcome @open="openFolder" /></section>
      <Splitter v-model:size="chatWidth" :min="300" :max="900" side="right" label="Resize chat" />
      <aside class="chat-panel" :style="{ width: `${chatWidth}px` }"><ChatView /></aside>
    </main>

    <StatusBar />
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100%; }
.titlebar { display: flex; align-items: center; gap: 10px; padding: 6px 12px; border-bottom: 1px solid var(--tk-border); background: var(--tk-surface); }
.project { color: var(--tk-text-muted); }
.project::before { content: '/'; margin-right: 10px; color: var(--tk-border); }
.spacer { flex: 1; }
.main { flex: 1; min-height: 0; display: flex; }
.side, .chat-panel { flex: none; min-width: 0; }
.chat-panel { background: var(--tk-surface); }
.center { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.editor { flex: 1; min-height: 0; }
.no-file { margin: auto; color: var(--tk-text-muted); }
.error { margin: 0; padding: 6px 12px; color: var(--tk-danger); background: var(--tk-danger-bg); font-size: 13px; }
</style>
