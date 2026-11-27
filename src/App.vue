<script setup lang="ts">
// The window: a titlebar, the docking area, the status bar.
//
// The dock (DockLayout.vue, dockview) holds five panels: Chats, Files, Chat, Editor and
// Terminal. Their content lives here and is teleported into the panel's box, or into a
// hidden "parking" box while the panel isn't in the layout. So content is created once
// and never rebuilt when panels move, presets switch or a layout is restored.
//
// Presets (SPEC.md "Layout"): "Agent", chat-first and the default, and "Editor", a classic
// IDE; plus any the user saves. The editor shows when a file opens and the terminal when
// one starts; both can be hidden again, and keep their place in the layout.
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { ask } from '@tauri-apps/plugin-dialog'
import { ClaudeSidecarProvider } from './agent/claudeSidecar'
import ChatList from './components/ChatList.vue'
import ChatView from './components/ChatView.vue'
import DockLayout from './components/DockLayout.vue'
import EditorPane from './components/EditorPane.vue'
import EditorTabs from './components/EditorTabs.vue'
import FileTree from './components/FileTree.vue'
import LayoutMenu from './components/LayoutMenu.vue'
import StatusBar from './components/StatusBar.vue'
import TerminalPanel from './components/TerminalPanel.vue'
import Welcome from './components/Welcome.vue'
import { useChat } from './stores/chat'
import { useEditor } from './stores/editor'
import { useLayout } from './stores/layout'
import { useReview } from './stores/review'
import { useTerminal } from './stores/terminal'
import { useWorkspace } from './stores/workspace'
import { samePath } from './workspace/fs'

const chat = useChat()
const ws = useWorkspace()
const editor = useEditor()
const review = useReview()
const terminal = useTerminal()
const layout = useLayout()

/** Where content goes while its panel isn't in the layout. */
const PARKING = '#tk-parking'

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

/**
 * Open a folder (a path, or pick one). Opening it yourself brings the Files panel to
 * the front; `showFiles: false` leaves the panels as they are (when a chat from another
 * folder is being opened from the Chats list).
 */
async function openFolder(path?: string, { showFiles = true } = {}) {
  if (!(await confirmLeave())) return
  const before = ws.root
  if (path) await ws.openFolder(path)
  else await ws.pickAndOpen()
  if (ws.root !== before) {
    leaveFolder()
    if (showFiles) layout.show('files')
  }
}

async function closeFolder() {
  if (!(await confirmLeave())) return
  leaveFolder()
  await ws.closeFolder()
}

/**
 * Open a chat from the all-folders list that belongs to another folder: switch to that
 * folder (or close the folder, for a chat without one) the usual way, which asks first
 * about unsaved edits and running terminals, then show the chat.
 */
async function openChatIn(folder: string | null, sessionId: string) {
  if (chat.busy) return
  if (folder === null) await closeFolder()
  else await openFolder(folder, { showFiles: false })
  const arrived = folder === null ? ws.root === null : !!ws.root && samePath(ws.root, folder)
  if (!arrived) {
    // Cancelled, or the folder couldn't be opened (moved or deleted): say so in the list.
    if (ws.error) chat.chatsError = `Couldn't open that chat's folder: ${ws.error}`
    return
  }
  await chat.setProject(ws.root)
  await chat.openChat(sessionId)
}

// ---------------------------------------------------------------------------
// Keeping the dock and the stores in agreement.
// The editor and terminal stores say whether they want to be seen (a file was opened,
// a terminal started, the user pressed Ctrl+`); the dock shows or hides the panel. The
// other way round, closing a panel's tab in the dock tells the store it's hidden.
// ---------------------------------------------------------------------------

const editorWanted = computed(() => editor.panelOpen && editor.tabs.length > 0)
const terminalWanted = computed(() => terminal.visible && terminal.tabs.length > 0)

watch(editorWanted, (on) => (on ? layout.show('editor') : layout.hide('editor')))
watch(terminalWanted, (on) => (on ? layout.show('terminal') : layout.hide('terminal')))
watch(
  () => layout.visible.editor,
  (on) => {
    if (!on && editor.panelOpen) editor.panelOpen = false
  },
)
watch(
  () => layout.visible.terminal,
  (on) => {
    if (!on && terminal.visible) terminal.visible = false
  },
)

/** After a preset is laid out: it may show an editor or terminal that has nothing to show. */
layout.onApplied(() => {
  if (editorWanted.value) layout.show('editor', { activate: false })
  else layout.hide('editor')
  if (terminalWanted.value) layout.show('terminal', { activate: false })
  else layout.hide('terminal')
})

const sidebarShown = computed(() => layout.visible.chats || layout.visible.files)

/** Ctrl+B: hide or show the Chats and Files panels together (they share a group by default). */
function toggleSidebar() {
  if (sidebarShown.value) {
    layout.hide('chats')
    layout.hide('files')
  } else {
    layout.show('files', { activate: false })
    layout.show('chats', { activate: false })
  }
}

function toggleTerminal() {
  if (ws.root) terminal.toggle(ws.root)
}

function toggleEditor() {
  if (!editor.tabs.length) return
  if (editor.panelOpen && layout.shown.editor) editor.panelOpen = false
  else {
    editor.panelOpen = true
    layout.show('editor') // also brings it to the front if it's a background tab
  }
}

// The chat works in the open folder; switching folders starts a new conversation.
watch(() => ws.root, (root) => chat.setProject(root))

// App shortcuts, from anywhere in the window (Ctrl+S is handled inside the editor):
// Ctrl/Cmd+O open a folder, Ctrl/Cmd+N new chat, Ctrl+B sidebar, Ctrl+Shift+E editor,
// Ctrl+` terminal, Ctrl+Alt+1..9 layout presets.
// The terminal lets these keys through instead of sending them to the shell.
function onKeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey
  const k = e.key.toLowerCase()
  // `code`, not `key`: with Alt held, `key` can be another character on some layouts.
  const digit = /^Digit([1-9])$/.exec(e.code)
  let handled = true
  if (mod && e.altKey && !e.shiftKey && digit) {
    const id = layout.presetForKey(Number(digit[1]))
    if (id) layout.switchTo(id)
  } else if (mod && !e.shiftKey && !e.altKey && k === 'o') openFolder()
  else if (mod && !e.shiftKey && !e.altKey && k === 'n') chat.newChat()
  else if (mod && !e.shiftKey && !e.altKey && k === 'b') toggleSidebar()
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
  // A layout change still waiting to be saved (saving waits for a pause) is written when the window closes.
  window.addEventListener('beforeunload', layout.flush)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', layout.flush)
})

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
      <button class="tk-button toggle" title="Show or hide Chats and Files (Ctrl+B)" :aria-pressed="sidebarShown" @click="toggleSidebar">Sidebar</button>
      <button class="tk-button toggle" title="Show or hide the editor (Ctrl+Shift+E)" :aria-pressed="editorWanted" :disabled="!editor.tabs.length" @click="toggleEditor">Editor</button>
      <button v-if="ws.root" class="tk-button toggle" title="Show or hide the terminal (Ctrl+`)" :aria-pressed="terminalWanted" @click="toggleTerminal">Terminal</button>
      <LayoutMenu />
      <button class="tk-button" :disabled="chat.busy || !chat.messages.length" @click="chat.newChat()">New chat</button>
    </header>

    <main class="main"><DockLayout /></main>

    <StatusBar />

    <!-- Panel content. Each goes into its dock panel, or waits here while that panel isn't in the layout. -->
    <div id="tk-parking" class="parking" aria-hidden="true" />
    <Teleport defer :to="layout.hosts.chats ?? PARKING">
      <ChatList class="pane" @open-elsewhere="openChatIn" />
    </Teleport>
    <Teleport defer :to="layout.hosts.files ?? PARKING">
      <FileTree v-if="ws.root" class="pane" @close-folder="closeFolder" />
      <Welcome v-else class="pane" compact @open="openFolder" />
    </Teleport>
    <Teleport defer :to="layout.hosts.chat ?? PARKING">
      <ChatView class="pane" />
    </Teleport>
    <Teleport defer :to="layout.hosts.editor ?? PARKING">
      <section class="editor-panel" data-testid="editor-panel">
        <EditorTabs @hide="editor.panelOpen = false" />
        <p v-if="editor.lastError" class="error" role="alert">{{ editor.lastError }}</p>
        <EditorPane class="editor" />
      </section>
    </Teleport>
    <Teleport defer :to="layout.hosts.terminal ?? PARKING">
      <TerminalPanel class="pane" />
    </Teleport>
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100%; }
.titlebar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--tk-border); background: var(--tk-surface); }
.project { color: var(--tk-text-muted); }
.project::before { content: '/'; margin-right: 10px; color: var(--tk-border); }
.spacer { flex: 1; }
.toggle[aria-pressed='true'] { border-color: var(--tk-accent); }
.main { flex: 1; min-height: 0; }
.parking { display: none; }
/* Teleported into a PanelHost (a flex column), so these fill the panel. */
.pane { flex: 1; min-height: 0; }
.editor-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.editor { flex: 1; min-height: 0; }
.error { margin: 0; padding: 6px 12px; color: var(--tk-danger); background: var(--tk-danger-bg); font-size: 13px; }
</style>
