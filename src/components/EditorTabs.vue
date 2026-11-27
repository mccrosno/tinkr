<script setup lang="ts">
import { ask } from '@tauri-apps/plugin-dialog'
import { useEditor } from '../stores/editor'

const editor = useEditor()
defineEmits<{ hide: [] }>()

async function close(path: string) {
  if (editor.close(path)) return
  const tab = editor.tabs.find((t) => t.path === path)
  const discard = await ask(`${tab?.name ?? 'This file'} has unsaved changes. Close it anyway?`, {
    title: 'Unsaved changes',
    kind: 'warning',
    okLabel: 'Discard changes',
    cancelLabel: 'Cancel',
  })
  if (discard) editor.close(path, true)
}
</script>

<template>
  <div class="tabs" role="tablist">
    <div
      v-for="t in editor.tabs"
      :key="t.path"
      class="tab"
      role="tab"
      :aria-selected="t.path === editor.activePath"
      :title="t.path"
      :data-path="t.path"
      @click="editor.activePath = t.path"
      @auxclick.middle="close(t.path)"
    >
      <span class="name">{{ t.name }}</span>
      <span v-if="editor.isDirty(t)" class="dirty" aria-label="unsaved changes">●</span>
      <button class="close" :aria-label="`Close ${t.name}`" @click.stop="close(t.path)">×</button>
    </div>
    <span class="fill" />
    <button class="hide" title="Hide the editor (Ctrl+Shift+E)" aria-label="Hide the editor" @click="$emit('hide')">⟩</button>
  </div>
</template>

<style scoped>
.tabs { display: flex; overflow-x: auto; border-bottom: 1px solid var(--tk-border); min-height: 34px; }
.tab { display: flex; align-items: center; gap: 6px; padding: 0 6px 0 12px; border-right: 1px solid var(--tk-border); cursor: pointer; color: var(--tk-text-muted); white-space: nowrap; font-size: 13px; }
.tab[aria-selected='true'] { background: var(--tk-surface-2); color: var(--tk-text); box-shadow: inset 0 2px 0 var(--tk-accent); }
.dirty { color: var(--tk-accent); font-size: 10px; }
.close { background: none; border: 0; padding: 0 4px; color: var(--tk-text-muted); font-size: 16px; line-height: 1; border-radius: 4px; }
.close:hover { background: var(--tk-surface-2); color: var(--tk-text); }
.fill { flex: 1; }
.hide { position: sticky; right: 0; flex: none; padding: 0 10px; border: 0; border-left: 1px solid var(--tk-border); background: var(--tk-bg); color: var(--tk-text-muted); font-size: 15px; }
.hide:hover { color: var(--tk-text); }
</style>
