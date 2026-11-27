// The "themes" built-in plugin: Tinkr's own themes, and the Appearance panel. Themes
// from plugins on disk use the same `api.themes.register` (or a JSON file in plugin.json).

import AppearancePanel from '../components/AppearancePanel.vue'
import type { TinkrApi } from '../plugins/api'
import type { BuiltInPlugin } from '../plugins/loader'
import { useAppearance } from '../stores/appearance'
import duskUrl from '../assets/themes/dusk.svg'
import paperUrl from '../assets/themes/paper.svg'
import { vueMount } from './vueMount'

function activate(api: TinkrApi) {
  // Tinkr's two color sets, fixed (not following the OS like "System").
  api.themes.register({ id: 'tinkr-dark', name: 'Tinkr Dark', kind: 'dark' })
  api.themes.register({ id: 'tinkr-light', name: 'Tinkr Light', kind: 'light' })

  // Only tokens: a cool blue variant of the dark set.
  api.themes.register({
    id: 'midnight',
    name: 'Midnight',
    kind: 'dark',
    tokens: {
      window: '#0d1117',
      bg: '#0d1117',
      surface: '#131a24',
      'surface-2': '#1a2330',
      border: '#263242',
      'text-muted': '#8b98a9',
      accent: '#58a6ff',
      'accent-hover': '#79b8ff',
      'on-accent': '#04121f',
      'user-bubble': '#16304d',
      'code-bg': '#0a0e14',
      focus: '#58a6ff80',
      selection: '#58a6ff33',
      'syntax-keyword': '#ff7b72',
      'syntax-function': '#d2a8ff',
    },
  })

  // An animated SVG behind see-through, blurred panels.
  api.themes.register({
    id: 'dusk',
    name: 'Dusk',
    kind: 'dark',
    tokens: { bg: '#15131c', surface: '#1b1824', 'surface-2': '#25212f', border: '#3a3346' },
    background: { image: duskUrl, size: 'cover' },
    translucency: 0.5,
    blur: 18,
  })

  // A light, tiled pattern, slightly see-through panels, no blur.
  api.themes.register({
    id: 'paper',
    name: 'Paper',
    kind: 'light',
    tokens: { bg: '#f4f1ea', surface: '#fbfaf6', 'surface-2': '#ece8de', border: '#d9d3c4' },
    background: { image: paperUrl, size: 'tile' },
    translucency: 0.2,
  })

  api.panels.register({ id: 'appearance', title: 'Appearance', location: 'right', mount: vueMount(AppearancePanel) })
  api.commands.register({ id: 'view.appearance', title: 'View: Appearance', run: () => api.layout.show('appearance') })
  api.commands.register({
    id: 'theme.next',
    title: 'Theme: switch to the next one',
    run() {
      const a = useAppearance()
      const i = a.themes.findIndex((t) => t.id === a.theme.id)
      a.select(a.themes[(i + 1) % a.themes.length].id)
    },
  })
  api.actions.register({ id: 'appearance', slot: 'statusbar', order: 5, title: 'Theme', tooltip: 'Themes and effects', run: () => api.layout.show('appearance') })
}

export const themes: BuiltInPlugin = {
  manifest: { name: 'themes', displayName: 'Themes', version: 'built-in' },
  activate,
}
