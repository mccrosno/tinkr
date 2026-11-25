<script setup lang="ts">
import { onMounted } from 'vue'
import { ClaudeSidecarProvider } from './agent/claudeSidecar'
import ChatView from './components/ChatView.vue'
import StatusBar from './components/StatusBar.vue'
import { useChat } from './stores/chat'

const chat = useChat()
onMounted(() => chat.connect(new ClaudeSidecarProvider()))
</script>

<template>
  <div class="app">
    <header class="titlebar">
      <strong>Tinkr</strong>
      <span class="spacer" />
      <button class="tk-button" :disabled="chat.busy || !chat.messages.length" @click="chat.newChat()">New chat</button>
    </header>
    <main class="main"><ChatView /></main>
    <StatusBar />
  </div>
</template>

<style scoped>
.app { display: flex; flex-direction: column; height: 100%; }
.titlebar { display: flex; align-items: center; gap: 12px; padding: 6px 12px; border-bottom: 1px solid var(--tk-border); background: var(--tk-surface); }
.spacer { flex: 1; }
.main { flex: 1; min-height: 0; }
</style>
