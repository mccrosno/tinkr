<script setup lang="ts">
// A popup at screen coordinates, kept inside the window: the box behind Tinkr's menus
// and lists. Closes on Escape (giving the keyboard back), a press outside it, or the
// window losing focus. Up and down arrows move between its buttons.
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    x: number
    y: number
    label?: string
    role?: 'menu' | 'dialog'
    /** The button that opened it: pressing that isn't a press "outside" (its click handler closes). */
    anchor?: HTMLElement | null
  }>(),
  { label: undefined, role: 'menu', anchor: null },
)
const emit = defineEmits<{ close: [] }>()
const box = ref<HTMLElement>()
const pos = ref({ left: props.x, top: props.y })
/** Where the keyboard was before the popup took it. */
let focusBefore: HTMLElement | null = null
let resize: ResizeObserver | null = null

/** Move it back inside the window if it doesn't fit where it was asked for. */
function place() {
  const r = box.value?.getBoundingClientRect()
  if (!r) return
  pos.value = {
    left: Math.max(4, Math.min(props.x, window.innerWidth - r.width - 4)),
    top: Math.max(4, Math.min(props.y, window.innerHeight - r.height - 4)),
  }
}
watch(() => [props.x, props.y], place)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
    focusBefore?.focus()
  } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && document.activeElement instanceof HTMLButtonElement) {
    const list = [...box.value!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    const i = list.indexOf(document.activeElement)
    list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus()
  } else return
  e.preventDefault()
  e.stopPropagation()
}

// Close on any pointer press outside (capture phase, so it runs first).
function onPointerDown(e: PointerEvent) {
  const target = e.target as Node
  if (!box.value?.contains(target) && !props.anchor?.contains(target)) emit('close')
}
const onBlur = () => emit('close')

onMounted(async () => {
  focusBefore = document.activeElement as HTMLElement | null
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('blur', onBlur)
  await nextTick()
  if (!box.value) return
  place()
  // Its content can grow (a log being shown), so it may need to move again.
  resize = new ResizeObserver(place)
  resize.observe(box.value)
  box.value.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('blur', onBlur)
  resize?.disconnect()
})
</script>

<template>
  <Teleport to="body">
    <div ref="box" class="tk-menu popup" :role="role" :aria-label="label" :style="{ left: `${pos.left}px`, top: `${pos.top}px` }" @keydown="onKeydown">
      <slot />
    </div>
  </Teleport>
</template>

<style scoped>
.popup { position: fixed; z-index: 1001; max-width: calc(100vw - 8px); max-height: calc(100vh - 8px); overflow: auto; }
</style>
