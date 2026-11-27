<script setup lang="ts">
// A file attached to a message: a thumbnail for images, otherwise a chip with the name.
// In the composer it also has a remove button.
import { computed } from 'vue'
import type { AttachmentPreview } from '../agent/types'
import { formatSize, imageUrl, isImage } from '../chat/attachments'

const props = defineProps<{ file: AttachmentPreview & { size?: number }; removable?: boolean }>()
defineEmits<{ remove: [] }>()

const src = computed(() => (isImage(props.file.mediaType) ? imageUrl(props.file) : ''))
const kind = computed(() => (props.file.mediaType === 'application/pdf' ? 'PDF' : isImage(props.file.mediaType) ? 'Image' : 'Text'))
const title = computed(() => [props.file.name, props.file.size !== undefined ? formatSize(props.file.size) : null].filter(Boolean).join(' · '))
</script>

<template>
  <span class="attachment" :class="{ image: !!src }" :title="title" data-testid="attachment">
    <img v-if="src" :src="src" :alt="file.name" />
    <template v-else>
      <span class="kind">{{ kind }}</span>
      <span class="name">{{ file.name }}</span>
    </template>
    <button v-if="removable" type="button" class="remove" :aria-label="`Remove ${file.name}`" @click="$emit('remove')">×</button>
  </span>
</template>

<style scoped>
.attachment { position: relative; display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 1px 4px 1px 6px; border: 1px solid var(--tk-border); border-radius: var(--tk-radius-sm); background: var(--tk-surface-2); font-size: 12px; }
.attachment.image { padding: 0; overflow: hidden; }
img { display: block; height: 56px; max-width: 140px; object-fit: cover; }
.kind { color: var(--tk-text-muted); }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--tk-font-mono); font-size: 11.5px; }
.remove { border: 0; padding: 0 3px; background: none; color: var(--tk-text-muted); font-size: 14px; line-height: 1; }
.remove:hover { color: var(--tk-text); }
/* On a thumbnail, the button sits in the corner over the picture. */
.image .remove { position: absolute; top: 2px; right: 2px; background: var(--tk-surface); border-radius: var(--tk-radius-sm); padding: 0 4px; }
</style>
