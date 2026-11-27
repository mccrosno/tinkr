<script setup lang="ts">
// The line under the newest message while Claude's turn runs: moving dots, what it's
// doing, and how long the turn has taken, so a quiet stretch between steps doesn't look
// like a stall. Mounted for exactly one turn (see ChatView), so it times itself.
import { computed, onBeforeUnmount, ref } from 'vue'
import type { Activity } from '../stores/chat'

defineProps<{ activity: Activity }>()

const started = Date.now()
const now = ref(started)
const timer = setInterval(() => (now.value = Date.now()), 1000)
onBeforeUnmount(() => clearInterval(timer))

/** "8 s", "1 m 05 s"; nothing for the first few seconds, when it would only be noise. */
const elapsed = computed(() => {
  const s = Math.floor((now.value - started) / 1000)
  if (s < 3) return ''
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} m ${String(s % 60).padStart(2, '0')} s`
})
</script>

<template>
  <div class="working" :class="{ waiting: activity.waiting }" data-testid="working">
    <span class="dots" aria-hidden="true"><i /><i /><i /></span>
    <!-- Only the label is announced; a ticking time would be read out every second. -->
    <span role="status">{{ activity.label }}</span>
    <span v-if="elapsed" class="elapsed" aria-hidden="true">{{ elapsed }}</span>
  </div>
</template>

<style scoped>
.working { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--tk-text-muted); }
.dots { display: inline-flex; gap: 4px; }
.dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--tk-accent); animation: bounce 1.2s ease-in-out infinite; }
.dots i:nth-child(2) { animation-delay: 0.15s; }
.dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes bounce {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}
/* Waiting on the user: Claude isn't working, so nothing moves. */
.waiting .dots i { animation: none; opacity: 0.6; background: var(--tk-warn); }
.elapsed { font-variant-numeric: tabular-nums; opacity: 0.75; }
@media (prefers-reduced-motion: reduce) {
  .dots i { animation: none; opacity: 0.8; }
}
</style>
