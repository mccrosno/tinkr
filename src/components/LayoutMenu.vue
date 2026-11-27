<script setup lang="ts">
// Titlebar menu for layout presets: switch (Ctrl+Alt+1, 2, ...), reset the current one
// to its starting arrangement, save the current arrangement as a new preset, and
// delete saved ones.
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useLayout } from '../stores/layout'

const layout = useLayout()
const open = ref(false)
const naming = ref(false)
const name = ref('')
const root = ref<HTMLElement>()
const nameInput = ref<HTMLInputElement>()

function close() {
  open.value = false
  naming.value = false
  name.value = ''
}

function pick(id: string) {
  layout.switchTo(id)
  close()
}

async function startNaming() {
  naming.value = true
  name.value = ''
  await nextTick()
  nameInput.value?.focus()
}

function save() {
  if (layout.saveAs(name.value)) close()
}

function reset() {
  layout.reset()
  close()
}

// Close when clicking anywhere else, or on Escape.
function onPointerDown(e: PointerEvent) {
  if (!root.value?.contains(e.target as Node)) close()
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}
watch(open, (isOpen) => {
  if (isOpen) {
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeydown)
  } else {
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('keydown', onKeydown)
  }
})
onBeforeUnmount(() => (open.value = false))
</script>

<template>
  <div ref="root" class="layout-menu">
    <button class="tk-button" :aria-expanded="open" aria-haspopup="menu" title="Layout presets" data-testid="layout-menu" @click="open = !open">
      Layout: {{ layout.active.name }} ▾
    </button>
    <div v-if="open" class="menu" role="menu">
      <div v-for="(p, i) in layout.presets" :key="p.id" class="item-row">
        <button
          class="item"
          role="menuitemradio"
          :aria-checked="p.id === layout.activeId"
          :data-preset="p.id"
          @click="pick(p.id)"
        >
          <span class="check" aria-hidden="true">{{ p.id === layout.activeId ? '✓' : '' }}</span>
          <span class="label">{{ p.name }}</span>
          <kbd v-if="i < 9">Ctrl+Alt+{{ i + 1 }}</kbd>
        </button>
        <button v-if="!p.builtIn" class="delete" :aria-label="`Delete layout ${p.name}`" title="Delete this layout" @click="layout.remove(p.id)">×</button>
      </div>
      <hr />
      <button class="item" role="menuitem" @click="reset">
        <span class="check" />
        <span class="label">Reset “{{ layout.active.name }}”</span>
      </button>
      <form v-if="naming" class="naming" @submit.prevent="save">
        <input ref="nameInput" v-model="name" placeholder="Layout name" aria-label="Layout name" maxlength="40" />
        <button type="submit" class="tk-button primary" :disabled="!name.trim()">Save</button>
      </form>
      <button v-else class="item" role="menuitem" @click="startNaming">
        <span class="check" />
        <span class="label">Save layout as…</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.layout-menu { position: relative; }
.menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 50; min-width: 240px; padding: 4px; background: var(--tk-popup); border: 1px solid var(--tk-border); border-radius: var(--tk-radius); box-shadow: var(--tk-shadow); }
.item-row { display: flex; align-items: center; }
.item { flex: 1; display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 8px; border: 0; border-radius: var(--tk-radius-sm); background: none; text-align: left; }
.item:hover, .delete:hover { background: var(--tk-surface-2); }
.check { width: 12px; color: var(--tk-accent); }
.label { flex: 1; white-space: nowrap; }
kbd { font-family: var(--tk-font-mono); font-size: 11px; color: var(--tk-text-muted); }
.delete { border: 0; background: none; color: var(--tk-text-muted); padding: 2px 7px; border-radius: var(--tk-radius-sm); font-size: 14px; }
hr { border: 0; border-top: 1px solid var(--tk-border); margin: 4px 0; }
.naming { display: flex; gap: 6px; padding: 4px; }
.naming input { flex: 1; min-width: 0; padding: 3px 6px; background: var(--tk-bg); border: 1px solid var(--tk-border); border-radius: var(--tk-radius-sm); }
.naming input:focus { border-color: var(--tk-accent); outline: none; }
</style>
