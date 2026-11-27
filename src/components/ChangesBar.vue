<script setup lang="ts">
// Above the composer while Claude's edits are waiting for review:
// "3 files changed +12 −4  [Accept all] [Reject all]", with a per-file list.
import { ref } from 'vue'
import { ask } from '@tauri-apps/plugin-dialog'
import { useEditor } from '../stores/editor'
import { useReview } from '../stores/review'

const review = useReview()
const editor = useEditor()
const expanded = ref(true)

async function rejectAll() {
  const ok = await ask(`Undo Claude's changes to ${review.count} file(s)? Files Claude created will be deleted.`, {
    title: 'Reject all changes',
    kind: 'warning',
    okLabel: 'Reject all',
    cancelLabel: 'Cancel',
  })
  if (ok) await review.rejectAll()
}
</script>

<template>
  <section v-if="review.count" class="changes" data-testid="changes" aria-label="Changes to review">
    <div class="column">
      <header>
        <button class="toggle" :aria-expanded="expanded" @click="expanded = !expanded">
          {{ expanded ? '▾' : '▸' }} {{ review.count }} {{ review.count === 1 ? 'file' : 'files' }}
        </button>
        <span class="stat add">+{{ review.totals.added }}</span>
        <span class="stat del">−{{ review.totals.removed }}</span>
        <span class="spacer" />
        <button class="tk-button" @click="review.acceptAll()">Accept all</button>
        <button class="tk-button" @click="rejectAll">Reject all</button>
      </header>
      <ul v-if="expanded">
        <li v-for="f in review.files" :key="f.path" :data-path="f.path">
          <button class="file" :title="f.path" @click="editor.open(f.path)">
            {{ f.relPath }}<span v-if="f.baseline === null" class="tag">new</span><span v-if="f.current === null" class="tag">deleted</span>
          </button>
          <span class="stat add">+{{ f.added }}</span>
          <span class="stat del">−{{ f.removed }}</span>
          <button class="icon ok" title="Accept this file's changes" :aria-label="`Accept ${f.relPath}`" @click="review.accept(f.path)">✓</button>
          <button class="icon bad" title="Undo this file's changes" :aria-label="`Reject ${f.relPath}`" @click="review.reject(f.path)">✕</button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.changes { border-top: 1px solid var(--tk-border); font-size: 13px; padding: 6px 0; margin-bottom: 8px; }
.column { max-width: 780px; margin: 0 auto; padding: 0 20px; }
header, li { display: flex; align-items: center; gap: 8px; }
header .tk-button { padding: 1px 10px; font-size: 12.5px; white-space: nowrap; }
.toggle { border: 0; background: none; padding: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.stat { white-space: nowrap; }
.spacer { flex: 1; }
.stat { font-family: var(--tk-font-mono); font-size: 12px; }
.add { color: var(--tk-ok); }
.del { color: var(--tk-danger); }
ul { list-style: none; margin: 4px 0 0; padding: 0; max-height: 160px; overflow-y: auto; }
li { padding: 1px 0 1px 16px; }
.file { flex: 1; min-width: 0; text-align: left; border: 0; background: none; padding: 0; font-family: var(--tk-font-mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file:hover { text-decoration: underline; }
.tag { margin-left: 6px; padding: 0 4px; border-radius: var(--tk-radius-sm); background: var(--tk-surface-2); color: var(--tk-text-muted); font-family: var(--tk-font); font-size: 11px; }
.icon { border: 0; background: none; padding: 0 4px; font-size: 13px; color: var(--tk-text-muted); }
.icon.ok:hover { color: var(--tk-ok); }
.icon.bad:hover { color: var(--tk-danger); }
</style>
