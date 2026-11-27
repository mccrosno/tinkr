<script setup lang="ts">
// The docking area (dockview): every panel is a tab you can drag to split or stack it.
// This component only provides the dock itself: one PanelHost per panel, a tab without
// a close button for the chat, and Tinkr's colors. What goes in each panel, and the
// presets, are App.vue's and the layout store's business.
import { DockviewVue, type DockviewReadyEvent, type DockviewTheme } from 'dockview-vue'
import 'dockview-vue/dist/styles/dockview.css'
import { Dock, PANEL_IDS } from '../layout/dock'
import { useLayout } from '../stores/layout'
import PanelHost from './PanelHost.vue'

const layout = useLayout()

/** Dockview's colors come from CSS variables; `dockview-theme-tinkr` maps them to Tinkr's tokens (base.css). */
const theme: DockviewTheme = { name: 'tinkr', className: 'dockview-theme-tinkr' }

function onReady(e: DockviewReadyEvent) {
  layout.attach(new Dock(e.api))
  // Dev only: the e2e scripts inspect the layout.
  if (import.meta.env.DEV) Object.assign(window, { __tinkrDock: e.api })
}
</script>

<template>
  <!-- The wrapper carries the size: DockviewVue doesn't pass `class` through to its element. -->
  <div class="dock">
  <DockviewVue class="dock-inner" :theme="theme" @ready="onReady">
    <template v-for="id in PANEL_IDS" :key="id" #[`panel-${id}`]>
      <PanelHost :panel="id" />
    </template>
    <!-- The chat's tab: a title, no close button (it's the main window). -->
    <template #tab-pinned="props">
      <div class="pinned-tab" :title="props.api?.title">{{ props.api?.title ?? props.params?.title }}</div>
    </template>
  </DockviewVue>
  </div>
</template>

<style scoped>
.dock { height: 100%; }
.dock > :deep(*) { height: 100%; }
.pinned-tab { display: flex; align-items: center; height: 100%; padding: 0 10px; white-space: nowrap; }
</style>
