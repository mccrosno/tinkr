<script setup lang="ts">
// The ⋯ button in a panel card's header: what dragging the tab can do, without
// dragging, and closing the panel. Acts on the card's front tab.
import type { DockviewGroupPanel } from 'dockview-vue'
import { ref } from 'vue'
import { UI_ICONS } from '../builtins/icons'
import { useLayout } from '../stores/layout'
import { usePlugins } from '../stores/plugins'
import AppIcon from './AppIcon.vue'
import ContextMenu, { type MenuItem } from './ContextMenu.vue'

const props = defineProps<{ group: DockviewGroupPanel }>()
const layout = useLayout()
const plugins = usePlugins()
const button = ref<HTMLButtonElement>()
const menu = ref<{ x: number; y: number; title: string; items: MenuItem[] } | null>(null)

function toggle() {
  if (menu.value) return void (menu.value = null)
  const id = props.group.activePanel?.id
  if (!id) return
  const items: MenuItem[] = []
  if (props.group.panels.length > 1) {
    for (const [side, label] of [['left', 'left'], ['right', 'right'], ['top', 'up'], ['bottom', 'down']] as const) {
      items.push({ label: `Split ${label}`, run: () => layout.split(id, side) })
    }
  }
  for (const [i, edge] of (['left', 'right', 'bottom'] as const).entries()) {
    items.push({ label: `Move to the ${edge} edge`, separator: i === 0 && items.length > 0, run: () => layout.toEdge(id, edge) })
  }
  items.push({ label: 'Close panel', separator: true, run: () => layout.close(id) })
  const r = button.value!.getBoundingClientRect()
  // Right-aligned under the button; the menu moves itself back on screen if needed.
  menu.value = { x: r.right - 200, y: r.bottom + 4, title: plugins.panels.get(id)?.title ?? id, items }
}
</script>

<template>
  <button
    ref="button"
    type="button"
    class="tk-icon-button more"
    aria-label="Panel options"
    title="Panel options"
    aria-haspopup="menu"
    :aria-expanded="!!menu"
    data-testid="panel-menu"
    @click="toggle"
  >
    <AppIcon :icon="{ path: UI_ICONS.more }" :size="18" />
  </button>
  <ContextMenu v-if="menu" v-bind="menu" :anchor="button" @close="menu = null" />
</template>

<style scoped>
.more { align-self: center; margin-right: 6px; }
.more :deep(path) { stroke-width: 2.5; }
</style>
