<script setup lang="ts">
// The inside of one dock panel: an empty box that the panel's real content is moved
// into (App.vue teleports it here). Dockview creates and destroys these as panels are
// added, moved between layouts or closed; the content itself is created once and
// survives all of that, so a chat draft, a shell's screen or the editor's undo history
// isn't lost when the layout changes.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { PanelId } from '../layout/dock'
import { useLayout } from '../stores/layout'

const props = defineProps<{ panel: PanelId }>()
const layout = useLayout()
const el = ref<HTMLElement>()

onMounted(() => {
  layout.hosts[props.panel] = el.value
})
onBeforeUnmount(() => {
  // Only clear it if a newer host for the same panel hasn't already taken over.
  if (layout.hosts[props.panel] === el.value) delete layout.hosts[props.panel]
})
</script>

<template>
  <div ref="el" class="panel-host" :data-panel="panel" />
</template>

<style scoped>
.panel-host { height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--tk-bg); }
</style>
