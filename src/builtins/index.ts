// Tinkr's built-in plugins: the Chat, Chats, Files, Editor and Terminal panels, the
// Console and Plugins panels, and "core" (the app's commands, shortcuts and titlebar
// buttons). They use the same `TinkrApi` as plugins on disk (SPEC.md: built-ins are
// plugins); the only difference is that they're compiled in and keep bare ids
// ("chat", not "chat.chat").

import { createApp, h, type Component } from 'vue'
import { pinia } from '../pinia'
import type { PanelDefinition, TinkrApi } from '../plugins/api'
import type { BuiltInPlugin } from '../plugins/loader'
import ChatList from '../components/ChatList.vue'
import ChatView from '../components/ChatView.vue'
import ConsolePanel from '../components/ConsolePanel.vue'
import EditorPanel from '../components/EditorPanel.vue'
import FilesPanel from '../components/FilesPanel.vue'
import PluginsPanel from '../components/PluginsPanel.vue'
import TerminalPanel from '../components/TerminalPanel.vue'
import { core } from './core'

/** A panel's `mount` that runs a Vue component as its own small app, sharing Tinkr's stores. */
export function vueMount(component: Component, props?: Record<string, unknown>): PanelDefinition['mount'] {
  return (el) => {
    // `tk-fill` (base.css): the component's root fills the panel (the container is a flex column).
    const app = createApp({ render: () => h(component, { ...props, class: 'tk-fill' }) })
    app.use(pinia)
    app.mount(el)
    return () => app.unmount()
  }
}

const builtIn = (name: string, displayName: string, activate: (api: TinkrApi) => void): BuiltInPlugin => ({
  manifest: { name, displayName, version: 'built-in' },
  activate,
})

export const BUILT_IN_PLUGINS: BuiltInPlugin[] = [
  core,
  builtIn('chat', 'Chat', (api) => {
    // The main window: no close button.
    api.panels.register({ id: 'chat', title: 'Chat', location: 'center', closable: false, mount: vueMount(ChatView) })
    api.panels.register({
      id: 'chats',
      title: 'Chats',
      location: 'left',
      // A chat of another folder opens that folder first (asks about unsaved work).
      mount: vueMount(ChatList, { onOpenElsewhere: (folder: string | null, id: string) => api.commands.execute('chat.openIn', folder, id) }),
    })
  }),
  builtIn('files', 'Files', (api) => {
    api.panels.register({ id: 'files', title: 'Files', location: 'left', mount: vueMount(FilesPanel) })
  }),
  builtIn('editor', 'Editor and review', (api) => {
    api.panels.register({ id: 'editor', title: 'Editor', location: 'right', mount: vueMount(EditorPanel) })
  }),
  builtIn('terminal', 'Terminal', (api) => {
    api.panels.register({ id: 'terminal', title: 'Terminal', location: 'bottom', mount: vueMount(TerminalPanel) })
  }),
  builtIn('console', 'Console', (api) => {
    api.panels.register({ id: 'console', title: 'Console', location: 'bottom', mount: vueMount(ConsolePanel) })
  }),
  builtIn('plugins', 'Plugin manager', (api) => {
    api.panels.register({ id: 'plugins', title: 'Plugins', location: 'right', mount: vueMount(PluginsPanel) })
  }),
]
