<script setup lang="ts">
// The inside of one dock panel. Dockview creates and destroys these as panels are
// added, dragged between groups or the layout changes. The panel's content is a
// separate, persistent element (created once by the plugin registry and filled by the
// panel's `mount`), which is moved in here, and moved back to the hidden "parking" box
// when this host goes away. So content is never rebuilt by the dock: a chat draft, a
// shell's screen or the editor's undo history survive any layout change.
import { onBeforeUnmount, ref, watchEffect } from 'vue'
import { usePlugins } from '../stores/plugins'

const props = defineProps<{ panel: string }>()
const plugins = usePlugins()
const box = ref<HTMLElement>()
let shown: HTMLElement | null = null

/** Where content waits while its panel isn't in the layout (App.vue renders it). */
const parking = () => document.getElementById('tk-parking')

// Runs again when the panel is registered later (a plugin still loading) or re-registered (hot reload).
watchEffect(() => {
  const el = plugins.panels.get(props.panel)?.el ?? null
  if (!box.value || el === shown) return
  if (shown && shown.parentElement === box.value) parking()?.append(shown)
  shown = el
  if (el) box.value.append(el)
})

onBeforeUnmount(() => {
  if (shown && shown.parentElement === box.value) parking()?.append(shown)
  shown = null
})
</script>

<template>
  <div ref="box" class="panel-host" :data-panel="panel">
    <p v-if="!plugins.panels.has(panel)" class="missing">Loading…</p>
  </div>
</template>

<style scoped>
.panel-host { height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--tk-bg); }
.missing { margin: 0; padding: 12px; color: var(--tk-text-muted); font-size: 13px; }
</style>
