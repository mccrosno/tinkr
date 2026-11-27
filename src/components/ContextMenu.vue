<script setup lang="ts">
// A list of actions at screen coordinates: the editor's right-click menu, and the menus
// of panel headers and the title bar. Opening, closing and keys are PopupBox's.
import PopupBox from './PopupBox.vue'

export interface MenuItem {
  label: string
  /** Tooltip, if the label alone isn't enough (e.g. a folder's full path). */
  title?: string
  /** Shown on the right, e.g. "Ctrl+L". */
  hint?: string
  disabled?: boolean
  /** Draw a divider above this item. */
  separator?: boolean
  run: () => void
}

defineProps<{
  x: number
  y: number
  items: MenuItem[]
  /** A heading above the items. */
  title?: string
  /** The button that opened the menu. */
  anchor?: HTMLElement | null
}>()
const emit = defineEmits<{ close: [] }>()

function choose(item: MenuItem) {
  if (item.disabled) return
  emit('close')
  item.run()
}
</script>

<template>
  <PopupBox class="context-menu" :x="x" :y="y" :label="title" :anchor="anchor" @close="emit('close')">
    <div v-if="title" class="tk-menu-title">{{ title }}</div>
    <template v-for="(item, i) in items" :key="i">
      <div v-if="item.separator" class="tk-menu-sep" role="separator" />
      <button type="button" class="tk-menu-item" role="menuitem" :disabled="item.disabled" :title="item.title ?? item.label" @click="choose(item)">
        <span class="label">{{ item.label }}</span>
        <kbd v-if="item.hint">{{ item.hint }}</kbd>
      </button>
    </template>
  </PopupBox>
</template>

<style scoped>
.label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 320px; }
</style>
