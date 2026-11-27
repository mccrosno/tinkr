// The docking layout (dockview): the built-in presets and the rules for showing,
// hiding, closing and moving panels. `Dock` wraps dockview's API behind the small
// `DockHost` interface the layout store uses, so the store is unit-tested with a fake.
//
// Panels come from the plugin registry (the built-in ones are plugins too): the dock
// asks it for a panel's title and default location (`PanelInfo`).
//
// Two ways for a panel to leave the screen:
// - Hiding hides its whole group (`group.api.setVisible(false)`), so it comes back in
//   the same place and size.
// - Closing takes the one panel out of the layout. Where it was is recorded first
//   (places.ts) and saved with the layout, so it comes back there.

import type { AddPanelOptions, DockviewApi, IDockviewPanel } from 'dockview-vue'
import type { PanelLocation } from '../plugins/api'
import { withGapShares } from './gap'
import { findSide, type Place } from './places'

/** A panel's id: a built-in one below, or "<plugin>.<id>". */
export type PanelId = string

/** The built-in panels the presets are made of. */
export const BUILT_IN_PANELS = ['chats', 'files', 'chat', 'editor', 'terminal'] as const

/** What the dock needs to know about a panel. */
export interface PanelInfo {
  title: string
  location: PanelLocation
}

/** dockview's component for every panel; DockLayout.vue renders it as a PanelHost. */
export const HOST_COMPONENT = 'host'

/** The space between panel cards, in px (dockview's theme gap). */
export const PANEL_GAP = 6

/** The built-in presets. Their ids are stable: saved arrangements are stored under them. */
export const BUILT_IN_PRESETS = [
  { id: 'agent', name: 'Agent' },
  { id: 'editor', name: 'Editor' },
] as const

export type BuiltInPresetId = (typeof BUILT_IN_PRESETS)[number]['id']

/** Which half of its group a panel splits off into. */
export type SplitSide = 'left' | 'right' | 'top' | 'bottom'
/** An outer edge of the whole dock. */
export type DockEdge = 'left' | 'right' | 'bottom'

/** What the layout store needs from the dock. */
export interface DockHost {
  /** Make a panel visible and (by default) its group's active tab. A closed one comes back to its last place. */
  show(id: PanelId, options?: { activate?: boolean }): void
  /** Hide the panel's group, keeping its place and size. */
  hide(id: PanelId): void
  /**
   * Put panels away without taking others with them: a group holding only these is
   * hidden; one holding other panels too just has these closed.
   */
  retract(ids: PanelId[]): void
  /**
   * The panel has nothing to show, or its shortcut hid it: if it's the one in front,
   * hide its card. A card with the chat on it stays, and just the panel is closed. A
   * background tab is left alone.
   */
  putAway(id: PanelId): void
  /** Take a panel out of the layout, remembering where it was. */
  close(id: PanelId): void
  /** Move a panel out of its group into a new one on that side of it. */
  split(id: PanelId, side: SplitSide): void
  /** Move a panel into a new group along an edge of the dock. */
  toEdge(id: PanelId, edge: DockEdge): void
  /** Visible and the active tab of its group. */
  isShown(id: PanelId): boolean
  /** In the layout and in a visible group (it may be a background tab). */
  isVisible(id: PanelId): boolean
  /** The ids of the panels in the layout. */
  panelIds(): PanelId[]
  /** The arrangement as JSON (dockview's own format, plus closed panels' places), to save. */
  snapshot(): unknown
  /** Load a saved arrangement. Returns false if it couldn't be used (the dock is then rebuilt). */
  restore(saved: unknown): boolean
  /** Lay out a built-in preset from scratch. */
  build(preset: BuiltInPresetId): void
  /** Which built-in preset's shape decides where a never-placed panel is added (custom presets use Agent's). */
  setHomeRules(preset: BuiltInPresetId): void
  /** Called after anything changes: a drag, a resize, a panel shown, hidden or closed. */
  onChange(listener: () => void): () => void
}

/** Default sizes (px), used when a preset is built. The editor's default is a share of the window. */
const SIDEBAR_WIDTH = 240
const RIGHT_WIDTH = 360
const TERMINAL_HEIGHT = 260
const CHAT_WIDTH_IN_EDITOR_PRESET = 420
const editorWidth = () => Math.round(window.innerWidth * 0.4)
/** Smaller than this when shown again = unusable (dockview squeezes hidden groups down to its 100px minimum); the default size is used instead. */
const MIN_BOTTOM_HEIGHT = 150
const MIN_EDITOR_WIDTH = 280
const MIN_WIDTH = 140

/** The other sidebar panel (Chats and Files share a group by default). */
const sibling = (id: 'chats' | 'files') => (id === 'chats' ? 'files' : 'chats')

export class Dock implements DockHost {
  /** Which built-in preset's rules decide where a never-placed panel is added. */
  private homeRules: BuiltInPresetId = 'agent'
  /** Where each closed panel was. Saved with the layout. */
  private places = new Map<PanelId, Place>()

  /** `info` is the registry's view of a panel; undefined = not registered (yet). */
  constructor(
    private api: DockviewApi,
    private info: (id: PanelId) => PanelInfo | undefined,
  ) {}

  setHomeRules(preset: BuiltInPresetId) {
    this.homeRules = preset
  }

  private panel(id: PanelId): IDockviewPanel | undefined {
    return this.api.getPanel(id)
  }

  private add(id: PanelId, position: AddPanelOptions['position'], extra: Partial<AddPanelOptions> = {}) {
    return this.api.addPanel({
      id,
      component: HOST_COMPONENT,
      params: { panel: id },
      title: this.info(id)?.title ?? id,
      ...(position ? { position } : {}),
      ...extra,
    } as AddPanelOptions)
  }

  /** Does the panel belong along the bottom (so its height is what matters)? */
  private isBottom(id: PanelId) {
    return id === 'terminal' || this.info(id)?.location === 'bottom'
  }

  private defaultSize(id: PanelId): { initialWidth?: number; initialHeight?: number } {
    if (this.isBottom(id)) return { initialHeight: TERMINAL_HEIGHT }
    if (id === 'editor') return { initialWidth: editorWidth() }
    const location = this.info(id)?.location
    if (location === 'center') return {}
    return { initialWidth: location === 'right' ? RIGHT_WIDTH : SIDEBAR_WIDTH }
  }

  /** Where a closed panel goes back to, if what it was next to is still there. */
  private lastPlace(id: PanelId): { position: AddPanelOptions['position']; size: Partial<AddPanelOptions> } | null {
    const place = this.places.get(id)
    if (!place) return null
    const mate = place.mates.find((m) => this.panel(m))
    if (mate) return { position: { referencePanel: mate, direction: 'within' }, size: {} }
    const side = place.side
    if (!side || (side.panel && !this.panel(side.panel))) return null
    const sideways = side.direction === 'left' || side.direction === 'right'
    return {
      position: side.panel ? { referencePanel: side.panel, direction: side.direction } : { direction: side.direction },
      size: sideways ? { initialWidth: place.width } : { initialHeight: place.height },
    }
  }

  /**
   * Where a panel goes when it has no last place: next to a panel that is in the
   * layout, following the current preset's shape.
   */
  private home(id: PanelId): AddPanelOptions['position'] {
    const has = (p: PanelId) => !!this.panel(p)
    const editorPreset = this.homeRules === 'editor'
    if (id === 'chat') {
      if (has('editor')) return { referencePanel: 'editor', direction: editorPreset ? 'right' : 'left' }
      return this.api.panels.length ? { direction: 'right' } : undefined
    }
    if (id === 'chats' || id === 'files') {
      if (has(sibling(id))) return { referencePanel: sibling(id), direction: 'within' }
      return { direction: 'left' } // the left edge of the whole layout
    }
    if (id === 'editor') {
      if (has('chat')) return { referencePanel: 'chat', direction: editorPreset ? 'left' : 'right' }
      return { direction: 'right' }
    }
    if (id === 'terminal') {
      // Under the editor in the Editor preset, else along the whole bottom.
      if (editorPreset && has('editor')) return { referencePanel: 'editor', direction: 'below' }
      return { direction: 'below' }
    }
    // A plugin's panel: by its declared location, next to the built-in panel that lives there.
    switch (this.info(id)?.location ?? 'right') {
      case 'left':
        return has('files') ? { referencePanel: 'files', direction: 'within' } : { direction: 'left' }
      case 'bottom':
        return has('terminal') ? { referencePanel: 'terminal', direction: 'within' } : { direction: 'below' }
      case 'center':
        return has('chat') ? { referencePanel: 'chat', direction: 'within' } : undefined
      default:
        return has('chat') ? { referencePanel: 'chat', direction: 'right' } : { direction: 'right' }
    }
  }

  show(id: PanelId, { activate = true } = {}) {
    const existing = this.panel(id)
    if (existing) {
      const group = existing.group.api
      if (!group.isVisible) {
        group.setVisible(true)
        // A hidden group comes back at its old size, which can be next to nothing (it was
        // squeezed while hidden, or saved that way). Below a usable size, use the default.
        const { initialWidth, initialHeight } = this.defaultSize(id)
        if (this.isBottom(id)) {
          if (group.height < MIN_BOTTOM_HEIGHT) group.setSize({ height: initialHeight })
        } else if (group.width < (id === 'editor' ? MIN_EDITOR_WIDTH : MIN_WIDTH) && initialWidth) {
          group.setSize({ width: initialWidth })
        }
      }
      if (activate) existing.api.setActive()
      return
    }
    const last = this.lastPlace(id)
    const added = this.add(id, last ? last.position : this.home(id), { ...(last ? last.size : this.defaultSize(id)), inactive: !activate })
    this.places.delete(id)
    // The panel it was put next to may be hidden; a new panel should be seen.
    if (!added.group.api.isVisible) added.group.api.setVisible(true)
  }

  hide(id: PanelId) {
    this.panel(id)?.group.api.setVisible(false)
  }

  retract(ids: PanelId[]) {
    for (const id of ids) {
      const p = this.panel(id)
      if (!p || !p.group.api.isVisible) continue
      if (p.group.panels.every((x) => ids.includes(x.id))) p.group.api.setVisible(false)
      else this.close(id)
    }
  }

  putAway(id: PanelId) {
    if (!this.isShown(id)) return
    const group = this.panel(id)!.group
    if (id !== 'chat' && group.panels.some((p) => p.id === 'chat')) this.close(id)
    else group.api.setVisible(false)
  }

  private placeOf(panel: IDockviewPanel): Place {
    const group = panel.group
    const mates = group.panels.filter((p) => p.id !== panel.id).map((p) => p.id)
    const mine = group.element.getBoundingClientRect()
    // A hidden group has no box to describe.
    if (!group.api.isVisible || !mine.width) return { mates, width: 0, height: 0 }
    const others = this.api.groups
      .filter((g) => g !== group && g.api.isVisible && g.panels.length)
      .map((g) => ({ panel: (g.activePanel ?? g.panels[0]).id, box: g.element.getBoundingClientRect() }))
    // The sizes a card is added with include its share of the gaps, which its box doesn't.
    const size = (px: number) => Math.round(px + PANEL_GAP / 2)
    return { mates, side: findSide(mine, others), width: size(mine.width), height: size(mine.height) }
  }

  close(id: PanelId) {
    const p = this.panel(id)
    if (!p) return
    const place = this.placeOf(p)
    if (place.mates.length || place.side) this.places.set(id, place)
    p.api.close()
  }

  split(id: PanelId, side: SplitSide) {
    const p = this.panel(id)
    // A panel alone in its group has nothing to split off from.
    if (!p || p.group.panels.length < 2) return
    p.api.moveTo({ group: p.group, position: side })
  }

  toEdge(id: PanelId, edge: DockEdge) {
    const p = this.panel(id)
    if (!p) return
    const group = this.api.addGroup({ direction: edge === 'bottom' ? 'below' : edge })
    p.api.moveTo({ group, position: 'center' })
    if (edge === 'bottom') p.group.api.setSize({ height: TERMINAL_HEIGHT })
    else p.group.api.setSize({ width: id === 'editor' ? editorWidth() : edge === 'left' ? SIDEBAR_WIDTH : RIGHT_WIDTH })
    p.api.setActive()
  }

  isShown(id: PanelId) {
    const p = this.panel(id)
    return !!p && p.group.api.isVisible && p.group.activePanel?.id === id
  }

  isVisible(id: PanelId) {
    const p = this.panel(id)
    return !!p && p.group.api.isVisible
  }

  panelIds() {
    return this.api.panels.map((p) => p.id)
  }

  snapshot() {
    const layout = this.api.toJSON()
    const root = withGapShares(layout.grid.root, PANEL_GAP) // see gap.ts
    return { ...layout, grid: { ...layout.grid, root }, tinkrPlaces: Object.fromEntries(this.places) }
  }

  restore(saved: unknown) {
    if (!saved || typeof saved !== 'object' || !('grid' in saved)) return false
    let tinkrPlaces: Record<string, Place> | undefined
    try {
      // A copy through JSON: the store hands over Vue's reactive objects, which
      // `structuredClone` refuses.
      const copy = JSON.parse(JSON.stringify(saved)) as Record<string, unknown> & { tinkrPlaces?: Record<string, Place> }
      const { tinkrPlaces: places, ...layout } = copy
      tinkrPlaces = places
      // Layouts saved before the interface refresh gave the chat a tab component that's gone.
      for (const p of Object.values((layout.panels ?? {}) as Record<string, { tabComponent?: string }>)) delete p.tabComponent
      this.api.fromJSON(layout as unknown as Parameters<DockviewApi['fromJSON']>[0])
    } catch {
      return false
    }
    this.places = new Map(Object.entries(tinkrPlaces ?? {}))
    // Panels nothing has registered (a plugin that's gone or disabled) are dropped.
    for (const p of [...this.api.panels]) if (!this.info(p.id)) p.api.close()
    return true
  }

  build(preset: BuiltInPresetId) {
    this.homeRules = preset
    this.places.clear()
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
