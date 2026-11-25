<script setup lang="ts">
import { onMounted } from 'vue'
import { DockviewVue, themeDark } from 'dockview-vue'
import type { DockviewApi, DockviewReadyEvent } from 'dockview-vue'
import 'dockview-vue/dist/styles/dockview.css'
import ChatPanel from './panels/ChatPanel.vue'
import LogPanel from './panels/LogPanel.vue'
import { agent, connect, restart } from './agent'

const LAYOUT_KEY = 'tinkr.spike.layout'
let api: DockviewApi | undefined

function defaultLayout(a: DockviewApi) {
  a.clear()
  a.addPanel({ id: 'chat', component: 'chat', title: 'Chat' })
  a.addPanel({ id: 'log', component: 'log', title: 'Sidecar log', position: { referencePanel: 'chat', direction: 'below' } })
  a.addPanel({ id: 'notes', component: 'notes', title: 'Notes', position: { referencePanel: 'chat', direction: 'right' } })
  // New splits start out equal-ish; give the log a short strip and the notes a narrow column.
  a.getPanel('log')?.api.setSize({ height: 160 })
  a.getPanel('notes')?.api.setSize({ width: 280 })
}

function onReady(e: DockviewReadyEvent) {
  api = e.api
  // Dev only: let the e2e scripts drive the layout and run the theming benchmark.
  if (import.meta.env.DEV) {
    const w = window as unknown as { __dock: DockviewApi; __runBench: () => Promise<unknown> }
    w.__dock = api
    w.__runBench = async () => (await import('./bench')).runBench(api!)
    if (import.meta.env.VITE_AUTOBENCH) {
      // No DevTools port on WebKitGTK: run after startup and POST results to the dev server.
      setTimeout(async () => {
        const result = await w.__runBench()
        await fetch('/__bench', { method: 'POST', body: JSON.stringify(result) })
      }, 4000)
    }
  }
  // Restore the saved layout, or fall back to the default.
  try {
    const saved = localStorage.getItem(LAYOUT_KEY)
    if (saved) api.fromJSON(JSON.parse(saved))
    else defaultLayout(api)
  } catch {
    defaultLayout(api)
  }
  // Save whenever panels are moved, resized, added or closed.
  api.onDidLayoutChange(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(api!.toJSON()))
    } catch {
      /* storage unavailable: layout just won't persist */
    }
  })
}

function resetLayout() {
  if (api) defaultLayout(api)
}

onMounted(connect)
</script>

<template>
  <div class="app">
    <header class="bar">
      <strong>Tinkr spike</strong>
      <span class="auth">{{ agent.authLabel }}</span>
      <span class="spacer" />
      <button @click="restart">Restart sidecar</button>
      <button @click="resetLayout">Reset layout</button>
    </header>
    <DockviewVue class="dock" :theme="themeDark" @ready="onReady">
      <template #panel-chat><ChatPanel /></template>
      <template #panel-log><LogPanel /></template>
      <template #panel-notes>
        <div class="notes">
          Drag tabs to dock, split, or stack panels. The layout is saved and restored on reload.
        </div>
      </template>
    </DockviewVue>
  </div>
</template>

<style>
:root {
  --tk-bg: #16171b;
  --tk-surface-2: #23252b;
  --tk-border: #2f323a;
  --tk-text: #e4e6eb;
  --tk-muted: #8b909a;
  --tk-accent: #d97757;
  --tk-accent-bg: #4a2c22;
  --tk-on-accent: #1b0f0a;
  --tk-error: #ffb4a9;
  --tk-error-bg: #4a1c18;
}
html, body, #app { margin: 0; height: 100%; }
body { background: var(--tk-bg); color: var(--tk-text); font: 14px/1.4 system-ui, sans-serif; }
.app { display: flex; flex-direction: column; height: 100%; }
.bar { display: flex; align-items: center; gap: 12px; padding: 6px 12px; border-bottom: 1px solid var(--tk-border); }
.bar .auth { color: var(--tk-muted); font-size: 12px; }
.bar .spacer { flex: 1; }
.bar button { font: inherit; font-size: 12px; color: var(--tk-text); background: var(--tk-surface-2); border: 1px solid var(--tk-border); border-radius: 5px; padding: 3px 10px; cursor: pointer; }
.dock { flex: 1; min-height: 0; }
.notes { padding: 12px; color: var(--tk-muted); }
</style>
