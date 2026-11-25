<script setup lang="ts">
// A draggable divider that resizes the panel on one side of it. (Full docking arrives
// in Milestone 4; this keeps the fixed layout adjustable.)
//
// `side` says where the resized panel is relative to the divider: 'left'/'right' make a
// vertical divider that changes a width; 'bottom' makes a horizontal one that changes
// the height of the panel below it.
import { computed } from 'vue'

const props = defineProps<{ size: number; min: number; max: number; side: 'left' | 'right' | 'bottom'; label: string }>()
const emit = defineEmits<{ 'update:size': [number] }>()

const horizontal = computed(() => props.side === 'bottom')
/** +1 when moving the pointer right/down grows the panel, -1 when it shrinks it. */
const growDir = computed(() => (props.side === 'left' ? 1 : -1))

const clamp = (n: number) => Math.round(Math.min(props.max, Math.max(props.min, n)))

function onPointerDown(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const start = horizontal.value ? e.clientY : e.clientX
  const startSize = props.size
  const move = (ev: PointerEvent) => {
    const delta = (horizontal.value ? ev.clientY : ev.clientX) - start
    emit('update:size', clamp(startSize + growDir.value * delta))
  }
  const up = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}

function onKeydown(e: KeyboardEvent) {
  const step = e.shiftKey ? 50 : 10
  const keys: Record<string, number> = horizontal.value ? { ArrowUp: -1, ArrowDown: 1 } : { ArrowLeft: -1, ArrowRight: 1 }
  const dir = keys[e.key] ?? 0
  if (!dir) return
  e.preventDefault()
  emit('update:size', clamp(props.size + growDir.value * dir * step))
}
</script>

<template>
  <div
    class="splitter"
    :class="{ horizontal }"
    role="separator"
    :aria-orientation="horizontal ? 'horizontal' : 'vertical'"
    :aria-label="label"
    :aria-valuenow="size"
    :aria-valuemin="min"
    :aria-valuemax="max"
    tabindex="0"
    @pointerdown.prevent="onPointerDown"
    @keydown="onKeydown"
  />
</template>

<style scoped>
.splitter { width: 5px; margin: 0 -2px; z-index: 1; cursor: col-resize; flex: none; position: relative; }
.splitter::after { content: ''; position: absolute; inset: 0 2px; background: var(--tk-border); }
.splitter.horizontal { width: auto; height: 5px; margin: -2px 0; cursor: row-resize; }
.splitter.horizontal::after { inset: 2px 0; }
.splitter:hover::after, .splitter:focus-visible::after { background: var(--tk-accent); }
</style>
