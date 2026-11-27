// Appearance: which theme is on, and whether to reduce effects. Themes come from
// plugins (the built-in ones from the "themes" built-in plugin); the choice is kept in
// settings.json. If the chosen theme's plugin is gone or off, "System" is shown, and
// the choice comes back when the plugin does.

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { SYSTEM_THEME, applyTheme, type ResolvedTheme } from '../theme/apply'
import { SLOW_FRAME_MS, measureFrames } from '../theme/probe'
import { useNotifications } from './notifications'
import { usePlugins } from './plugins'
import { useSettings } from './settings'

const KEY_THEME = 'appearance.theme'
const KEY_REDUCE = 'appearance.reduceEffects'
const KEY_PROBE = 'appearance.blurProbe'

export const useAppearance = defineStore('appearance', () => {
  const plugins = usePlugins()
  const settings = useSettings()

  /** Every theme to choose from: System first, then what plugins registered. */
  const themes = computed<ResolvedTheme[]>(() => [SYSTEM_THEME, ...plugins.themes])
  const selectedId = computed(() => settings.appValue<string>(KEY_THEME, 'system'))
  /** null = never decided (the blur check decides the first time a theme uses blur). */
  const reduceEffects = computed(() => settings.appValue<boolean | null>(KEY_REDUCE, null))
  const theme = computed(() => themes.value.find((t) => t.id === selectedId.value) ?? SYSTEM_THEME)
  /** Bumped after each apply, for things that copy colors out of CSS (the terminal). */
  const revision = ref(0)
  const probing = ref(false)

  function select(id: string) {
    settings.setAppValue(KEY_THEME, id === 'system' ? undefined : id)
  }

  function setReduceEffects(on: boolean) {
    settings.setAppValue(KEY_REDUCE, on)
  }

  function apply() {
    applyTheme(theme.value, reduceEffects.value === true)
    revision.value++
  }

  /**
   * The first time a theme with blur is on: time ~1 s of frames with the blurred page
   * redrawing. If it's slow, turn effects down (and say so); either way, remember.
   */
  async function probeIfNeeded() {
    const t = theme.value
    if (probing.value || reduceEffects.value !== null || !t.blur || !t.background || !t.translucency) return
    probing.value = true
    try {
      const layer = document.querySelector<HTMLElement>('.tk-background')
      const p95 = await measureFrames(1000, (frame) => {
        // A sub-pixel shift: invisible, but everything under the blur must redraw.
        if (layer) layer.style.transform = frame % 2 ? 'translateX(0.5px)' : ''
      })
      if (layer) layer.style.transform = ''
      const slow = p95 > SLOW_FRAME_MS
      settings.setAppValue(KEY_PROBE, { p95: Math.round(p95 * 10) / 10, at: Date.now() })
      setReduceEffects(slow)
      if (slow)
        useNotifications().show({
          level: 'info',
          text: `Blur is turned off: this computer draws it slowly (${Math.round(p95)} ms a frame). You can turn it back on in Appearance.`,
        })
    } finally {
      probing.value = false
    }
  }

  /** Start following the settings: apply now and after every change. */
  function start() {
    watch([theme, reduceEffects], apply, { immediate: true })
    // Re-apply when the OS switches light/dark (the System theme follows it; others read base colors).
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', apply)
    watch(theme, () => setTimeout(() => void probeIfNeeded(), 1500), { immediate: true })
  }

  return { themes, theme, selectedId, reduceEffects, revision, probing, select, setReduceEffects, start, probeIfNeeded }
})
