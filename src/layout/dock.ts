// The docking layout (dockview): which panels exist, the built-in presets, and the
// rules for showing and hiding a panel. `Dock` wraps dockview's API behind the small
// `DockHost` interface the layout store uses, so the store is unit-tested with a fake.
//
// Hiding a panel hides its whole group (`group.api.setVisible(false)`) instead of
// removing the panel, so it comes back in the same place and size. The one exception
// is a panel stacked in the same group as the chat: the chat can't be hidden, so that
// panel is closed instead and comes back at its "home" position.

import type { AddPanelOptions, DockviewApi, IDockviewPanel } from 'dockview-vue'

export type PanelId = 'chats' | 'files' | 'chat' | 'editor' | 'terminal'

export const PANELS: Record<PanelId, { title: string; closable: boolean }> = {
  chats: { title: 'Chats', closable: true },
  files: { title: 'Files', closable: true },
  // The main window: it has no close button (see the "pinned" tab in DockLayout.vue).
  chat: { title: 'Chat', closable: false },
  editor: { title: 'Editor', closable: true },
  terminal: { title: 'Terminal', closable: true },
}

export const PANEL_IDS = Object.keys(PANELS) as PanelId[]

/** The built-in presets. Their ids are stable: saved arrangements are stored under them. */
export const BUILT_IN_PRESETS = [
  { id: 'agent', name: 'Agent' },
  { id: 'editor', name: 'Editor' },
] as const

export type BuiltInPresetId = (typeof BUILT_IN_PRESETS)[number]['id']

/** What the layout store needs from the dock. */
export interface DockHost {
  /** Make a panel visible and (by default) its group's active tab. Adds it at its home position if it isn't in the layout. */
  show(id: PanelId, options?: { activate?: boolean }): void
  hide(id: PanelId): void
  /** Visible and the active tab of its group. */
  isShown(id: PanelId): boolean
  /** In the layout and in a visible group (it may be a background tab). */
  isVisible(id: PanelId): boolean
  /** The arrangement as JSON (dockview's own format), to save. */
  snapshot(): unknown
  /** Load a saved arrangement. Returns false if it couldn't be used (the dock is then rebuilt). */
  restore(saved: unknown): boolean
  /** Lay out a built-in preset from scratch. */
  build(preset: BuiltInPresetId): void
  /** Which built-in preset's shape decides where a missing panel is added (custom presets use Agent's). */
  setHomeRules(preset: BuiltInPresetId): void
  /** Called after anything changes: a drag, a resize, a panel shown, hidden or closed. */
  onChange(listener: () => void): () => void
}

/** Default sizes (px), used when a preset is built. The editor's default is a share of the window. */
const SIDEBAR_WIDTH = 240
const TERMINAL_HEIGHT = 260
const CHAT_WIDTH_IN_EDITOR_PRESET = 420
const editorWidth = () => Math.round(window.innerWidth * 0.4)
/** Smaller than this when shown again = unusable (dockview squeezes hidden groups down to its 100px minimum); the default size is used instead. */
const MIN_TERMINAL_HEIGHT = 150
const MIN_EDITOR_WIDTH = 280
const MIN_SIDEBAR_WIDTH = 140

/** The other sidebar panel (Chats and Files share a group by default). */
const sibling = (id: 'chats' | 'files') => (id === 'chats' ? 'files' : 'chats')

export class Dock implements DockHost {
  /** Which built-in preset's rules decide where a missing panel is added. */
  private homeRules: BuiltInPresetId = 'agent'

  constructor(private api: DockviewApi) {}

  setHomeRules(preset: BuiltInPresetId) {
    this.homeRules = preset
  }

  private panel(id: PanelId): IDockviewPanel | undefined {
    return this.api.getPanel(id)
  }

  private add(id: PanelId, position: AddPanelOptions['position'], extra: Partial<AddPanelOptions> = {}) {
    return this.api.addPanel({
      id,
      component: id,
      title: PANELS[id].title,
      tabComponent: PANELS[id].closable ? undefined : 'pinned',
      ...(position ? { position } : {}),
      ...extra,
    } as AddPanelOptions)
  }

  /**
   * Where a panel goes when it isn't in the layout: next to a panel that is, following
   * the current preset's shape (the chat is always there, so it's the fallback anchor).
   */
  private home(id: PanelId): AddPanelOptions['position'] {
    const has = (p: PanelId) => !!this.panel(p)
    if (id === 'chat') return undefined
    if (id === 'chats' || id === 'files') {
      if (has(sibling(id))) return { referencePanel: sibling(id), direction: 'within' }
      return { direction: 'left' } // the left edge of the whole layout
    }
    if (id === 'editor') {
      return this.homeRules === 'editor' ? { referencePanel: 'chat', direction: 'left' } : { referencePanel: 'chat', direction: 'right' }
    }
    // Terminal: under the editor in the Editor preset, else along the whole bottom.
    if (this.homeRules === 'editor' && has('editor')) return { referencePanel: 'editor', direction: 'below' }
    return { direction: 'below' }
  }

  show(id: PanelId, { activate = true } = {}) {
    const existing = this.panel(id)
    if (existing) {
      const group = existing.group.api
      if (!group.isVisible) {
        group.setVisible(true)
        // A hidden group comes back at its old size, which can be next to nothing (it was
        // squeezed while hidden, or saved that way). Below a usable size, use the default.
        if (id === 'terminal' && group.height < MIN_TERMINAL_HEIGHT) group.setSize({ height: TERMINAL_HEIGHT })
        if (id === 'editor' && group.width < MIN_EDITOR_WIDTH) group.setSize({ width: editorWidth() })
        if ((id === 'chats' || id === 'files') && group.width < MIN_SIDEBAR_WIDTH) group.setSize({ width: SIDEBAR_WIDTH })
      }
      if (activate) existing.api.setActive()
      return
    }
    const size = id === 'terminal' ? { initialHeight: TERMINAL_HEIGHT } : id === 'editor' ? { initialWidth: editorWidth() } : { initialWidth: SIDEBAR_WIDTH }
    this.add(id, this.home(id), { ...size, inactive: !activate })
  }

  hide(id: PanelId) {
    const p = this.panel(id)
    if (!p || id === 'chat') return
    // The chat's group can't be hidden; take just this panel out of it.
    if (p.group.panels.some((x) => x.id === 'chat')) p.api.close()
    else p.group.api.setVisible(false)
  }

  isShown(id: PanelId) {
    const p = this.panel(id)
    return !!p && p.group.api.isVisible && p.group.activePanel?.id === id
  }

  isVisible(id: PanelId) {
    const p = this.panel(id)
    return !!p && p.group.api.isVisible
  }

  snapshot() {
    return this.api.toJSON()
  }

  restore(saved: unknown) {
    try {
      this.api.fromJSON(saved as Parameters<DockviewApi['fromJSON']>[0])
    } catch {
      return false
    }
    // A layout without the chat isn't usable (it may come from an older version).
    if (!this.panel('chat')) return false
    // Panels Tinkr doesn't know (from a newer version, say) are dropped.
    for (const p of [...this.api.panels]) if (!(p.id in PANELS)) p.api.close()
    return true
  }

  build(preset: BuiltInPresetId) {
    this.homeRules = preset
    this.api.clear()
    if (preset === 'agent') {
      // [ Chats | Files ] [ Chat ] [ Editor ]
      // [ Terminal, along the bottom        ]
      this.add('chat', undefined)
      this.add('chats', { referencePanel: 'chat', direction: 'left' }, { initialWidth: SIDEBAR_WIDTH })
      this.add('files', { referencePanel: 'chats', direction: 'within' }, { inactive: true })
      this.add('editor', { referencePanel: 'chat', direction: 'right' }, { initialWidth: editorWidth(), inactive: true })
      this.add('terminal', { direction: 'below' }, { initialHeight: TERMINAL_HEIGHT, inactive: true })
      this.panel('chats')?.api.setActive()
    } else {
      // [ Files | Chats ] [ Editor   ] [ Chat ]
      //                   [ Terminal ]
      this.add('editor', undefined)
      this.add('files', { referencePanel: 'editor', direction: 'left' }, { initialWidth: SIDEBAR_WIDTH })
      this.add('chats', { referencePanel: 'files', direction: 'within' }, { inactive: true })
      this.add('chat', { referencePanel: 'editor', direction: 'right' }, { initialWidth: CHAT_WIDTH_IN_EDITOR_PRESET })
      this.add('terminal', { referencePanel: 'editor', direction: 'below' }, { initialHeight: TERMINAL_HEIGHT, inactive: true })
      this.panel('files')?.api.setActive()
    }
    // New splits come out at odd sizes (spike 2), so set the fixed ones again.
    this.panel('chats')?.group.api.setSize({ width: SIDEBAR_WIDTH })
    this.panel('terminal')?.group.api.setSize({ height: TERMINAL_HEIGHT })
    if (preset === 'agent') this.panel('editor')?.group.api.setSize({ width: editorWidth() })
    else this.panel('chat')?.group.api.setSize({ width: CHAT_WIDTH_IN_EDITOR_PRESET })
    this.panel('chat')?.api.setActive()
  }

  onChange(listener: () => void) {
    const subs = [
      this.api.onDidLayoutChange(listener),
      this.api.onDidActivePanelChange(listener),
      this.api.onDidRemovePanel(listener),
      this.api.onDidAddPanel(listener),
    ]
    return () => subs.forEach((s) => s.dispose())
  }
}
