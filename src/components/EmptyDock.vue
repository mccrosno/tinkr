<script setup lang="ts">
// What the dock shows when no panel is on screen (all closed or hidden): a quiet
// message and a few ways back in.
import { computed, ref } from 'vue'
import { timeAgo } from '../chat/dates'
import { useChat } from '../stores/chat'
import { usePlugins } from '../stores/plugins'
import AppLogo from './AppLogo.vue'
import PanelList from './PanelList.vue'

const chat = useChat()
const plugins = usePlugins()
const last = computed(() => chat.lastChat)

const allButton = ref<HTMLButtonElement>()
const list = ref<{ x: number; y: number } | null>(null)
function toggleList() {
  if (list.value) return void (list.value = null)
  const r = allButton.value!.getBoundingClientRect()
  // Over the rows it came from; the popup moves itself up if there's no room below.
  list.value = { x: r.left + (r.width - 300) / 2, y: r.bottom + 4 }
}

const run = (command: string, ...args: unknown[]) => plugins.executeCommand(command, ...args).catch(() => {}) // failures are logged to the Console
</script>

<template>
  <div class="empty-dock" data-testid="empty-dock">
    <div class="box">
      <AppLogo class="mark" :size="44" />
      <h1>Nothing open</h1>
      <p>Open something to get started.</p>
      <div class="rows">
        <button type="button" data-empty="new-chat" @click="run('chat.new')"><span>New chat</span><kbd>Ctrl+N</kbd></button>
        <button
          v-if="last"
          type="button"
          class="resume"
          data-empty="resume"
          :title="last.title"
          :disabled="chat.busy && last.sessionId !== chat.sessionId"
          @click="run('chat.open', last.sessionId)"
        >
          <span class="what">
            <span>Resume last chat</span>
            <span class="title">{{ last.title }}</span>
          </span>
          <span class="when">{{ timeAgo(last.lastModified) }}</span>
        </button>
        <button type="button" data-empty="open-folder" @click="run('workspace.openFolder')"><span>Open folder…</span><kbd>Ctrl+O</kbd></button>
        <button ref="allButton" type="button" data-empty="all-panels" aria-haspopup="dialog" :aria-expanded="!!list" @click="toggleList"><span>All panels</span></button>
        <PanelList v-if="list" v-bind="list" :anchor="allButton" @close="list = null" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.empty-dock { position: absolute; inset: 0; z-index: 5; display: flex; overflow: auto; border-radius: var(--tk-radius-card); background: var(--tk-bg); }
.box { margin: auto; width: 320px; max-width: 100%; padding: 24px; text-align: center; }
.mark { opacity: 0.45; }
h1 { margin: 12px 0 0; font-size: 16px; font-weight: 600; }
p { margin: 0; color: var(--tk-text-muted); }
.rows { display: flex; flex-direction: column; gap: 2px; margin-top: 20px; font-size: 13px; }
button { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 10px; border: 0; border-radius: 7px; background: none; text-align: left; }
button:hover:not(:disabled) { background: var(--tk-surface-2); }
kbd, .when { flex: none; color: var(--tk-text-muted); font-size: 11px; }
.what { display: flex; flex-direction: column; min-width: 0; }
.title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--tk-text-muted); font-size: 12px; }
</style>
