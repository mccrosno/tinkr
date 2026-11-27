<script setup lang="ts">
// Chat-first layout (SPEC.md "Layout"):
//
//   [ sidebar: file tree ] [ chat (main area) ] [ editor, on demand ]
//   [ terminal (toggle), under the chat and editor                   ]
//
// The editor opens when you open a file or Claude edits one, and can be hidden again.
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
import { useReview } from './stores/review'
import { useTerminal } from './stores/terminal'
import { useWorkspace } from './stores/workspace'

const chat = useChat()
const ws = useWorkspace()
const editor = useEditor()
const review = useReview()
const terminal = useTerminal()

// Panel sizes and the sidebar toggle, remembered per user (fine if storage is unavailable).
function stored(key: string, fallback: number) {
  try {
    return Number(localStorage.getItem(key)) || fallback
  } catch {
    return fallback
  }
}
const treeWidth = ref(stored('tinkr.treeWidth', 240))
// The chat stays the bigger part: by default the editor gets 40% of the window.
const editorWidth = ref(stored('tinkr.editorWidth', Math.round(window.innerWidth * 0.4)))
const terminalHeight = ref(stored('tinkr.terminalHeight', 260))
const sidebarOpen = ref(stored('tinkr.sidebarOpen', 1) === 1)
watch([treeWidth, editorWidth, terminalHeight, sidebarOpen], ([t, e, h, s]) => {
  try {
    localStorage.setItem('tinkr.treeWidth', String(t))
    localStorage.setItem('tinkr.editorWidth', String(e))
    localStorage.setItem('tinkr.terminalHeight', String(h))
    // 1 = open, 2 = closed (not 0: `stored` treats 0 as "missing" and falls back to open).
    localStorage.setItem('tinkr.sidebarOpen', s ? '1' : '2')
  } catch {
    /* not persisted */
  }
})

/**
 * Ask before leaving the folder if that would discard unsaved edits or kill running
 * shells (a dev server, say). Returns true if it's OK to continue. Claude's unreviewed
 * changes stay on disk either way, so they don't need a warning.
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

/** Everything that belongs to the old folder: its tabs, terminals and pending review. */
function leaveFolder() {
  editor.closeAll()
  terminal.closeAll()
  review.clear()
}

async function openFolder(path?: string) {
  if (!(await confirmLeave())) return
  const before = ws.root
  if (path) await ws.openFolder(path)
  else await ws.pickAndOpen()
  if (ws.root !== before) leaveFolder()
}

async function closeFolder() {
  if (!(await confirmLeave())) return
  leaveFolder()
  await ws.closeFolder()
}

function toggleTerminal() {
  if (ws.root) terminal.toggle(ws.root)
}

function toggleEditor() {
  if (editor.tabs.length) editor.panelOpen = !editor.panelOpen
}

// The chat works in the open folder; switching folders starts a new conversation.
watch(() => ws.root, (root) => chat.setProject(root))

// App shortcuts, from anywhere in the window (Ctrl+S is handled inside the editor):
// Ctrl/Cmd+O open a folder, Ctrl+B files, Ctrl+Shift+E editor, Ctrl+` terminal.
// The terminal lets these keys through instead of sending them to the shell.
function onKeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey
  const k = e.key.toLowerCase()
  let handled = true
  if (mod && !e.shiftKey && k === 'o') openFolder()
  else if (mod && !e.shiftKey && k === 'b') sidebarOpen.value = !sidebarOpen.value
  else if (mod && e.shiftKey && k === 'e') toggleEditor()
  else if (e.ctrlKey && e.code === 'Backquote') toggleTerminal()
  else handled = false
  if (handled) e.preventDefault()
}

onMounted(() => {
  ws.onFilesChanged((paths) => {
    editor.onDiskChange(paths)
    review.onDiskChange(paths)
  })
  // Claude's edits: the review store keeps baselines; changed files open in the editor
  // so you can watch them change.
  chat.onFileEvent((e) => review.onAgentFile(e))
  review.onChanged(async (path) => {
    await editor.onDiskChange([path]) // refresh it now if it's already open (the watcher is slower)
    await editor.open(path)
  })
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
      <button class="tk-button toggle" title="Show or hide files (Ctrl+B)" :aria-pressed="sidebarOpen" @click="sidebarOpen = !sidebarOpen">Files</button>
      <button class="tk-button toggle" title="Show or hide the editor (Ctrl+Shift+E)" :aria-pressed="editor.panelOpen" :disabled="!editor.tabs.length" @click="toggleEditor">Editor</button>
      <button v-if="ws.root" class="tk-button toggle" title="Show or hide the terminal (Ctrl+`)" :aria-pressed="terminal.visible" @click="toggleTerminal">Terminal</button>
      <button class="tk-button" :disabled="chat.busy || !chat.messages.length" @click="chat.newChat()">New chat</button>
    </header>

    <main class="main">
      <template v-if="sidebarOpen">
        <aside class="side" :style="{ width: `${treeWidth}px` }">
          <FileTree v-if="ws.root" @close-folder="closeFolder" />
          <Welcome v-else compact @open="openFolder" />
        </aside>
        <Splitter v-model:size="treeWidth" :min="160" :max="520" side="left" label="Resize sidebar" />
      </template>

      <div class="work">
        <div class="upper">
          <section class="chat-area"><ChatView /></section>
          <template v-if="editor.panelOpen && editor.tabs.length">
            <Splitter v-model:size="editorWidth" :min="320" :max="1400" side="right" label="Resize editor" />
            <section class="editor-panel" :style="{ width: `${editorWidth}px` }" data-testid="editor-panel">
              <EditorTabs @hide="editor.panelOpen = false" />
              <p v-if="editor.lastError" class="error" role="alert">{{ editor.lastError }}</p>
              <EditorPane class="editor" />
            </section>
          </template>
        </div>
        <!-- v-show, not v-if: hiding the panel keeps the shells and their screens. -->
        <template v-if="terminal.tabs.length">
          <Splitter v-show="terminal.visible" v-model:size="terminalHeight" :min="100" :max="900" side="bottom" label="Resize terminal" />
          <TerminalPanel v-show="terminal.visible" class="terminal" :style="{ height: `${terminalHeight}px` }" />
        </template>
      </div>
    </main>

    <StatusBar />
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100%; }
.titlebar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--tk-border); background: var(--tk-surface); }
.project { color: var(--tk-text-muted); }
.project::before { content: '/'; margin-right: 10px; color: var(--tk-border); }
.spacer { flex: 1; }
.toggle[aria-pressed='true'] { border-color: var(--tk-accent); }
.main { flex: 1; min-height: 0; display: flex; }
.side { flex: none; min-width: 0; background: var(--tk-surface); }
.work { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.upper { flex: 1; min-height: 0; display: flex; }
/* The chat is the main area: it takes the space the editor doesn't, but never less than 320px. */
.chat-area { flex: 1; min-width: 320px; }
.editor-panel { flex: none; min-width: 0; max-width: calc(100% - 320px); display: flex; flex-direction: column; border-left: 1px solid var(--tk-border); }
.editor { flex: 1; min-height: 0; }
/* Never taller than most of the column, so the chat keeps some room. */
.terminal { flex: none; max-height: calc(100% - 120px); }
.error { margin: 0; padding: 6px 12px; color: var(--tk-danger); background: var(--tk-danger-bg); font-size: 13px; }
</style>
