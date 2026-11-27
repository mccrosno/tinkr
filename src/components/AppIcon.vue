<script setup lang="ts">
// One icon, in the current text color: SVG path data drawn as a line icon, an .svg file
// used as a mask (so its own colors are ignored), or, with neither, the title's first letter.
import { computed } from 'vue'
import { iconLetter, type Icon } from '../plugins/icons'

const props = withDefaults(defineProps<{ icon?: Icon | null; title?: string; size?: number }>(), { icon: null, title: '', size: 18 })

const box = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }))
const mask = computed(() => {
  if (!props.icon || !('url' in props.icon)) return {}
  // Quote the URL, escaping what could end the quoted string.
  const url = `url("${props.icon.url.replace(/["\\\n]/g, (c) => encodeURIComponent(c))}")`
  return { ...box.value, maskImage: url, WebkitMaskImage: url }
})
</script>

<template>
  <svg
    v-if="icon && 'path' in icon"
    class="tk-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="icon.path" />
  </svg>
  <span v-else-if="icon" class="tk-icon mask" :style="mask" aria-hidden="true" />
  <span v-else class="tk-icon letter" :style="{ ...box, fontSize: `${Math.round(size * 0.75)}px` }" aria-hidden="true">{{ iconLetter(title) }}</span>
</template>

<style scoped>
.tk-icon { flex: none; }
.mask { display: inline-block; background-color: currentColor; mask-size: contain; mask-repeat: no-repeat; mask-position: center; -webkit-mask-size: contain; -webkit-mask-repeat: no-repeat; -webkit-mask-position: center; }
.letter { display: inline-flex; align-items: center; justify-content: center; font-weight: 600; line-height: 1; }
</style>
