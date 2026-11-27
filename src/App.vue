<script setup lang="ts">
// The window's shell: the titlebar, the docking area, the status bar. Everything inside
// comes from plugins (SPEC.md "Plugin system"): the panels (Chat, Chats, Files, Editor,
// Terminal, Console, Plugins) and the titlebar/statusbar buttons are registered by
// Tinkr's built-in plugins (src/builtins) through the same API as plugins on disk.
// Keyboard shortcuts are command keybindings, so plugins can add their own.
import { onBeforeUnmount, onMounted } from 'vue'
import ActionSlot from './components/ActionSlot.vue'
import BackgroundLayer from './components/BackgroundLayer.vue'
import CommandPalette from './components/CommandPalette.vue'
import DockLayout from './components/DockLayout.vue'
import LayoutMenu from './components/LayoutMenu.vue'
import StatusBar from './components/StatusBar.vue'
import Toasts from './components/Toasts.vue'
import { useLayout } from './stores/layout'
import { usePlugins } from './stores/plugins'
import { useWorkspace } from './stores/workspace'

const ws = useWorkspace()
const layout = useLayout()
const plugins = usePlugins()

// App shortcuts, from anywhere in the window: whatever command is bound to the key.
// (Ctrl+S, Ctrl+L and the like are handled inside the editor first.)
function onKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented) return
  const command = plugins.commandForKey(e)
  if (!command) return
  e.preventDefault()
  plugins.executeCommand(command.id).catch(() => {}) // failures are logged to the Console
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  // A layout change still waiting to be saved (saving waits for a pause) is written when the window closes.
  window.addEventListener('beforeunload', layout.flush)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', layout.flush)
})
</script>

<template>
  <div class="app">
    <BackgroundLayer />
    <header class="titlebar">
      <strong>Tinkr</strong>
      <span v-if="ws.name" class="project" :title="ws.root ?? ''">{{ ws.name }}</span>
      <span class="spacer" />
      <ActionSlot slot-name="titlebar" />
      <LayoutMenu />
    </header>

    <main class="main"><DockLayout /></main>

    <StatusBar />

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
.main { flex: 1; min-height: 0; }
.parking { display: none; }
</style>
