<script setup lang="ts">
// The window's top bar, which replaces the system's: the logo, the side bar button, the
// open folder (a menu), the command search, plugins' buttons, the layout menu and the
// window buttons. Any part of it that isn't a button drags the window
// (`data-tauri-drag-region="deep"`), and a double-click there maximizes.
import { computed, ref } from 'vue'
import { UI_ICONS } from '../builtins/icons'
import { usePlugins } from '../stores/plugins'
import { useRail } from '../stores/rail'
import { useWorkspace } from '../stores/workspace'
import { baseName, samePath } from '../workspace/fs'
import ActionSlot from './ActionSlot.vue'
import AgentButton from './AgentButton.vue'
import AppIcon from './AppIcon.vue'
import AppLogo from './AppLogo.vue'
import ContextMenu, { type MenuItem } from './ContextMenu.vue'
import LayoutMenu from './LayoutMenu.vue'
import WindowControls from './WindowControls.vue'

const plugins = usePlugins()
const rail = useRail()
const ws = useWorkspace()

/** macOS keeps its own window buttons, in the top left corner (tauri.macos.conf.json). */
const mac = navigator.userAgent.includes('Mac')

const run = (command: string, ...args: unknown[]) => void plugins.executeCommand(command, ...args).catch(() => {}) // failures are logged to the Console

const projectButton = ref<HTMLButtonElement>()
const projectAt = ref<{ x: number; y: number } | null>(null)

const projectItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = [{ label: 'Open folder…', hint: 'Ctrl+O', run: () => run('workspace.openFolder') }]
  if (ws.root) items.push({ label: 'Close folder', run: () => run('workspace.closeFolder') })
  const recent = ws.recent.filter((p) => !ws.root || !samePath(p, ws.root)).slice(0, 8)
  recent.forEach((path, i) => items.push({ label: baseName(path), title: path, separator: i === 0, run: () => run('workspace.openFolder', path) }))
  return items
})

function toggleProject() {
  if (projectAt.value) return void (projectAt.value = null)
  const r = projectButton.value!.getBoundingClientRect()
  projectAt.value = { x: r.left, y: r.bottom + 4 }
}
</script>

<template>
  <header class="titlebar" :class="{ mac }" data-tauri-drag-region="deep">
    <div class="start">
      <AppLogo />
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
      <button ref="projectButton" type="button" class="project" :title="ws.root ?? 'No folder open'" aria-haspopup="menu" :aria-expanded="!!projectAt" data-testid="project-menu" @click="toggleProject">
        <span class="name">{{ ws.name ?? 'No folder' }}</span>
        <AppIcon :icon="{ path: UI_ICONS.chevronDown }" :size="14" />
      </button>
      <ContextMenu v-if="projectAt" v-bind="projectAt" title="Folder" :items="projectItems" :anchor="projectButton" @close="projectAt = null" />
    </div>
    <button type="button" class="search" data-testid="command-search" @click="run('commands.palette')">
      <span class="what">Search commands</span>
      <kbd>Ctrl+Shift+P</kbd>
    </button>
    <div class="end">
      <ActionSlot slot-name="titlebar" />
      <LayoutMenu />
      <template v-if="!mac">
        <span class="divider" />
        <WindowControls />
      </template>
    </div>
  </header>
</template>

<style scoped>
/* Above the dock, so menus opening from here are never under a panel. */
.titlebar { position: relative; z-index: 40; flex: none; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 420px) minmax(0, 1fr); align-items: center; gap: 8px; height: 40px; user-select: none; }
/* A background picture would make the text hard to see: give the bar a panel color. */
:global(.tk-has-background .titlebar) { background: var(--tk-surface); }
.start, .end { display: flex; align-items: center; gap: 4px; min-width: 0; }
.start { padding-left: 14px; overflow: hidden; }
.start > .logo { margin-right: 4px; }
.mac .start { padding-left: 80px; }
.end { justify-content: flex-end; align-self: stretch; }
.mac .end { padding-right: 8px; }
.project { display: flex; align-items: center; gap: 4px; min-width: 0; height: 28px; padding: 0 8px; border: 0; border-radius: 7px; background: none; font-weight: 600; }
.project:hover { background: var(--tk-surface-2); }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.search { display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 26px; min-width: 0; padding: 0 10px; overflow: hidden; border: 1px solid var(--tk-border); border-radius: 7px; background: var(--tk-bg); color: var(--tk-text-muted); font-size: 12px; white-space: nowrap; }
.search:hover { border-color: var(--tk-text-muted); }
.what { overflow: hidden; text-overflow: ellipsis; }
kbd { font-size: 11px; }
.divider { width: 1px; height: 20px; margin: 0 4px; background: var(--tk-border); }
</style>
