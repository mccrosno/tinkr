<script setup lang="ts">
import { useEditor } from '../stores/editor'
import { useWorkspace } from '../stores/workspace'
import type { DirEntry } from '../workspace/fs'

const ws = useWorkspace()
const emit = defineEmits<{ 'close-folder': [] }>()
const editor = useEditor()

function activate(entry: DirEntry) {
  if (entry.isDir) ws.toggle(entry.path)
  else editor.open(entry.path)
}
</script>

<template>
  <nav class="tree" aria-label="Files">
    <div class="header">
      <span class="title" :title="ws.root ?? ''">{{ ws.name }}</span>
      <button class="icon" title="Close folder" aria-label="Close folder" @click="emit('close-folder')">×</button>
    </div>
    <p v-if="ws.error" class="error">{{ ws.error }}</p>
    <ul role="tree">
      <li
        v-for="row in ws.rows"
        :key="row.entry.path"
        role="treeitem"
        :aria-expanded="row.entry.isDir ? row.expanded : undefined"
        :aria-selected="row.entry.path === editor.activePath"
        :class="{ dir: row.entry.isDir, active: row.entry.path === editor.activePath }"
        :style="{ paddingLeft: `${10 + row.depth * 14}px` }"
        :title="row.entry.path"
        :data-path="row.entry.path"
        tabindex="0"
        @click="activate(row.entry)"
        @keydown.enter.prevent="activate(row.entry)"
      >
        <span class="chevron" aria-hidden="true">{{ row.entry.isDir ? (row.expanded ? '▾' : '▸') : '' }}</span>
        <span class="label">{{ row.entry.name }}</span>
      </li>
    </ul>
    <p v-if="ws.root && !ws.rows.length && !ws.error" class="empty">This folder is empty.</p>
  </nav>
</template>

<style scoped>
.tree { height: 100%; display: flex; flex-direction: column; font-size: 13px; min-width: 0; }
.header { display: flex; align-items: center; padding: 6px 8px 6px 12px; border-bottom: 1px solid var(--tk-border); }
.title { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icon { background: none; border: 0; color: var(--tk-text-muted); font-size: 16px; line-height: 1; padding: 0 4px; border-radius: 4px; }
.icon:hover { color: var(--tk-text); background: var(--tk-surface-2); }
ul { list-style: none; margin: 0; padding: 4px 0; overflow: auto; flex: 1; }
li { display: flex; align-items: center; gap: 4px; padding: 2px 8px; cursor: pointer; white-space: nowrap; color: var(--tk-text); }
li:hover { background: var(--tk-surface-2); }
li.active { background: var(--tk-selection); }
li:focus-visible { outline-offset: -2px; }
.chevron { width: 12px; color: var(--tk-text-muted); flex: none; }
.label { overflow: hidden; text-overflow: ellipsis; }
.error, .empty { padding: 8px 12px; color: var(--tk-text-muted); margin: 0; }
.error { color: var(--tk-danger); }
</style>
