<script setup lang="ts">
// The Plugins panel: every plugin, built-in or on disk, with its state. Plugins on disk
// can be turned on or off, reloaded, and (if broken) handed to Claude to fix. New ones
// can be asked of Claude.
import { computed } from 'vue'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { pluginLoader } from '../plugins/boot'
import { askClaudeToCreate, askClaudeToFix } from '../plugins/chatRequests'
import { usePlugins, type PluginRecord } from '../stores/plugins'

const plugins = usePlugins()

const onDisk = computed(() => plugins.plugins.filter((p) => !p.builtIn))
const builtIn = computed(() => plugins.plugins.filter((p) => p.builtIn))

const STATE: Record<PluginRecord['state'], string> = {
  loading: 'Loading…',
  active: 'On',
  error: 'Error',
  disabled: 'Off',
  'awaiting-approval': 'Waiting for your OK',
}

function openFolder() {
  const dir = plugins.dir
  if (dir) revealItemInDir(dir).catch((e) => plugins.addLog('tinkr', 'error', `couldn't open ${dir}: ${String(e)}`))
}
</script>

<template>
  <section class="plugins" data-testid="plugins-panel">
    <header class="bar">
      <span class="hint">Plugins live in <code>{{ plugins.dir ?? '~/.config/tinkr/plugins' }}</code> and reload when their files change.</span>
      <button class="tk-button" @click="openFolder">Open folder</button>
      <button class="tk-button primary" :disabled="!plugins.dir" @click="askClaudeToCreate()">New plugin with Claude</button>
    </header>
    <div class="scroll">
      <h2>Installed</h2>
      <p v-if="!onDisk.length" class="empty">
        None yet. Ask Claude for a new panel, command or theme, and it writes the plugin.
      </p>
      <ul>
        <li v-for="p in onDisk" :key="p.name" :class="p.state" :data-plugin="p.name">
          <div class="head">
            <strong>{{ p.manifest.displayName ?? p.name }}</strong>
            <span v-if="p.manifest.version" class="version">{{ p.manifest.version }}</span>
            <span class="state">{{ STATE[p.state] }}</span>
            <span class="spacer" />
            <button
              class="tk-button"
              :disabled="p.state === 'loading'"
              :aria-pressed="p.state !== 'disabled'"
              @click="pluginLoader()?.setEnabled(p.name, p.state === 'disabled' || p.state === 'awaiting-approval')"
            >
              {{ p.state === 'disabled' || p.state === 'awaiting-approval' ? 'Turn on' : 'Turn off' }}
            </button>
            <button class="tk-button" :disabled="p.state === 'disabled' || p.state === 'loading'" @click="pluginLoader()?.reload(p.name)">Reload</button>
          </div>
          <p v-if="p.manifest.description" class="desc">{{ p.manifest.description }}</p>
          <p v-if="p.manifest.permissions?.length" class="perms">Can use: {{ p.manifest.permissions.join(', ') }}</p>
          <div v-if="p.state === 'error'" class="error">
            <pre>{{ p.error }}</pre>
            <button class="tk-button" @click="askClaudeToFix(p.name, p.error ?? '')">Ask Claude to fix</button>
          </div>
        </li>
      </ul>
      <h2>Built in</h2>
      <ul class="builtin">
        <li v-for="p in builtIn" :key="p.name">
          <div class="head">
            <span>{{ p.manifest.displayName ?? p.name }}</span>
            <span class="state">{{ STATE[p.state] }}</span>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.plugins { flex: 1; min-height: 0; display: flex; flex-direction: column; font-size: 13px; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--tk-border); }
.hint { flex: 1; color: var(--tk-text-muted); font-size: 12px; overflow-wrap: anywhere; }
.scroll { flex: 1; min-height: 0; overflow: auto; padding: 4px 12px 12px; }
h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--tk-text-muted); margin: 12px 0 6px; }
ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
li { border: 1px solid var(--tk-border); border-radius: var(--tk-radius-sm); padding: 8px 10px; }
li.error { border-color: var(--tk-danger); }
.builtin li { padding: 4px 10px; }
.head { display: flex; align-items: center; gap: 8px; }
.version, .state { color: var(--tk-text-muted); font-size: 12px; }
li.active .state { color: var(--tk-ok); }
li.error .state { color: var(--tk-danger); }
.spacer { flex: 1; }
.desc, .perms { margin: 4px 0 0; color: var(--tk-text-muted); }
.error { margin-top: 6px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.error pre { margin: 0; max-width: 100%; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--tk-danger); font-size: 12px; }
.empty { color: var(--tk-text-muted); }
code { font-family: var(--tk-font-mono); font-size: 12px; }
</style>
