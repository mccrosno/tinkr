<script setup lang="ts">
// The buttons registered for one slot (titlebar, statusbar, chat-toolbar), in order, as
// icon buttons. Their `isActive` / `isEnabled` / `isVisible` are read on every redraw,
// so buttons follow Tinkr's state (they read reactive stores).
import type { ActionSlot } from '../plugins/api'
import { usePlugins, type ActionEntry } from '../stores/plugins'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ slotName: ActionSlot }>()
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
      type="button"
      class="tk-icon-button action"
      :title="a.def.tooltip ?? a.def.title"
      :aria-label="a.def.title"
      :aria-pressed="a.def.isActive ? check(a, 'isActive', false) : undefined"
      :disabled="!check(a, 'isEnabled', true)"
      :data-action="a.key"
      @click="run(a)"
    >
      <AppIcon :icon="a.icon" :title="a.def.title" />
    </button>
  </template>
</template>
