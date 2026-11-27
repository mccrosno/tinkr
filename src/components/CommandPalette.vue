<script setup lang="ts">
// The command palette (Ctrl+Shift+P): every command Tinkr and its plugins registered,
// filtered as you type. Enter runs the highlighted one.
import { computed, nextTick, ref, watch } from 'vue'
import { ui } from '../app/ui'
import { usePlugins } from '../stores/plugins'

const plugins = usePlugins()
const query = ref('')
const index = ref(0)
const input = ref<HTMLInputElement>()

/** "ctrl+shift+p" -> "Ctrl+Shift+P" */
const pretty = (k?: string) => k?.split('+').map((p) => (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))).join('+')

const matches = computed(() => {
  const words = query.value.toLowerCase().split(/\s+/).filter(Boolean)
  return [...plugins.commands.values()]
    .filter((c) => !c.hidden)
    .filter((c) => words.every((w) => `${c.title} ${c.id}`.toLowerCase().includes(w)))
    .sort((a, b) => a.title.localeCompare(b.title))
})

watch(
  () => ui.paletteOpen,
  async (open) => {
    if (!open) return
    query.value = ''
    index.value = 0
    await nextTick()
    input.value?.focus()
  },
)
watch(query, () => (index.value = 0))

function close() {
  ui.paletteOpen = false
}

function runAt(i: number) {
  const c = matches.value[i]
  if (!c) return
  close()
  plugins.executeCommand(c.id).catch(() => {}) // failures are logged to the Console
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
  else if (e.key === 'ArrowDown') index.value = Math.min(index.value + 1, matches.value.length - 1)
  else if (e.key === 'ArrowUp') index.value = Math.max(index.value - 1, 0)
  else if (e.key === 'Enter') runAt(index.value)
  else return
  e.preventDefault()
  e.stopPropagation()
}
</script>

<template>
  <div v-if="ui.paletteOpen" class="backdrop" @mousedown.self="close">
    <div class="palette" role="dialog" aria-label="Commands" data-testid="palette">
      <input ref="input" v-model="query" placeholder="Type a command" aria-label="Command" @keydown="onKeydown" />
      <ul role="listbox">
        <li
          v-for="(c, i) in matches"
          :key="c.id"
          role="option"
          :aria-selected="i === index"
          :data-command="c.id"
          @mousemove="index = i"
          @mousedown.prevent="runAt(i)"
        >
          <span class="title">{{ c.title }}</span>
          <kbd v-if="c.keybinding">{{ pretty(c.keybinding) }}</kbd>
        </li>
        <li v-if="!matches.length" class="none">No matching command</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; z-index: 1000; display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; background: color-mix(in srgb, var(--tk-bg) 40%, transparent); }
.palette { width: min(560px, 90vw); background: var(--tk-surface); border: 1px solid var(--tk-border); border-radius: var(--tk-radius); box-shadow: var(--tk-shadow); overflow: hidden; }
input { width: 100%; padding: 10px 12px; border: 0; border-bottom: 1px solid var(--tk-border); background: var(--tk-bg); outline: none; font-size: 14px; }
ul { list-style: none; margin: 0; padding: 4px; max-height: 50vh; overflow: auto; }
li { display: flex; align-items: center; gap: 12px; padding: 6px 10px; border-radius: var(--tk-radius-sm); cursor: pointer; }
li[aria-selected='true'] { background: var(--tk-selection); }
.title { flex: 1; }
kbd { font-family: var(--tk-font-mono); font-size: 11.5px; color: var(--tk-text-muted); }
.none { color: var(--tk-text-muted); cursor: default; }
</style>
