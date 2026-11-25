<script setup lang="ts">
// One CodeMirror view, many documents: each tab has its own EditorState (keeping its
// undo history, cursor and scroll), swapped in when the tab becomes active.
//
// Files Claude changed show an inline diff against their review baseline
// (@codemirror/merge), with Accept/Reject on each changed chunk. Selected code can be
// sent to the chat with "Ask Claude" / "Request changes" (popup, shortcuts, right-click).
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { getOriginalDoc, goToNextChunk, unifiedMergeView, updateOriginalDoc } from '@codemirror/merge'
import { askClaude, selectionRef } from '../editor/askClaude'
import { loadLanguage } from '../editor/languages'
import { tinkrTheme } from '../editor/theme'
import type { RefPurpose } from '../chat/refs'
import { useChat } from '../stores/chat'
import { useEditor, type Tab } from '../stores/editor'
import { useReview } from '../stores/review'
import { useWorkspace } from '../stores/workspace'
import { relativeTo } from '../workspace/fs'
import ContextMenu, { type MenuItem } from './ContextMenu.vue'

const editor = useEditor()
const review = useReview()
const chat = useChat()
const ws = useWorkspace()
const host = ref<HTMLElement>()
let view: EditorView | null = null
let shownPath: string | null = null
const states = new Map<string, { state: EditorState; revision: number }>()
const language = new Compartment()
/** Holds the diff view for a file under review (empty otherwise). */
const reviewDiff = new Compartment()
/** The baseline each document's diff currently compares against (absent = no diff). */
const shownBaselines = new Map<string, string | null>()
const menu = ref<{ x: number; y: number } | null>(null)

/** The diff extension for a baseline. A created file (null) compares against empty text. */
function diffFor(baseline: string | null | undefined): Extension {
  if (baseline === undefined) return []
  return unifiedMergeView({ original: baseline ?? '', mergeControls: true, gutter: true, syntaxHighlightDeletions: true })
}

/** Send the selection (or the cursor's line) to the chat composer. */
function ask(purpose: RefPurpose) {
  if (!view || !shownPath) return
  chat.addRef(selectionRef(view.state, shownPath, relativeTo(ws.root, shownPath), purpose))
}

// Plain (non-reactive) list so the update listener can't trigger Vue work per keystroke.
function extensionsFor(path: string): Extension[] {
  const underReview = review.find(path)
  if (underReview) shownBaselines.set(path, underReview.baseline)
  return [
    basicSetup,
    keymap.of([
      indentWithTab,
      { key: 'Mod-s', preventDefault: true, run: () => (editor.save(path), true) },
    ]),
    language.of([]),
    reviewDiff.of(diffFor(underReview ? underReview.baseline : undefined)),
    tinkrTheme,
    askClaude({ ask, contextMenu: (x, y) => (menu.value = { x, y }) }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) editor.updateText(path, u.state.doc.toString())
      for (const tr of u.transactions) {
        // "Accept" on a chunk moves the diff's baseline forward: tell the review store.
        if (tr.effects.some((e) => e.is(updateOriginalDoc))) {
          const accepted = getOriginalDoc(u.state).toString()
          shownBaselines.set(path, accepted) // so the store update below doesn't reset the diff
          review.setBaseline(path, accepted)
        }
        // "Reject" on a chunk puts the old text back in the document. That's a review
        // decision, not a draft, so save it to disk right away.
        if (tr.isUserEvent('revert')) queueMicrotask(() => editor.save(path))
      }
    }),
  ]
}

function createState(tab: Tab) {
  const state = EditorState.create({ doc: tab.text, extensions: extensionsFor(tab.path) })
  states.set(tab.path, { state, revision: tab.revision })
  // Load the grammar in the background, then switch it on for this document.
  loadLanguage(tab.name).then((lang) => {
    if (!lang) return
    reconfigure(tab.path, language.reconfigure(lang))
  })
  return state
}

/** Apply an effect to a document, whether it's on screen or stored away. */
function reconfigure(path: string, effect: ReturnType<Compartment['reconfigure']>) {
  if (shownPath === path && view) view.dispatch({ effects: effect })
  else {
    const entry = states.get(path)
    if (entry) entry.state = entry.state.update({ effects: effect }).state
  }
}

function show(tab: Tab | null) {
  if (!view) return
  // Remember the outgoing document's state (undo history, selection).
  if (shownPath && states.has(shownPath)) states.get(shownPath)!.state = view.state
  menu.value = null
  if (!tab || tab.unsupported) {
    shownPath = null
    return
  }
  const entry = states.get(tab.path)
  view.setState(entry ? entry.state : createState(tab))
  shownPath = tab.path
  // Take the keyboard focus, unless the user is typing somewhere else (the chat box or
  // a terminal) and the file opened because Claude changed it.
  const typingElsewhere = document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement
  if (!typingElsewhere || host.value?.contains(document.activeElement)) view.focus()
}

onMounted(() => {
  view = new EditorView({ parent: host.value! })
  show(editor.active)
})
onBeforeUnmount(() => view?.destroy())

watch(() => editor.active, (tab) => show(tab))

// Reloads from disk bump `revision`: replace the document (as one undoable change).
watch(
  () => editor.tabs.map((t) => `${t.path}:${t.revision}`).join('|'),
  () => {
    for (const tab of editor.tabs) {
      const entry = states.get(tab.path)
      if (!entry || entry.revision === tab.revision) continue
      entry.revision = tab.revision
      const current = shownPath === tab.path && view ? view.state : entry.state
      const tr = current.update({ changes: { from: 0, to: current.doc.length, insert: tab.text } })
      if (shownPath === tab.path && view) view.dispatch(tr)
      else entry.state = tr.state
    }
  },
)

// Files entering or leaving review, or a baseline changing (Accept all, a later edit):
// turn each open document's diff on, off, or point it at the new baseline.
watch(
  () => review.files.map((f) => [f.path, f.baseline] as const),
  () => {
    for (const path of states.keys()) {
      const f = review.find(path)
      const want = f ? f.baseline : undefined
      const has = shownBaselines.has(path) ? shownBaselines.get(path) : undefined
      if (want === has) continue
      if (want === undefined) shownBaselines.delete(path)
      else shownBaselines.set(path, want)
      reconfigure(path, reviewDiff.reconfigure(diffFor(want)))
    }
  },
)

// When Claude changes the file on screen, jump to its first change.
const stopFollowing = review.onChanged((path) => {
  if (view && shownPath && path === shownPath) requestAnimationFrame(() => view && goToNextChunk(view))
})
onBeforeUnmount(stopFollowing)

// Forget states of closed tabs.
watch(
  () => editor.tabs.map((t) => t.path),
  (paths) => {
    for (const p of [...states.keys()]) {
      if (!paths.includes(p)) {
        states.delete(p)
        shownBaselines.delete(p)
      }
    }
  },
)

// Right-click menu: Claude actions first, then the usual clipboard actions.
async function clipboard(action: 'cut' | 'copy' | 'paste') {
  if (!view) return
  const sel = view.state.selection.main
  try {
    if (action === 'paste') {
      const text = await navigator.clipboard.readText()
      view.dispatch(view.state.replaceSelection(text), { userEvent: 'input.paste' })
    } else {
      await navigator.clipboard.writeText(view.state.sliceDoc(sel.from, sel.to))
      if (action === 'cut') view.dispatch({ changes: { from: sel.from, to: sel.to }, userEvent: 'delete.cut' })
    }
  } catch (e) {
    editor.lastError = `Clipboard ${action} failed: ${e}`
  }
  view.focus()
}

function menuItems(): MenuItem[] {
  const empty = view?.state.selection.main.empty ?? true
  return [
    { label: empty ? 'Ask Claude about this line' : 'Ask Claude', hint: 'Ctrl+L', run: () => ask('question') },
    { label: 'Request changes', hint: 'Ctrl+Shift+L', run: () => ask('change') },
    { label: 'Cut', hint: 'Ctrl+X', disabled: empty, separator: true, run: () => clipboard('cut') },
    { label: 'Copy', hint: 'Ctrl+C', disabled: empty, run: () => clipboard('copy') },
    { label: 'Paste', hint: 'Ctrl+V', run: () => clipboard('paste') },
  ]
}

function closeMenu() {
  menu.value = null
  view?.focus()
}
</script>

<template>
  <div class="pane">
    <div v-if="editor.active?.conflict" class="banner" role="alert">
      <span><strong>{{ editor.active.name }}</strong> changed on disk, and you have unsaved edits here.</span>
      <button class="tk-button" @click="editor.reloadFromDisk(editor.active.path)">Use disk version</button>
      <button class="tk-button" @click="editor.keepMine(editor.active.path)">Keep mine</button>
    </div>
    <div v-if="editor.active && review.find(editor.active.path)" class="review-bar" data-testid="file-review">
      <span>Claude changed this file.</span>
      <button class="tk-button" @click="review.accept(editor.active.path)">Accept all</button>
      <button class="tk-button" @click="review.reject(editor.active.path)">Reject all</button>
    </div>
    <div v-if="editor.active?.unsupported" class="notice">{{ editor.active.unsupported }}</div>
    <div v-show="editor.active && !editor.active.unsupported" ref="host" class="cm-host" :class="{ 'menu-open': menu }" data-testid="editor" />
    <ContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menuItems()" @close="closeMenu" />
  </div>
</template>

<style scoped>
.pane { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.cm-host { flex: 1; min-height: 0; }
/* The right-click menu already offers the selection actions; hide the popup under it. */
.cm-host.menu-open :deep(.cm-tooltip:has(> .cm-ask-claude)) { display: none; }
.banner, .review-bar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: var(--tk-surface-2); font-size: 13px; }
.banner { border-bottom: 1px solid var(--tk-warn); }
.review-bar { border-bottom: 1px solid var(--tk-border); }
.banner span, .review-bar span { flex: 1; }
.review-bar .tk-button { padding: 1px 10px; font-size: 12.5px; }
.notice { margin: 40px auto; color: var(--tk-text-muted); }
</style>
