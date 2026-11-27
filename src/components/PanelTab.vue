<script setup lang="ts">
// A panel's tab, drawn as a pill in its card's header (styled in dock.css). No close
// button: panels are closed from the header's menu.
import { computed } from 'vue'
import { usePlugins } from '../stores/plugins'

const props = defineProps<{ panel: string; fallback?: string }>()
const plugins = usePlugins()
const title = computed(() => plugins.panels.get(props.panel)?.title ?? props.fallback ?? props.panel)
</script>

<template>
  <div class="tk-tab" :title="title">{{ title }}</div>
</template>

<style scoped>
.tk-tab { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
