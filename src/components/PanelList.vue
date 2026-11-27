<script setup lang="ts">
// "All panels": every registered panel (plugins' too), where it is now, and whether
// it's pinned to the rail. Opened from the rail's "+" and from the empty dock.
import { computed } from 'vue'
import type { PanelId } from '../layout/dock'
import { useLayout } from '../stores/layout'
import { usePlugins } from '../stores/plugins'
import { useRail } from '../stores/rail'
import AppIcon from './AppIcon.vue'
import PopupBox from './PopupBox.vue'

defineProps<{ x: number; y: number; anchor?: HTMLElement | null }>()
const emit = defineEmits<{ close: [] }>()
const layout = useLayout()
const plugins = usePlugins()
const rail = useRail()

const STATE_LABELS = { open: 'Open', hidden: 'Hidden', closed: 'Closed' }
const rows = computed(() =>
  [...plugins.panels.values()].map((p) => {
    const enabled = plugins.panelEnabled(p.id)
    return { ...p, enabled, state: enabled ? STATE_LABELS[layout.state(p.id)] : 'Nothing to show' }
  }),
)

function open(id: PanelId) {
  emit('close')
  layout.show(id)
}
</script>

<template>
  <PopupBox class="panel-list" role="dialog" label="All panels" :x="x" :y="y" :anchor="anchor" @close="emit('close')">
    <div class="tk-menu-title">All panels</div>
    <div v-for="p in rows" :key="p.id" class="row" :data-panel-item="p.id">
      <button type="button" class="tk-menu-item open" :disabled="!p.enabled" @click="open(p.id)">
        <AppIcon :icon="p.icon" :title="p.title" :size="16" />
        <span class="title">{{ p.title }}</span>
        <span class="state">{{ p.state }}</span>
      </button>
      <button
        type="button"
        class="pin"
        :aria-pressed="rail.isPinned(p.id)"
        :aria-label="`${rail.isPinned(p.id) ? 'Unpin' : 'Pin'} ${p.title}`"
        @click="rail.togglePin(p.id)"
      >
        {{ rail.isPinned(p.id) ? 'Unpin' : 'Pin' }}
      </button>
    </div>
  </PopupBox>
</template>

<style scoped>
.panel-list { width: 300px; }
.row { display: flex; align-items: center; gap: 4px; }
.open { flex: 1; min-width: 0; justify-content: flex-start; gap: 10px; padding-block: 5px; }
.title { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.state { font-size: 11px; color: var(--tk-text-muted); }
.pin { flex: none; width: 52px; height: 24px; border: 1px solid var(--tk-border); border-radius: var(--tk-radius-sm); background: none; font-size: 11px; }
.pin:hover { border-color: var(--tk-text-muted); }
.pin[aria-pressed='true'] { background: var(--tk-surface-2); }
</style>
