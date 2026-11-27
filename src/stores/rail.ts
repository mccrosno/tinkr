// The rail left of the dock: which panels are pinned to it, and whether it's collapsed.
// A pin is only a shortcut (the panel can be anywhere in the dock), so pins are the
// same in every layout preset. Both are kept in settings.json.

import { defineStore } from 'pinia'
import { computed } from 'vue'
import type { PanelId } from '../layout/dock'
import { useSettings } from './settings'

export const DEFAULT_PINS: PanelId[] = ['chat', 'chats', 'files', 'editor', 'terminal', 'console']

export const useRail = defineStore('rail', () => {
  const settings = useSettings()
  /** Pinned panel ids, top to bottom. One whose plugin is off stays pinned; it just isn't drawn. */
  const pins = computed<PanelId[]>(() => {
    const saved = settings.appValue<unknown>('rail.pins', DEFAULT_PINS)
    // settings.json can be edited by hand.
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : DEFAULT_PINS
  })
  const collapsed = computed(() => settings.appValue<unknown>('rail.collapsed', false) === true)

  const isPinned = (id: PanelId) => pins.value.includes(id)

  function pin(id: PanelId) {
    if (!isPinned(id)) settings.setAppValue('rail.pins', [...pins.value, id])
  }
  function unpin(id: PanelId) {
    if (isPinned(id)) settings.setAppValue('rail.pins', pins.value.filter((p) => p !== id))
  }
  function togglePin(id: PanelId) {
    if (isPinned(id)) unpin(id)
    else pin(id)
  }
  function toggleCollapsed() {
    settings.setAppValue('rail.collapsed', collapsed.value ? undefined : true)
  }

  return { pins, collapsed, isPinned, pin, unpin, togglePin, toggleCollapsed }
})
