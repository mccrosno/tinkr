<script setup lang="ts">
import { agent } from '../agent'
</script>

<template>
  <pre class="log"><template v-for="(l, i) in agent.log" :key="i">{{ l }}
</template></pre>
</template>

<style scoped>
.log { margin: 0; padding: 8px 12px; height: 100%; overflow: auto; box-sizing: border-box; font: 12px/1.5 ui-monospace, Consolas, monospace; color: var(--tk-muted); }
</style>
