<script setup lang="ts">
// The theme's picture, behind everything (SPEC.md "Theming": image or SVG, static or
// animated). Panels show it through their see-through colors (src/theme/apply.ts).
import { computed } from 'vue'
import { useAppearance } from '../stores/appearance'

const appearance = useAppearance()
const bg = computed(() => appearance.theme.background)
const style = computed(() => {
  const b = bg.value
  if (!b) return {}
  return {
    // JSON.stringify quotes the URL, so spaces and parentheses in it are safe.
    backgroundImage: `url(${JSON.stringify(b.url)})`,
    backgroundSize: b.size === 'tile' ? 'auto' : b.size,
    backgroundRepeat: b.size === 'tile' ? 'repeat' : 'no-repeat',
    backgroundPosition: b.position,
    opacity: String(b.opacity),
  }
})
</script>

<template>
  <div v-if="bg" class="tk-background" :style="style" aria-hidden="true" data-testid="background" />
</template>

<style scoped>
/* Fixed behind the app; z-index -1 puts it above the window color but under everything else. */
.tk-background { position: fixed; inset: 0; z-index: -1; pointer-events: none; }
</style>
