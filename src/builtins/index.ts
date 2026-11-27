// Tinkr's built-in plugins: the Chat, Chats, Files, Editor and Terminal panels, the
// Console and Plugins panels, and "core" (the app's commands and shortcuts). They use
// the same `TinkrApi` as plugins on disk (SPEC.md: built-ins are plugins); the only
// difference is that they're compiled in and keep bare ids ("chat", not "chat.chat").

import type { TinkrApi } from '../plugins/api'
import type { BuiltInPlugin } from '../plugins/loader'
import ChatList from '../components/ChatList.vue'
import ChatView from '../components/ChatView.vue'
import ConsolePanel from '../components/ConsolePanel.vue'
import EditorPanel from '../components/EditorPanel.vue'
import FilesPanel from '../components/FilesPanel.vue'
import PluginsPanel from '../components/PluginsPanel.vue'
import TerminalPanel from '../components/TerminalPanel.vue'
import { useChat } from '../stores/chat'
import { useEditor } from '../stores/editor'
import { usePlugins } from '../stores/plugins'
import { useWorkspace } from '../stores/workspace'
import { core } from './core'
import { PANEL_ICONS as icon } from './icons'
import { themes } from './themes'
import { vueMount } from './vueMount'

const builtIn = (name: string, displayName: string, activate: (api: TinkrApi) => void): BuiltInPlugin => ({
  manifest: { name, displayName, version: 'built-in' },
  activate,
})

export const BUILT_IN_PLUGINS: BuiltInPlugin[] = [
  core,
  themes,
  builtIn('chat', 'Chat', (api) => {
    api.panels.register({
      id: 'chat',
      title: 'Chat',
      location: 'center',
      icon: icon.chat,
      // Claude waits for an answer to a permission request, which a closed chat would hide.
      badge: () => useChat().pendingPermissions > 0,
      mount: vueMount(ChatView),
    })
    api.panels.register({
      id: 'chats',
      title: 'Chats',
      location: 'left',
      icon: icon.chats,
      // A chat of another folder opens that folder first (asks about unsaved work).
      mount: vueMount(ChatList, { onOpenElsewhere: (folder: string | null, id: string) => api.commands.execute('chat.openIn', folder, id) }),
    })
  }),
  builtIn('files', 'Files', (api) => {
    api.panels.register({ id: 'files', title: 'Files', location: 'left', icon: icon.files, mount: vueMount(FilesPanel) })
  }),
  builtIn('editor', 'Editor and review', (api) => {
    const isEnabled = () => useEditor().tabs.length > 0
    api.panels.register({ id: 'editor', title: 'Editor', location: 'right', icon: icon.editor, isEnabled, mount: vueMount(EditorPanel) })
  }),
  builtIn('terminal', 'Terminal', (api) => {
    const isEnabled = () => !!useWorkspace().root
    api.panels.register({ id: 'terminal', title: 'Terminal', location: 'bottom', icon: icon.terminal, isEnabled, mount: vueMount(TerminalPanel) })
  }),
  builtIn('console', 'Console', (api) => {
    const badge = () => usePlugins().log.some((l) => l.level === 'error')
    api.panels.register({ id: 'console', title: 'Console', location: 'bottom', icon: icon.console, badge, mount: vueMount(ConsolePanel) })
  }),
  builtIn('plugins', 'Plugin manager', (api) => {
    api.panels.register({ id: 'plugins', title: 'Plugins', location: 'right', icon: icon.plugins, mount: vueMount(PluginsPanel) })
  }),
]
