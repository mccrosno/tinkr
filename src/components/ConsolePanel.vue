<script setup lang="ts">
// The Console panel: what plugins log, and their errors (failed loads, exceptions in
// commands or panels). An error from a plugin on disk can be handed to Claude.
import { computed, nextTick, ref, watch } from 'vue'
import { askClaudeToFix } from '../plugins/chatRequests'
import { usePlugins, type LogEntry } from '../stores/plugins'

const plugins = usePlugins()
const errorsOnly = ref(false)
const list = ref<HTMLElement>()

const shown = computed(() => (errorsOnly.value ? plugins.log.filter((l) => l.level === 'error') : plugins.log))
const time = (ms: number) => new Date(ms).toLocaleTimeString()
/** Errors of plugins on disk (built-ins are Tinkr's own code). */
const fixable = (l: LogEntry) => l.level === 'error' && !!plugins.record(l.plugin)?.dir

// Keep the newest line in view, unless the user scrolled up to read.
watch(
  () => plugins.log.length,
  async () => {
    const el = list.value
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    await nextTick()
    if (atBottom) el.scrollTop = el.scrollHeight
  },
)
</script>

<template>
  <section class="console" data-testid="console">
    <header class="bar">
      <label><input v-model="errorsOnly" type="checkbox" /> Errors only</label>
      <span class="spacer" />
      <button class="tk-button" :disabled="!plugins.log.length" @click="plugins.clearLog()">Clear</button>
    </header>
    <ol ref="list" class="lines">
      <li v-for="l in shown" :key="l.id" :class="l.level" :data-plugin="l.plugin">
        <span class="time">{{ time(l.time) }}</span>
        <span class="plugin">{{ l.plugin }}</span>
        <pre class="text">{{ l.text }}</pre>
        <button v-if="fixable(l)" class="tk-button fix" @click="askClaudeToFix(l.plugin, l.text)">Ask Claude to fix</button>
      </li>
      <li v-if="!shown.length" class="empty">{{ errorsOnly ? 'No errors.' : 'Nothing logged yet. Plugins write here with api.log.' }}</li>
    </ol>
  </section>
</template>

<style scoped>
.console { flex: 1; min-height: 0; display: flex; flex-direction: column; font-size: 12.5px; }
.bar { display: flex; align-items: center; gap: 8px; padding: 4px 10px; border-bottom: 1px solid var(--tk-border); }
.bar label { display: flex; align-items: center; gap: 6px; color: var(--tk-text-muted); }
.spacer { flex: 1; }
.lines { flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 4px 0; list-style: none; font-family: var(--tk-font-mono); }
li { display: flex; align-items: baseline; gap: 10px; padding: 2px 10px; }
li.warn { background: color-mix(in srgb, var(--tk-warn) 10%, transparent); }
li.error { background: var(--tk-danger-bg); }
.time { flex: none; color: var(--tk-text-muted); }
.plugin { flex: none; color: var(--tk-accent); }
.text { flex: 1; min-width: 0; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
li.error .text { color: var(--tk-danger); }
.fix { flex: none; font-family: var(--tk-font); }
.empty { color: var(--tk-text-muted); font-family: var(--tk-font); }
</style>
