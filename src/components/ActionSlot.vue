<script setup lang="ts">
// The buttons registered for one slot (titlebar, statusbar, chat-toolbar), in order.
// Their `isActive` / `isEnabled` / `isVisible` are read on every redraw, so buttons
// follow Tinkr's state (they read reactive stores).
import type { ActionSlot } from '../plugins/api'
import { usePlugins, type ActionEntry } from '../stores/plugins'

const props = defineProps<{ slotName: ActionSlot; small?: boolean }>()
const plugins = usePlugins()

/** A plugin's broken `isVisible` etc. must not break the bar: treat a throw as the default. */
function check(a: ActionEntry, fn: 'isActive' | 'isEnabled' | 'isVisible', fallback: boolean) {
  try {
    return a.def[fn] ? !!a.def[fn]!() : fallback
  } catch {
    return fallback
  }
}

async function run(a: ActionEntry) {
  try {
    await a.def.run()
  } catch (e) {
    plugins.addLog(a.plugin, 'error', `action "${a.key}" failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  }
}
</script>

<template>
  <template v-for="a in plugins.actionsIn(props.slotName)" :key="a.key">
    <button
      v-if="check(a, 'isVisible', true)"
      :class="['action', small ? 'small' : 'tk-button', { toggle: !!a.def.isActive }]"
      :title="a.def.tooltip ?? a.def.title"
      :aria-pressed="a.def.isActive ? check(a, 'isActive', false) : undefined"
      :disabled="!check(a, 'isEnabled', true)"
      :data-action="a.key"
      @click="run(a)"
    >
      {{ a.def.title }}
    </button>
  </template>
</template>

<style scoped>
.toggle[aria-pressed='true'] { border-color: var(--tk-accent); }
/* Statusbar-sized: text buttons, like the status bar's own. */
.small { border: 0; background: none; padding: 0 4px; color: var(--tk-text-muted); font-size: 12px; }
.small:hover:not(:disabled) { color: var(--tk-text); }
.small[aria-pressed='true'] { color: var(--tk-danger); }
</style>
