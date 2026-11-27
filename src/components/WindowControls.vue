<script setup lang="ts">
// Minimize, maximize/restore and close. The window has no native title bar (Windows and
// Linux), so the title bar draws these. Each needs a permission in
// src-tauri/capabilities/default.json.
import { getCurrentWindow } from '@tauri-apps/api/window'
import { onBeforeUnmount, onMounted, ref } from 'vue'

const win = getCurrentWindow()
const maximized = ref(false)
let unlisten: (() => void) | null = null
let gone = false

async function check() {
  maximized.value = await win.isMaximized()
}

onMounted(async () => {
  await check()
  // Maximizing by double-click or a keyboard shortcut also resizes the window.
  const stop = await win.onResized(check)
  if (gone) stop()
  else unlisten = stop
})
onBeforeUnmount(() => {
  gone = true
  unlisten?.()
})
</script>

<template>
  <div class="window-controls">
    <button type="button" aria-label="Minimize" title="Minimize" data-window="minimize" @click="win.minimize()">
      <svg viewBox="0 0 11 11" aria-hidden="true"><path d="M1 5.5h9" /></svg>
    </button>
    <button type="button" :aria-label="maximized ? 'Restore' : 'Maximize'" :title="maximized ? 'Restore' : 'Maximize'" data-window="maximize" @click="win.toggleMaximize()">
      <svg viewBox="0 0 11 11" aria-hidden="true">
        <path v-if="maximized" d="M1.5 3.5h6v6h-6zM3.5 3.5v-2h6v6h-2" />
        <path v-else d="M1.5 1.5h8v8h-8z" />
      </svg>
    </button>
    <button type="button" class="close" aria-label="Close" title="Close" data-window="close" @click="win.close()">
      <svg viewBox="0 0 11 11" aria-hidden="true"><path d="m1.5 1.5 8 8m0-8-8 8" /></svg>
    </button>
  </div>
</template>

<style scoped>
.window-controls { display: flex; align-self: stretch; }
button { display: flex; align-items: center; justify-content: center; width: 44px; padding: 0; border: 0; border-radius: 0; background: none; color: var(--tk-text); }
button:hover { background: var(--tk-surface-2); }
.close:hover { background: var(--tk-danger); color: var(--tk-on-accent); }
svg { width: 11px; height: 11px; fill: none; stroke: currentColor; stroke-width: 1; }
</style>
