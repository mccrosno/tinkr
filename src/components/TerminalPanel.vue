<script setup lang="ts">
// The bottom panel: a tab per terminal, plus new/close/hide buttons. Every tab's view
// stays mounted (hidden with v-show), so switching tabs or hiding the panel keeps
// each shell's screen and scrollback.
import { useTerminal } from '../stores/terminal'
import { useWorkspace } from '../stores/workspace'
import TerminalView from './TerminalView.vue'

const term = useTerminal()
const ws = useWorkspace()

function newTerminal() {
  if (ws.root) term.create(ws.root)
}
</script>

<template>
  <section class="terminal-panel" data-testid="terminal-panel">
    <header class="bar">
      <div class="tabs" role="tablist" aria-label="Terminals">
        <div
          v-for="t in term.tabs"
          :key="t.key"
          class="tab"
          role="tab"
          :aria-selected="t.key === term.activeKey"
          :title="t.pid ? `${t.cwd} (process ${t.pid})` : t.cwd"
          :data-key="t.key"
          @click="term.activeKey = t.key"
        >
          <span class="name">{{ t.title }}</span>
          <span v-if="t.status === 'exited'" class="badge" :title="`Exited with code ${t.exitCode}`">exited</span>
          <span v-else-if="t.status === 'failed'" class="badge bad">failed</span>
          <button class="close" :aria-label="`Close ${t.title}`" title="Close (kills the shell)" @click.stop="term.close(t.key)">×</button>
        </div>
      </div>
      <button class="icon" title="New terminal" aria-label="New terminal" @click="newTerminal">+</button>
      <span class="spacer" />
      <button class="icon" title="Hide terminal (Ctrl+`)" aria-label="Hide terminal" @click="term.visible = false">⌄</button>
    </header>
    <div class="views">
      <template v-for="t in term.tabs" :key="t.key">
        <p v-if="t.status === 'failed'" v-show="t.key === term.activeKey" class="error" role="alert">
          Couldn't start a shell: {{ t.error }}
        </p>
        <TerminalView v-else v-show="t.key === term.activeKey" :tab-key="t.key" :active="term.visible && t.key === term.activeKey" />
      </template>
    </div>
  </section>
</template>

<style scoped>
.terminal-panel { display: flex; flex-direction: column; min-height: 0; }
.bar { display: flex; align-items: stretch; gap: 2px; padding: 0 6px; border-bottom: 1px solid var(--tk-border); font-size: 12.5px; }
.tabs { display: flex; min-width: 0; overflow-x: auto; }
.tab { display: flex; align-items: center; gap: 6px; padding: 4px 6px 4px 10px; color: var(--tk-text-muted); border-bottom: 2px solid transparent; cursor: pointer; white-space: nowrap; }
.tab[aria-selected='true'] { color: var(--tk-text); border-bottom-color: var(--tk-accent); }
.badge { font-size: 11px; padding: 0 5px; border-radius: var(--tk-radius-sm); background: var(--tk-surface-2); color: var(--tk-text-muted); }
.badge.bad { color: var(--tk-danger); background: var(--tk-danger-bg); }
.close, .icon { background: none; border: 0; padding: 0 5px; color: var(--tk-text-muted); line-height: 1; font-size: 15px; }
.close:hover, .icon:hover { color: var(--tk-text); }
.spacer { flex: 1; }
.views { flex: 1; min-height: 0; }
.error { margin: 0; padding: 10px 12px; color: var(--tk-danger); font-size: 13px; }
</style>
