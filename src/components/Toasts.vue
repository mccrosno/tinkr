<script setup lang="ts">
// Short messages in the bottom-right corner (plugins' api.notifications, load errors).
import { useNotifications } from '../stores/notifications'

const notes = useNotifications()
</script>

<template>
  <div class="toasts" aria-live="polite">
    <div v-for="t in notes.toasts" :key="t.id" :class="['toast', t.level]" role="status" data-testid="toast">
      <div class="body">
        <strong v-if="t.source">{{ t.source }}</strong>
        <span>{{ t.text }}</span>
      </div>
      <button v-if="t.action" class="tk-button" @click="(t.action.run(), notes.dismiss(t.id))">{{ t.action.label }}</button>
      <button class="close" aria-label="Dismiss" @click="notes.dismiss(t.id)">×</button>
    </div>
  </div>
</template>

<style scoped>
.toasts { position: fixed; right: 12px; bottom: 36px; z-index: 900; display: flex; flex-direction: column; gap: 8px; max-width: min(420px, 80vw); }
.toast { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; background: var(--tk-surface); border: 1px solid var(--tk-border); border-left: 3px solid var(--tk-accent); border-radius: var(--tk-radius-sm); box-shadow: var(--tk-shadow); font-size: 13px; }
.toast.warn { border-left-color: var(--tk-warn); }
.toast.error { border-left-color: var(--tk-danger); }
.body { flex: 1; display: flex; flex-direction: column; gap: 2px; overflow-wrap: anywhere; }
.close { border: 0; background: none; color: var(--tk-text-muted); font-size: 15px; line-height: 1; padding: 0 2px; }
.close:hover { color: var(--tk-text); }
</style>
