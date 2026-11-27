<script setup lang="ts">
// A right-click menu at screen coordinates. Keyboard: arrows move, Enter runs,
// Escape closes. Clicking anywhere else closes it.
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

const props = defineProps<{ x: number; y: number; items: MenuItem[] }>()
const emit = defineEmits<{ close: [] }>()
const menu = ref<HTMLElement>()
const pos = ref({ left: props.x, top: props.y })

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
  if (e.key === 'Escape') emit('close')
  else if (e.key === 'ArrowDown') list[(i + 1) % list.length]?.focus()
  else if (e.key === 'ArrowUp') list[(i - 1 + list.length) % list.length]?.focus()
  else return
  e.preventDefault()
}

// Close on any pointer press outside the menu (capture phase, so it runs first).
function onPointerDown(e: PointerEvent) {
  if (!menu.value?.contains(e.target as Node)) emit('close')
}

onMounted(async () => {
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('blur', () => emit('close'), { once: true })
  await nextTick()
  // Keep the whole menu on screen.
  const r = menu.value!.getBoundingClientRect()
  pos.value = {
    left: Math.max(4, Math.min(props.x, window.innerWidth - r.width - 4)),
    top: Math.max(4, Math.min(props.y, window.innerHeight - r.height - 4)),
  }
  buttons()[0]?.focus()
})
onBeforeUnmount(() => window.removeEventListener('pointerdown', onPointerDown, true))
</script>

<template>
  <Teleport to="body">
    <div ref="menu" class="menu" role="menu" :style="{ left: `${pos.left}px`, top: `${pos.top}px` }" @keydown="onKeydown">
      <template v-for="item in items" :key="item.label">
        <div v-if="item.separator" class="sep" role="separator" />
        <button type="button" role="menuitem" :disabled="item.disabled" @click="choose(item)">
          <span>{{ item.label }}</span>
          <kbd v-if="item.hint">{{ item.hint }}</kbd>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.menu { position: fixed; z-index: 100; min-width: 200px; padding: 4px; background: var(--tk-popup); border: 1px solid var(--tk-border); border-radius: var(--tk-radius-sm); box-shadow: var(--tk-shadow); font-size: 13px; }
button { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 24px; padding: 4px 10px; border: 0; border-radius: var(--tk-radius-sm); background: none; text-align: left; }
button:hover:not(:disabled), button:focus-visible { background: var(--tk-surface-2); outline: none; }
kbd { color: var(--tk-text-muted); font-size: 11.5px; }
.sep { height: 1px; margin: 4px 6px; background: var(--tk-border); }
</style>
