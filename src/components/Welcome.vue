<script setup lang="ts">
import { useWorkspace } from '../stores/workspace'
import { baseName } from '../workspace/fs'

const ws = useWorkspace()
defineEmits<{ open: [path?: string] }>()
</script>

<template>
  <div class="welcome">
    <h1>Open a folder to start</h1>
    <p>Browse and edit files on the left, chat with Claude on the right.</p>
    <button class="tk-button primary" @click="$emit('open')">Open folder…</button>
    <p v-if="ws.error" class="error">{{ ws.error }}</p>
    <section v-if="ws.recent.length" class="recent">
      <h2>Recent</h2>
      <ul>
        <li v-for="p in ws.recent" :key="p">
          <button class="link" :title="p" @click="$emit('open', p)">
            <strong>{{ baseName(p) }}</strong> <span>{{ p }}</span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.welcome { max-width: 520px; margin: 14vh auto 0; padding: 0 24px; text-align: center; }
h1 { font-size: 20px; margin: 0 0 6px; }
p { color: var(--tk-text-muted); margin: 0 0 16px; }
.error { color: var(--tk-danger); margin-top: 12px; }
.recent { margin-top: 28px; text-align: left; }
h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--tk-text-muted); margin: 0 0 6px; }
ul { list-style: none; margin: 0; padding: 0; }
.link { width: 100%; display: flex; gap: 8px; align-items: baseline; text-align: left; background: none; border: 0; padding: 5px 8px; border-radius: var(--tk-radius-sm); }
.link:hover { background: var(--tk-surface-2); }
.link span { color: var(--tk-text-muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
