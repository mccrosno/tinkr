<script setup lang="ts">
// The window's shell: the title bar, the rail of pinned panels and the docking area.
// Everything inside comes from plugins (SPEC.md "Plugin system"): the panels (Chat, Chats, Files, Editor,
// Terminal, Console, Plugins) and the titlebar/statusbar buttons are registered by
// Tinkr's built-in plugins (src/builtins) through the same API as plugins on disk.
// Keyboard shortcuts are command keybindings, so plugins can add their own.
import { onBeforeUnmount, onMounted } from 'vue'
import BackgroundLayer from './components/BackgroundLayer.vue'
import CommandPalette from './components/CommandPalette.vue'
import DockLayout from './components/DockLayout.vue'
import PanelRail from './components/PanelRail.vue'
import TitleBar from './components/TitleBar.vue'
import Toasts from './components/Toasts.vue'
import { useLayout } from './stores/layout'
import { usePlugins } from './stores/plugins'
import { useRail } from './stores/rail'
import { useSettings } from './stores/settings'

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
    <TitleBar />

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
.main { flex: 1; min-height: 0; display: flex; padding: 0 6px 6px 0; }
.main.collapsed { padding-left: 6px; }
.dock-area { flex: 1; min-width: 0; }
.parking { display: none; }
</style>
