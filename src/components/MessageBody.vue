<script setup lang="ts">
// Renders an assistant reply as Markdown. Raw HTML in the reply is escaped (html: false),
// so model output can't inject markup. Links open in the system browser.
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import { openUrl } from '@tauri-apps/plugin-opener'

const md = new MarkdownIt({ html: false, linkify: true, breaks: false })

const props = defineProps<{ text: string; streaming?: boolean }>()
const html = computed(() => md.render(props.text))

function onClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest('a')
  if (!a) return
  e.preventDefault()
  if (/^https?:\/\//.test(a.href)) openUrl(a.href).catch(() => {})
}
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- safe: markdown-it escapes HTML (html: false) -->
  <div class="md" :class="{ streaming }" @click="onClick" v-html="html" />
</template>

<style scoped>
.md :deep(> :first-child) { margin-top: 0; }
.md :deep(> :last-child) { margin-bottom: 0; }
.md :deep(p), .md :deep(ul), .md :deep(ol), .md :deep(pre) { margin: 0.6em 0; }
.md :deep(pre) { background: var(--tk-code-bg); border: 1px solid var(--tk-border); border-radius: var(--tk-radius-sm); padding: 10px 12px; overflow-x: auto; }
.md :deep(:not(pre) > code) { background: var(--tk-code-bg); border-radius: 4px; padding: 1px 5px; }
.md :deep(a) { color: var(--tk-accent); }
.md :deep(blockquote) { margin: 0.6em 0; padding-left: 12px; border-left: 3px solid var(--tk-border); color: var(--tk-text-muted); }
.md :deep(table) { border-collapse: collapse; }
.md :deep(th), .md :deep(td) { border: 1px solid var(--tk-border); padding: 4px 8px; }
.streaming :deep(> :last-child)::after { content: '▍'; color: var(--tk-accent); animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { opacity: 0; } }
</style>
