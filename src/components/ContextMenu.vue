<script setup lang="ts">
// A menu at screen coordinates: the editor's right-click menu, and the menus of panel
// headers and the title bar. Keyboard: arrows move, Enter runs, Escape closes.
// Clicking anywhere else closes it.
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

export interface MenuItem {
  label: string
  /** Shown on the right, e.g. "Ctrl+L". */
  hint?: string
  disabled?: boolean
  /** Draw a divider above this item. */
  separator?: boolean
  run: () => void
}

const props = defineProps<{
  x: number
  y: number
  items: MenuItem[]
  /** A heading above the items. */
  title?: string
  /** The button that opened the menu: pressing it again isn't a press "outside" (its click handler closes). */
  anchor?: HTMLElement | null
}>()
const emit = defineEmits<{ close: [] }>()
const menu = ref<HTMLElement>()
const pos = ref({ left: props.x, top: props.y })
/** Where the keyboard was before the menu took it, to give it back on Escape. */
let focusBefore: HTMLElement | null = null

function choose(item: MenuItem) {
  if (item.disabled) return
  emit('close')
  item.run()
}

function buttons() {
  return [...(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
}

function onKeydown(e: KeyboardEvent) {
  const list = buttons()
  const i = list.indexOf(document.activeElement as HTMLButtonElement)
  if (e.key === 'Escape') {
    emit('close')
    focusBefore?.focus()
  } else if (e.key === 'ArrowDown') list[(i + 1) % list.length]?.focus()
  else if (e.key === 'ArrowUp') list[(i - 1 + list.length) % list.length]?.focus()
  else return
  e.preventDefault()
  e.stopPropagation()
}

// Close on any pointer press outside the menu (capture phase, so it runs first).
function onPointerDown(e: PointerEvent) {
  const target = e.target as Node
  if (!menu.value?.contains(target) && !props.anchor?.contains(target)) emit('close')
}
const onBlur = () => emit('close')

onMounted(async () => {
  focusBefore = document.activeElement as HTMLElement | null
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('blur', onBlur)
  await nextTick()
  // Keep the whole menu on screen.
  const r = menu.value!.getBoundingClientRect()
  pos.value = {
    left: Math.max(4, Math.min(props.x, window.innerWidth - r.width - 4)),
    top: Math.max(4, Math.min(props.y, window.innerHeight - r.height - 4)),
  }
  buttons()[0]?.focus()
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('blur', onBlur)
})
</script>

<template>
  <Teleport to="body">
    <div ref="menu" class="tk-menu context-menu" role="menu" :aria-label="title" :style="{ left: `${pos.left}px`, top: `${pos.top}px` }" @keydown="onKeydown">
      <div v-if="title" class="tk-menu-title">{{ title }}</div>
      <template v-for="(item, i) in items" :key="i">
        <div v-if="item.separator" class="tk-menu-sep" role="separator" />
        <button type="button" class="tk-menu-item" role="menuitem" :disabled="item.disabled" :title="item.label" @click="choose(item)">
          <span class="label">{{ item.label }}</span>
          <kbd v-if="item.hint">{{ item.hint }}</kbd>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu { position: fixed; z-index: 1001; max-width: min(360px, calc(100vw - 8px)); }
.label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
