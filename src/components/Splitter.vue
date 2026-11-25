<script setup lang="ts">
// A draggable divider that resizes the panel on one side of it. (Full docking arrives
// in Milestone 4; this keeps Milestone 2's fixed three-column layout adjustable.)
const props = defineProps<{ size: number; min: number; max: number; side: 'left' | 'right'; label: string }>()
const emit = defineEmits<{ 'update:size': [number] }>()

function onPointerDown(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const startX = e.clientX
  const startSize = props.size
  const move = (ev: PointerEvent) => {
    const delta = ev.clientX - startX
    const next = startSize + (props.side === 'left' ? delta : -delta)
    emit('update:size', Math.round(Math.min(props.max, Math.max(props.min, next))))
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
  const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
  if (!dir) return
  e.preventDefault()
  const next = props.size + (props.side === 'left' ? dir : -dir) * step
  emit('update:size', Math.min(props.max, Math.max(props.min, next)))
}
</script>

<template>
  <div
    class="splitter"
    role="separator"
    aria-orientation="vertical"
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
.splitter:hover::after, .splitter:focus-visible::after { background: var(--tk-accent); }
</style>
