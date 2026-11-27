<script setup lang="ts">
// The Editor panel: open files as tabs, and the editor itself (with Claude's changes
// shown as diffs for review).
import { useEditor } from '../stores/editor'
import EditorPane from './EditorPane.vue'
import EditorTabs from './EditorTabs.vue'

const editor = useEditor()
</script>

<template>
  <section class="editor-panel" data-testid="editor-panel">
    <EditorTabs @hide="editor.panelOpen = false" />
    <p v-if="editor.lastError" class="error" role="alert">{{ editor.lastError }}</p>
    <EditorPane class="editor" />
  </section>
</template>

<style scoped>
.editor-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.editor { flex: 1; min-height: 0; }
.error { margin: 0; padding: 6px 12px; color: var(--tk-danger); background: var(--tk-danger-bg); font-size: 13px; }
</style>
