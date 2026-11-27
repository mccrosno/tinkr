<script setup lang="ts">
// Tinkr's mark, in the theme's accent color.
withDefaults(defineProps<{ size?: number }>(), { size: 18 })
</script>

<template>
  <svg class="logo" :width="size" :height="size" viewBox="0 0 18 18" aria-hidden="true">
    <rect width="18" height="18" rx="5" fill="var(--tk-accent)" />
    <path d="M5 5.5h8M9 5.5v7.5" stroke="var(--tk-on-accent)" stroke-width="2.2" stroke-linecap="round" fill="none" />
  </svg>
</template>

<style scoped>
.logo { flex: none; }
</style>
