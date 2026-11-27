<script setup lang="ts">
// The Files panel: the open folder's tree, or the "open a folder" screen.
import { usePlugins } from '../stores/plugins'
import { useWorkspace } from '../stores/workspace'
import FileTree from './FileTree.vue'
import Welcome from './Welcome.vue'

const ws = useWorkspace()
const plugins = usePlugins()
const run = (id: string, ...args: unknown[]) => void plugins.executeCommand(id, ...args)
</script>

<template>
  <FileTree v-if="ws.root" class="fill" @close-folder="run('workspace.closeFolder')" />
  <Welcome v-else class="fill scroll" compact @open="(path?: string) => run('workspace.openFolder', path)" />
</template>

<style scoped>
.fill { flex: 1; min-height: 0; }
.scroll { overflow: auto; }
</style>
