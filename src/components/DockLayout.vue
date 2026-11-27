<script setup lang="ts">
// The docking area (dockview): every panel is a tab you can drag to split or stack it.
// This component only provides the dock itself: a PanelHost per panel (where the
// panel's content is moved in), a tab without a close button for the chat, and Tinkr's
// colors. Panels come from the plugin registry; presets from the layout store.
import { watch } from 'vue'
import { DockviewVue, type DockviewApi, type DockviewReadyEvent, type DockviewTheme } from 'dockview-vue'
import 'dockview-vue/dist/styles/dockview.css'
import { BUILT_IN_PANELS, Dock } from '../layout/dock'
import { askAboutNewPlugins, pluginsReady } from '../plugins/boot'
import { useLayout } from '../stores/layout'
import { usePlugins } from '../stores/plugins'
import PanelHost from './PanelHost.vue'

const layout = useLayout()
const plugins = usePlugins()

/** Dockview's colors come from CSS variables; `dockview-theme-tinkr` maps them to Tinkr's tokens (dock.css). */
const theme: DockviewTheme = { name: 'tinkr', className: 'dockview-theme-tinkr' }

async function onReady(e: DockviewReadyEvent) {
  // Dev only: the e2e scripts inspect the layout.
  if (import.meta.env.DEV) Object.assign(window, { __tinkrDock: e.api })
  // Lay out the saved arrangement once the panels it mentions are registered.
  await pluginsReady()
  layout.attach(
    new Dock(e.api, (id) => {
      const p = plugins.panels.get(id)
      return p && { title: p.title, closable: p.closable, location: p.location }
    }),
  )
  keepTitles(e.api)
  await askAboutNewPlugins()
}

/** A panel's `ctx.setTitle` renames its tab. */
function keepTitles(api: DockviewApi) {
  watch(
    () => [...plugins.panels.values()].map((p) => [p.id, p.title] as const),
    (titles) => {
      for (const [id, title] of titles) {
        const panel = api.getPanel(id)
        if (panel && panel.title !== title) panel.api.setTitle(title)
      }
    },
    { immediate: true },
  )
}
</script>

<template>
  <!-- The wrapper carries the size: DockviewVue doesn't pass `class` through to its element. -->
  <div class="dock">
    <DockviewVue class="dock-inner" :theme="theme" @ready="onReady">
      <!-- Every panel is a "host" component; its id is in params. -->
      <template #panel-host="props">
        <PanelHost :panel="props.params?.params?.panel ?? props.params?.panel ?? props.api?.id" />
      </template>
      <!-- Layouts saved before Milestone 7 named the component after the panel. -->
      <template v-for="id in BUILT_IN_PANELS" :key="id" #[`panel-${id}`]>
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
