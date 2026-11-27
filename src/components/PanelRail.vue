<script setup lang="ts">
// The narrow strip left of the dock: icons of the pinned panels (click to show one, or
// to hide the card it's on), "+" for every panel, plugins' "statusbar" buttons, the
// button that collapses the rail, and the agent status dot. Drag a panel's tab onto it
// to pin the panel.
import { getPanelData } from 'dockview-vue'
import { computed, ref } from 'vue'
import { UI_ICONS } from '../builtins/icons'
import type { PanelId } from '../layout/dock'
import { useLayout } from '../stores/layout'
import { usePlugins } from '../stores/plugins'
import { useRail } from '../stores/rail'
import ActionSlot from './ActionSlot.vue'
import AgentButton from './AgentButton.vue'
import AppIcon from './AppIcon.vue'
import PanelList from './PanelList.vue'

const layout = useLayout()
const plugins = usePlugins()
const rail = useRail()

const pinned = computed(() =>
  rail.pins.flatMap((id) => {
    const p = plugins.panels.get(id)
    if (!p) return []
    const enabled = plugins.panelEnabled(id)
    return [{ id, title: p.title, icon: p.icon, enabled, shown: !!layout.shown[id], badge: plugins.panelBadge(id) }]
  }),
)

/** Show the panel where it is; if it's already on screen, hide its card (it keeps its place). */
function press(p: { id: PanelId; enabled: boolean; shown: boolean }) {
  if (p.shown) layout.hide(p.id)
  else if (p.enabled) layout.show(p.id)
}

// --- Dropping a tab to pin it ----------------------------------------------------
// Dockview keeps what's being dragged in `getPanelData()` (null for anything else).
const over = ref(false)

function onDragOver(e: DragEvent) {
  if (!getPanelData()?.panelId) return
  e.preventDefault() // allows the drop
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  over.value = true
}
function onDragLeave(e: DragEvent) {
  // dragleave also fires when moving onto a child element; only the rail's own edge counts.
  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) over.value = false
}
function onDrop(e: DragEvent) {
  over.value = false
  const id = getPanelData()?.panelId
  if (!id) return
  e.preventDefault()
  rail.pin(id)
}

// --- "+" ---------------------------------------------------------------------------
const addButton = ref<HTMLButtonElement>()
const list = ref<{ x: number; y: number } | null>(null)
function toggleList() {
  if (list.value) return void (list.value = null)
  const r = addButton.value!.getBoundingClientRect()
  list.value = { x: r.right + 8, y: r.top }
}
</script>

<template>
  <nav class="rail" :class="{ over }" aria-label="Pinned panels" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <button
      v-for="p in pinned"
      :key="p.id"
      type="button"
      class="tk-icon-button pin"
      :title="p.enabled ? p.title : `${p.title} (nothing to show)`"
      :aria-label="p.badge ? `${p.title}, needs attention` : p.title"
      :aria-pressed="p.shown"
      :aria-disabled="!p.enabled && !p.shown"
      :data-pin="p.id"
      @click="press(p)"
    >
      <AppIcon :icon="p.icon" :title="p.title" :size="19" />
      <span v-if="p.badge" class="badge" data-testid="rail-badge" />
    </button>
    <div class="divider" role="separator" />
    <button ref="addButton" type="button" class="tk-icon-button" title="All panels" aria-label="All panels" aria-haspopup="dialog" :aria-expanded="!!list" data-testid="all-panels" @click="toggleList">
      <AppIcon :icon="{ path: UI_ICONS.plus }" />
    </button>
    <PanelList v-if="list" v-bind="list" :anchor="addButton" @close="list = null" />
    <span class="spacer" />
    <ActionSlot slot-name="statusbar" />
    <button type="button" class="tk-icon-button" title="Collapse the side bar (Ctrl+Shift+B)" aria-label="Collapse the side bar" data-testid="rail-collapse" @click="rail.toggleCollapsed()">
      <AppIcon :icon="{ path: UI_ICONS.collapseLeft }" :size="16" />
    </button>
    <AgentButton side="right" />
  </nav>
</template>

<style scoped>
/* The transparent border is where the "drop here" outline appears, without moving anything. */
.rail { position: relative; z-index: 2; flex: none; width: 46px; margin: 0 3px; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 4px 0; overflow-y: auto; border: 1px dashed transparent; border-radius: var(--tk-radius-card); }
/* A background picture would make the icons hard to see: give the rail a panel color. */
:global(.tk-has-background .rail) { background: var(--tk-surface); }
.rail.over { border-color: var(--tk-accent); background: var(--tk-selection); }
.rail :deep(.tk-icon-button) { width: 34px; height: 34px; border-radius: 8px; }
.badge { position: absolute; top: 5px; right: 5px; width: 7px; height: 7px; border-radius: 50%; background: var(--tk-danger); }
.divider { flex: none; width: 20px; height: 1px; margin: 2px 0; background: var(--tk-border); }
.spacer { flex: 1; }
</style>
