<script setup lang="ts">
// The window's shell: the titlebar, the rail of pinned panels and the docking area.
// Everything inside comes from plugins (SPEC.md "Plugin system"): the panels (Chat, Chats, Files, Editor,
// Terminal, Console, Plugins) and the titlebar/statusbar buttons are registered by
// Tinkr's built-in plugins (src/builtins) through the same API as plugins on disk.
// Keyboard shortcuts are command keybindings, so plugins can add their own.
import { onBeforeUnmount, onMounted } from 'vue'
import { UI_ICONS } from './builtins/icons'
import ActionSlot from './components/ActionSlot.vue'
import AgentButton from './components/AgentButton.vue'
import AppIcon from './components/AppIcon.vue'
import BackgroundLayer from './components/BackgroundLayer.vue'
import CommandPalette from './components/CommandPalette.vue'
import DockLayout from './components/DockLayout.vue'
import LayoutMenu from './components/LayoutMenu.vue'
import PanelRail from './components/PanelRail.vue'
import Toasts from './components/Toasts.vue'
import { useLayout } from './stores/layout'
import { usePlugins } from './stores/plugins'
import { useRail } from './stores/rail'
import { useSettings } from './stores/settings'
import { useWorkspace } from './stores/workspace'

const ws = useWorkspace()
const layout = useLayout()
const plugins = usePlugins()
const rail = useRail()
const settings = useSettings()

// App shortcuts, from anywhere in the window: whatever command is bound to the key.
// (Ctrl+S, Ctrl+L and the like are handled inside the editor first.)
function onKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented) return
  const command = plugins.commandForKey(e)
  if (!command) return
  e.preventDefault()
  plugins.executeCommand(command.id).catch(() => {}) // failures are logged to the Console
}

// Layout and settings changes still waiting to be saved (saving waits for a pause) are
// written when the window closes.
function saveNow() {
  layout.flush()
  void settings.flush()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', saveNow)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', saveNow)
})
</script>

<template>
  <div class="app">
    <BackgroundLayer />
    <header class="titlebar">
      <strong>Tinkr</strong>
      <button
        type="button"
        class="tk-icon-button"
        :aria-pressed="!rail.collapsed"
        :aria-label="rail.collapsed ? 'Show the side bar' : 'Hide the side bar'"
        :title="`${rail.collapsed ? 'Show' : 'Hide'} the side bar (Ctrl+Shift+B)`"
        data-testid="rail-toggle"
        @click="rail.toggleCollapsed()"
      >
        <AppIcon :icon="{ path: UI_ICONS.rail }" />
      </button>
      <!-- The rail's buttons, while it's collapsed. -->
      <template v-if="rail.collapsed">
        <AgentButton side="below" />
        <ActionSlot slot-name="statusbar" />
      </template>
      <span v-if="ws.name" class="project" :title="ws.root ?? ''">{{ ws.name }}</span>
      <span class="spacer" />
      <ActionSlot slot-name="titlebar" />
      <LayoutMenu />
    </header>

    <main class="main" :class="{ collapsed: rail.collapsed }">
      <PanelRail v-if="!rail.collapsed" />
      <DockLayout class="dock-area" />
    </main>

    <!-- Panel content waits here (hidden) while its panel isn't in the layout. -->
    <div id="tk-parking" class="parking" aria-hidden="true" />
    <CommandPalette />
    <Toasts />
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100%; }
.titlebar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--tk-border); background: var(--tk-surface); }
.project { color: var(--tk-text-muted); }
.project::before { content: '/'; margin-right: 10px; color: var(--tk-border); }
.spacer { flex: 1; }
.main { flex: 1; min-height: 0; display: flex; padding: 0 6px 6px 0; }
.main.collapsed { padding-left: 6px; }
.dock-area { flex: 1; min-width: 0; }
.parking { display: none; }
</style>
