<script setup lang="ts">
// A code reference shown as a chip ("Ask · src/a.ts:3-7"). Clicking it opens the file;
// in the composer it also has a remove button.
import { refLabel, type CodeRef } from '../chat/refs'
import { useEditor } from '../stores/editor'

const props = defineProps<{ refData: CodeRef; removable?: boolean }>()
defineEmits<{ remove: [] }>()
const editor = useEditor()

const purposeLabel = () => (props.refData.purpose === 'change' ? 'Change' : 'Ask')
</script>

<template>
  <span class="chip" :class="refData.purpose" :title="refData.text">
    <span class="purpose">{{ purposeLabel() }}</span>
    <button type="button" class="label" @click="editor.open(refData.path)">{{ refLabel(refData) }}</button>
    <button v-if="removable" type="button" class="remove" :aria-label="`Remove ${refLabel(refData)}`" @click="$emit('remove')">×</button>
  </span>
</template>

<style scoped>
.chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 1px 4px 1px 6px; border: 1px solid var(--tk-border); border-radius: var(--tk-radius-sm); background: var(--tk-surface-2); font-size: 12px; }
.purpose { color: var(--tk-text-muted); }
.chip.change .purpose { color: var(--tk-accent); }
.label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 0; padding: 0; background: none; font-family: var(--tk-font-mono); font-size: 11.5px; }
.label:hover { text-decoration: underline; }
.remove { border: 0; padding: 0 3px; background: none; color: var(--tk-text-muted); font-size: 14px; line-height: 1; }
.remove:hover { color: var(--tk-text); }
</style>
