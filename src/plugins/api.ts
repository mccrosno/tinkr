// The plugin API: what a plugin's `activate(api)` receives. This file is the public
// contract. It has no imports, so it can be shipped to plugin authors as-is
// (tinkr-api.d.ts). Tinkr's built-in panels use the same API.
//
// A plugin is a folder in ~/.config/tinkr/plugins/<name>/ with a plugin.json and an
// ES module:
//
//   plugin.json:  { "name": "notes", "displayName": "Notes", "version": "0.1.0",
//                   "main": "index.js", "permissions": ["agent"] }
//   index.js:     export function activate(api) {
//                   api.panels.register({ id: 'notes', title: 'Notes', location: 'right',
//                     mount(el) { el.textContent = 'Hello'; return () => {} } })
//                 }
//
// Everything a plugin registers is removed when it's unloaded (disabled, deleted, or
// reloaded after a change on disk), so plugins rarely need cleanup code of their own.

/** Something that can be undone; `register` calls return one. */
export interface Disposable {
  dispose(): void
}

/** `permissions` a plugin asks for in plugin.json. Plugins are trusted code: this keeps each to what it needs, but isn't a security boundary. */
export type Permission =
  /** Read and write files in the open project folder (`api.workspace` file access). */
  | 'fs'
  /** Run commands in Tinkr's terminal (`api.terminal`). */
  | 'pty'
  /** Talk to Claude: send messages, add references, read the conversation (`api.agent`). */
  | 'agent'

/** The contents of plugin.json. */
export interface PluginManifest {
  /** Must match the folder name. Letters, digits, `-`, `_`, `.`. */
  name: string
  displayName?: string
  version?: string
  description?: string
  /** The ES module to load, relative to the folder. Default "index.js". */
  main?: string
  permissions?: Permission[]
  /** Informational list of what the plugin adds (shown in the Plugins panel). */
  contributes?: { panels?: string[]; commands?: string[]; actions?: string[]; themes?: string[]; layouts?: string[] }
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

/** Where a panel goes the first time it's shown (the user can drag it anywhere after). */
export type PanelLocation = 'left' | 'right' | 'bottom' | 'center'

export interface PanelContext {
  /** The panel's id (for a plugin's panel: "<plugin>.<id>"). */
  readonly id: string
  /** True while the panel is on screen (visible and the front tab of its group). */
  readonly visible: boolean
  /** Called when `visible` changes. Returns a Disposable. */
  onDidChangeVisibility(listener: (visible: boolean) => void): Disposable
  /** Change the tab's title. */
  setTitle(title: string): void
}

export interface PanelDefinition {
  /** Unique within the plugin. */
  id: string
  title: string
  /** Default "right". */
  location?: PanelLocation
  /** Whether the tab has a close button. Default true. */
  closable?: boolean
  /**
   * Build the panel's content in `el`, with any framework or none. Called once per
   * registration: the element is moved, not rebuilt, when the panel is dragged or the
   * layout changes. Return a cleanup function; it runs when the panel is unregistered.
   */
  mount(el: HTMLElement, ctx: PanelContext): (() => void) | void
}

// ---------------------------------------------------------------------------
// Commands and actions
// ---------------------------------------------------------------------------

export interface CommandDefinition {
  /** Unique within the plugin. A plugin's command is called as "<plugin>.<id>". */
  id: string
  /** Shown in the command palette (Ctrl+Shift+P). */
  title: string
  /** e.g. "Ctrl+Alt+K", "Ctrl+Shift+P". "Ctrl" means Cmd on macOS too. */
  keybinding?: string
  /** Leave it out of the command palette (for commands that need arguments). */
  hidden?: boolean
  run(...args: unknown[]): unknown
}

/**
 * Where an action's button appears.
 * - "titlebar", "statusbar": the window's top and bottom bars.
 * - "chat-toolbar": the row under the message box.
 * - "selection": the menu for selected code (popup, right-click). Its `run` gets the selection.
 */
export type ActionSlot = 'titlebar' | 'statusbar' | 'chat-toolbar' | 'selection'

/** What a "selection" action receives. */
export interface SelectionInfo {
  /** Absolute path of the file. */
  path: string
  /** 1-based, inclusive. */
  fromLine: number
  toLine: number
  text: string
}

export interface ActionDefinition {
  /** Unique within the plugin. */
  id: string
  slot: ActionSlot
  /** The button's label. */
  title: string
  /** Tooltip. */
  tooltip?: string
  /** Lower comes first (default 100). */
  order?: number
  run(selection?: SelectionInfo): unknown
  /** Shown pressed (a toggle that's on). Read on every redraw, so keep it cheap. */
  isActive?(): boolean
  /** False = greyed out. */
  isEnabled?(): boolean
  /** False = not shown at all. */
  isVisible?(): boolean
}

// ---------------------------------------------------------------------------
// Host APIs
// ---------------------------------------------------------------------------

/** The open project folder. File access needs the "fs" permission. */
export interface WorkspaceApi {
  /** Absolute path of the open folder, or null. */
  root(): string | null
  onDidChangeRoot(listener: (root: string | null) => void): Disposable
  /** Files changed on disk (absolute paths). */
  onDidChangeFiles(listener: (paths: string[]) => void): Disposable
  /** Paths are absolute, or relative to the open folder. Only files inside it can be read or written. */
  readText(path: string): Promise<string>
  writeText(path: string, text: string): Promise<void>
  /** Names in a folder; `isDir` for subfolders. */
  readDir(path: string): Promise<{ name: string; isDir: boolean }[]>
}

export interface EditorApi {
  /** Open a file in Tinkr's editor (shows the editor panel). */
  open(path: string): Promise<void>
  /** Path of the file in front, or null. */
  activePath(): string | null
}

/** Needs the "agent" permission. */
export interface AgentApi {
  /** Send a message to Claude in the current chat, as if typed. False if it couldn't be sent (busy, not ready). */
  send(text: string): Promise<boolean>
  /** Put text in the message box (replacing what's there) and focus it, without sending. */
  setDraft(text: string): void
  /** Add a code reference chip to the message box (like "Ask Claude" on a selection). */
  addReference(ref: { path: string; fromLine: number; toLine: number; text: string; purpose?: 'question' | 'change' }): void
  /** True while Claude is replying. */
  busy(): boolean
  /** Claude's replies as they stream (`text`), and when each turn ends (`done`). */
  onDidReceive(listener: (event: { type: 'text'; text: string } | { type: 'done'; outcome: 'success' | 'aborted' | 'error' }) => void): Disposable
}

/** Needs the "pty" permission. */
export interface TerminalApi {
  /** Open a new terminal tab in the project folder and show the terminal. */
  create(): Promise<void>
  /** Type text into the terminal in front (add "\r" to press Enter). */
  sendText(text: string): Promise<void>
}

export interface LayoutApi {
  /** Show a panel (bringing it to the front), hide it, or switch between the two. Ids as given to `panels.register` (prefixed for plugins). */
  show(panelId: string): void
  hide(panelId: string): void
  toggle(panelId: string): void
  /**
   * Add a layout preset to the Layout menu. `layout` is a dockview layout (JSON); get
   * one by arranging panels and running the "Copy layout as JSON" command.
   */
  registerPreset(preset: { id: string; name: string; layout: unknown }): Disposable
}

/** Per-plugin settings, kept in ~/.config/tinkr/settings.json. Values must be JSON. */
export interface SettingsApi {
  get<T>(key: string, fallback: T): T
  set(key: string, value: unknown): Promise<void>
  onDidChange(listener: (key: string) => void): Disposable
}

export interface NotificationsApi {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

/** Messages in Tinkr's Console panel, under the plugin's name. */
export interface LogApi {
  info(...parts: unknown[]): void
  warn(...parts: unknown[]): void
  error(...parts: unknown[]): void
}

export interface TinkrApi {
  /** The API's version; bumped when something changes incompatibly. */
  readonly version: 1
  /** This plugin. */
  readonly plugin: { readonly name: string; readonly dir: string | null; readonly manifest: PluginManifest }
  panels: { register(panel: PanelDefinition): Disposable }
  commands: {
    register(command: CommandDefinition): Disposable
    /** Run any command by its full id (e.g. "workspace.openFolder", "notes.refresh"). */
    execute(id: string, ...args: unknown[]): Promise<unknown>
  }
  actions: { register(action: ActionDefinition): Disposable }
  layout: LayoutApi
  workspace: WorkspaceApi
  editor: EditorApi
  /** Throws unless plugin.json lists "agent" in `permissions`. */
  agent: AgentApi
  /** Throws unless plugin.json lists "pty" in `permissions`. */
  terminal: TerminalApi
  settings: SettingsApi
  notifications: NotificationsApi
  log: LogApi
}

/** What a plugin module exports. */
export interface PluginModule {
  activate(api: TinkrApi): void | Promise<void>
  /** Optional: runs before unloading, after which everything the plugin registered is removed anyway. */
  deactivate?(): void | Promise<void>
}
