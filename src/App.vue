<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ask } from '@tauri-apps/plugin-dialog'
import { ClaudeSidecarProvider } from './agent/claudeSidecar'
import ChatView from './components/ChatView.vue'
import EditorPane from './components/EditorPane.vue'
import EditorTabs from './components/EditorTabs.vue'
import FileTree from './components/FileTree.vue'
import Splitter from './components/Splitter.vue'
import StatusBar from './components/StatusBar.vue'
import TerminalPanel from './components/TerminalPanel.vue'
import Welcome from './components/Welcome.vue'
import { useChat } from './stores/chat'
import { useEditor } from './stores/editor'
import { useTerminal } from './stores/terminal'
import { useWorkspace } from './stores/workspace'

const chat = useChat()
const ws = useWorkspace()
const editor = useEditor()
const terminal = useTerminal()

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
const terminalHeight = ref(stored('tinkr.terminalHeight', 260))
watch([treeWidth, chatWidth, terminalHeight], ([t, c, h]) => {
  try {
    localStorage.setItem('tinkr.treeWidth', String(t))
    localStorage.setItem('tinkr.chatWidth', String(c))
    localStorage.setItem('tinkr.terminalHeight', String(h))
  } catch {
    /* not persisted */
  }
})

/**
 * Ask before leaving the folder if that would discard unsaved edits or kill running
 * shells (a dev server, say). Returns true if it's OK to continue.
 */
async function confirmLeave() {
  const files = editor.dirtyCount
  const shells = terminal.runningCount
  if (!files && !shells) return true
  const lines = []
  if (files) lines.push(`You have unsaved changes in ${files} file(s).`)
  if (shells) lines.push(`${shells} open terminal(s) will be closed, stopping anything running in them.`)
  return ask(`${lines.join('\n')}\n\nContinue?`, {
    title: files ? 'Unsaved changes' : 'Close terminals',
    kind: 'warning',
    okLabel: files ? 'Discard changes' : 'Close terminals',
    cancelLabel: 'Cancel',
  })
}

async function openFolder(path?: string) {
  if (!(await confirmLeave())) return
  const before = ws.root
  if (path) await ws.openFolder(path)
  else await ws.pickAndOpen()
  if (ws.root !== before) {
    editor.closeAll()
    // Terminals belong to the folder they were opened in, like the chat.
    terminal.closeAll()
  }
}

async function closeFolder() {
  if (!(await confirmLeave())) return
  editor.closeAll()
  terminal.closeAll()
  await ws.closeFolder()
}

function toggleTerminal() {
  if (ws.root) terminal.toggle(ws.root)
}

// The chat works in the open folder; switching folders starts a new conversation.
watch(() => ws.root, (root) => chat.setProject(root))

// App shortcuts, from anywhere in the window (Ctrl+S is handled inside the editor):
// Ctrl/Cmd+O opens a folder, Ctrl+` shows or hides the terminal. The terminal lets
// these keys through instead of sending them to the shell (TerminalView.vue).
function onKeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'o') {
    e.preventDefault()
    openFolder()
  } else if (e.ctrlKey && e.code === 'Backquote') {
    e.preventDefault()
    toggleTerminal()
  }
}

onMounted(() => {
  ws.onFilesChanged((paths) => editor.onDiskChange(paths))
  chat.connect(new ClaudeSidecarProvider())
  ws.init()
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

// Dev only: hooks for the e2e scripts (folder pickers can't be driven over CDP).
if (import.meta.env.DEV) Object.assign(window, { __tinkrOpenFolder: (p: string) => openFolder(p) })
</script>

<template>
  <div class="app">
    <header class="titlebar">
      <strong>Tinkr</strong>
      <span v-if="ws.name" class="project" :title="ws.root ?? ''">{{ ws.name }}</span>
      <span class="spacer" />
      <button class="tk-button" title="Open folder (Ctrl+O)" @click="openFolder()">Open folder…</button>
      <button v-if="ws.root" class="tk-button" title="Show or hide the terminal (Ctrl+`)" :aria-pressed="terminal.visible" @click="toggleTerminal">Terminal</button>
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
          <!-- v-show, not v-if: hiding the panel keeps the shells and their screens. -->
          <template v-if="terminal.tabs.length">
            <Splitter v-show="terminal.visible" v-model:size="terminalHeight" :min="100" :max="900" side="bottom" label="Resize terminal" />
            <TerminalPanel v-show="terminal.visible" class="terminal" :style="{ height: `${terminalHeight}px` }" />
          </template>
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
/* Never taller than most of the column, so the editor keeps some room. */
.terminal { flex: none; max-height: calc(100% - 80px); }
.error { margin: 0; padding: 6px 12px; color: var(--tk-danger); background: var(--tk-danger-bg); font-size: 13px; }
</style>
