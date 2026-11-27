<script setup lang="ts">
// Title bar menu for layout presets: switch (Ctrl+Alt+1, 2, ...), reset the current one
// to its starting arrangement, save the current arrangement as a new preset, and
// delete saved ones. Opening, closing and keys are PopupBox's.
import { nextTick, ref } from 'vue'
import { UI_ICONS } from '../builtins/icons'
import { useLayout } from '../stores/layout'
import AppIcon from './AppIcon.vue'
import PopupBox from './PopupBox.vue'

const WIDTH = 240

const layout = useLayout()
const button = ref<HTMLButtonElement>()
const at = ref<{ x: number; y: number } | null>(null)
const naming = ref(false)
const name = ref('')
const nameInput = ref<HTMLInputElement>()

function close() {
  at.value = null
  naming.value = false
  name.value = ''
}

function toggle() {
  if (at.value) return close()
  const r = button.value!.getBoundingClientRect()
  at.value = { x: r.right - WIDTH, y: r.bottom + 4 }
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
</script>

<template>
  <button
    ref="button"
    type="button"
    class="tk-icon-button"
    :aria-label="`Layout: ${layout.active.name}`"
    :title="`Layout: ${layout.active.name}`"
    aria-haspopup="menu"
    :aria-expanded="!!at"
    data-testid="layout-menu"
    @click="toggle"
  >
    <AppIcon :icon="{ path: UI_ICONS.layout }" />
  </button>
  <PopupBox v-if="at" v-bind="at" class="layout-popup" label="Layout presets" :anchor="button" :style="{ width: `${WIDTH}px` }" @close="close">
    <div class="tk-menu-title">Layout</div>
    <div v-for="(p, i) in layout.presets" :key="p.id" class="item-row">
      <button type="button" class="tk-menu-item item" role="menuitemradio" :aria-checked="p.id === layout.activeId" :data-preset="p.id" @click="pick(p.id)">
        <span class="check" aria-hidden="true">{{ p.id === layout.activeId ? '✓' : '' }}</span>
        <span class="label">{{ p.name }}</span>
        <kbd v-if="i < 9">Ctrl+Alt+{{ i + 1 }}</kbd>
      </button>
      <button v-if="!p.builtIn" type="button" class="delete" :aria-label="`Delete layout ${p.name}`" title="Delete this layout" @click="layout.remove(p.id)">×</button>
    </div>
    <div class="tk-menu-sep" role="separator" />
    <button type="button" class="tk-menu-item item" role="menuitem" @click="reset">
      <span class="check" />
      <span class="label">Reset “{{ layout.active.name }}”</span>
    </button>
    <form v-if="naming" class="naming" @submit.prevent="save">
      <input ref="nameInput" v-model="name" placeholder="Layout name" aria-label="Layout name" maxlength="40" />
      <button type="submit" class="tk-button primary" :disabled="!name.trim()">Save</button>
    </form>
    <button v-else type="button" class="tk-menu-item item" role="menuitem" @click="startNaming">
      <span class="check" />
      <span class="label">Save layout as…</span>
    </button>
  </PopupBox>
</template>

<style scoped>
.item-row { display: flex; align-items: center; }
.item { flex: 1; min-width: 0; justify-content: flex-start; gap: 8px; }
.check { flex: none; width: 12px; color: var(--tk-accent); }
.label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.delete { flex: none; border: 0; background: none; color: var(--tk-text-muted); padding: 2px 7px; border-radius: var(--tk-radius-sm); font-size: 14px; }
.delete:hover { background: var(--tk-surface-2); }
.naming { display: flex; gap: 6px; padding: 4px; }
.naming input { flex: 1; min-width: 0; padding: 3px 6px; background: var(--tk-bg); border: 1px solid var(--tk-border); border-radius: var(--tk-radius-sm); }
.naming input:focus { border-color: var(--tk-accent); outline: none; }
</style>
