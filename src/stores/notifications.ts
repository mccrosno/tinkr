// Toasts: short messages in the corner (a plugin failed to load, something was saved).
// Errors stay until dismissed; the rest disappear after a few seconds.

import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface Toast {
  id: number
  level: 'info' | 'warn' | 'error'
  text: string
  /** Who said it (a plugin's display name). */
  source?: string
  /** Optional button, e.g. "Ask Claude to fix". */
  action?: { label: string; run: () => void }
}

const INFO_MS = 5000
let nextId = 1

export const useNotifications = defineStore('notifications', () => {
  const toasts = ref<Toast[]>([])

  function show(t: Omit<Toast, 'id'>) {
    const toast = { id: nextId++, ...t }
    toasts.value.push(toast)
    if (toasts.value.length > 5) toasts.value.shift()
    if (t.level !== 'error') setTimeout(() => dismiss(toast.id), INFO_MS)
    return toast.id
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  return { toasts, show, dismiss }
})
