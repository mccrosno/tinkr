<script setup lang="ts">
// One CodeMirror view, many documents: each tab has its own EditorState (keeping its
// undo history, cursor and scroll), swapped in when the tab becomes active.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { loadLanguage } from '../editor/languages'
import { tinkrTheme } from '../editor/theme'
import { useEditor, type Tab } from '../stores/editor'

const editor = useEditor()
const host = ref<HTMLElement>()
let view: EditorView | null = null
let shownPath: string | null = null
const states = new Map<string, { state: EditorState; revision: number }>()
const language = new Compartment()

// Plain (non-reactive) list so the update listener can't trigger Vue work per keystroke.
function extensionsFor(path: string): Extension[] {
  return [
    basicSetup,
    keymap.of([
      indentWithTab,
      { key: 'Mod-s', preventDefault: true, run: () => (editor.save(path), true) },
    ]),
    language.of([]),
    tinkrTheme,
    EditorView.updateListener.of((u) => {
      if (u.docChanged) editor.updateText(path, u.state.doc.toString())
    }),
  ]
}

function createState(tab: Tab) {
  const state = EditorState.create({ doc: tab.text, extensions: extensionsFor(tab.path) })
  states.set(tab.path, { state, revision: tab.revision })
  // Load the grammar in the background, then switch it on for this document.
  loadLanguage(tab.name).then((lang) => {
    if (!lang) return
    const effect = language.reconfigure(lang)
    if (shownPath === tab.path && view) view.dispatch({ effects: effect })
    else {
      const entry = states.get(tab.path)
      if (entry) entry.state = entry.state.update({ effects: effect }).state
    }
  })
  return state
}

function show(tab: Tab | null) {
  if (!view) return
  // Remember the outgoing document's state (undo history, selection).
  if (shownPath && states.has(shownPath)) states.get(shownPath)!.state = view.state
  if (!tab || tab.unsupported) {
    shownPath = null
    return
  }
  const entry = states.get(tab.path)
  view.setState(entry ? entry.state : createState(tab))
  shownPath = tab.path
  view.focus()
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

// Forget states of closed tabs.
watch(
  () => editor.tabs.map((t) => t.path),
  (paths) => {
    for (const p of [...states.keys()]) if (!paths.includes(p)) states.delete(p)
  },
)
</script>

<template>
  <div class="pane">
    <div v-if="editor.active?.conflict" class="banner" role="alert">
      <span><strong>{{ editor.active.name }}</strong> changed on disk, and you have unsaved edits here.</span>
      <button class="tk-button" @click="editor.reloadFromDisk(editor.active.path)">Use disk version</button>
      <button class="tk-button" @click="editor.keepMine(editor.active.path)">Keep mine</button>
    </div>
    <div v-if="editor.active?.unsupported" class="notice">{{ editor.active.unsupported }}</div>
    <div v-show="editor.active && !editor.active.unsupported" ref="host" class="cm-host" data-testid="editor" />
  </div>
</template>

<style scoped>
.pane { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.cm-host { flex: 1; min-height: 0; }
.banner { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: var(--tk-surface-2); border-bottom: 1px solid var(--tk-warn); font-size: 13px; }
.banner span { flex: 1; }
.notice { margin: 40px auto; color: var(--tk-text-muted); }
</style>
