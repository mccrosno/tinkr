// The "core" built-in plugin: Tinkr's own commands and shortcuts, and keeping the
// editor and terminal panels in step with their stores. Registered through the plugin API like everything else, so a plugin can call
// any of these commands (e.g. api.commands.execute('workspace.openFolder', path)).

import { computed, watch } from 'vue'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { ui } from '../app/ui'
import { closeFolder, openChatIn, openFolder } from '../app/workspace'
import { pluginLoader, pluginsDir } from '../plugins/boot'
import type { TinkrApi } from '../plugins/api'
import type { BuiltInPlugin } from '../plugins/loader'
import { useChat } from '../stores/chat'
import { useEditor } from '../stores/editor'
import { useLayout } from '../stores/layout'
import { usePlugins } from '../stores/plugins'
import { useRail } from '../stores/rail'
import { useTerminal } from '../stores/terminal'
import { useWorkspace } from '../stores/workspace'

function activate(api: TinkrApi) {
  const chat = useChat()
  const editor = useEditor()
  const layout = useLayout()
  const terminal = useTerminal()
  const ws = useWorkspace()
  const plugins = usePlugins()
  const rail = useRail()
  const command = api.commands.register

  // --- Keeping the dock and the stores in agreement ------------------------------
  // The editor and terminal stores say whether they want to be seen (a file was opened,
  // a terminal started, Ctrl+`); the dock shows or hides the panel. The other way round,
  // closing a panel's tab in the dock tells the store it's hidden.
  const editorWanted = computed(() => editor.panelOpen && editor.tabs.length > 0)
  const terminalWanted = computed(() => terminal.visible && terminal.tabs.length > 0)
  watch(editorWanted, (on) => (on ? layout.show('editor') : layout.putAway('editor')))
  watch(terminalWanted, (on) => (on ? layout.show('terminal') : layout.putAway('terminal')))
  // Brought on screen from the dock (the rail, the panel list): the stores follow, and
  // a terminal with no shell yet starts one.
  watch(
    () => layout.shown.editor,
    (on) => {
      if (on && editor.tabs.length) editor.panelOpen = true
    },
  )
  watch(
    () => layout.shown.terminal,
    (on) => {
      if (!on || !ws.root) return
      if (terminal.tabs.length) terminal.visible = true
      else terminal.create(ws.root)
    },
  )
  watch(
    () => layout.visible.editor,
    (on) => {
      if (!on && editor.panelOpen) editor.panelOpen = false
    },
  )
  watch(
    () => layout.visible.terminal,
    (on) => {
      if (!on && terminal.visible) terminal.visible = false
    },
  )
  // After a preset is laid out: it may show an editor or terminal that has nothing to show.
  layout.onApplied(() => {
    if (editorWanted.value) layout.show('editor', { activate: false })
    else layout.putAway('editor')
    if (terminalWanted.value) layout.show('terminal', { activate: false })
    else layout.putAway('terminal')
  })
  // "Ask Claude", a file added or a plugin filling the message box: the chat must be on
  // screen, even if it was closed.
  watch(
    () => chat.focusRequests,
    () => layout.show('chat'),
  )
  // The chat works in the open folder; switching folders starts a new conversation.
  watch(
    () => ws.root,
    (root) => chat.setProject(root),
  )

  const sidebarShown = () => !!(layout.visible.chats || layout.visible.files)

  // --- Commands -----------------------------------------------------------------
  command({ id: 'workspace.openFolder', title: 'Open folder…', keybinding: 'Ctrl+O', run: (path) => openFolder(typeof path === 'string' ? path : undefined) })
  command({ id: 'workspace.closeFolder', title: 'Close folder', run: () => closeFolder() })
  command({
    id: 'chat.new',
    title: 'New chat',
    keybinding: 'Ctrl+N',
    run: () => {
      chat.newChat()
      layout.show('chat')
    },
  })
  command({
    id: 'chat.open',
    title: 'Open a chat',
    hidden: true,
    run: (id) => {
      layout.show('chat')
      return chat.openChat(String(id))
    },
  })
  command({ id: 'chat.openIn', title: 'Open a chat in its folder', hidden: true, run: (folder, id) => openChatIn(folder as string | null, id as string) })
  command({
    id: 'layout.toggleSidebar',
    title: 'Show or hide Chats and Files',
    keybinding: 'Ctrl+B',
    run() {
      if (sidebarShown()) layout.retract('chats', 'files')
      else {
        layout.show('files', { activate: false })
        layout.show('chats', { activate: false })
      }
    },
  })
  command({ id: 'view.toggleRail', title: 'Show or hide the side bar', keybinding: 'Ctrl+Shift+B', run: () => rail.toggleCollapsed() })
  command({
    id: 'editor.toggle',
    title: 'Show or hide the editor',
    keybinding: 'Ctrl+Shift+E',
    run() {
      if (!editor.tabs.length) return
      if (editor.panelOpen && layout.shown.editor) editor.panelOpen = false
      else {
        editor.panelOpen = true
        layout.show('editor') // also brings it to the front if it's a background tab
      }
    },
  })
  command({
    id: 'terminal.toggle',
    title: 'Show or hide the terminal',
    keybinding: 'Ctrl+`',
    run: () => {
      if (ws.root) terminal.toggle(ws.root)
    },
  })
  for (let n = 1; n <= 9; n++) {
    command({
      id: `layout.preset${n}`,
      title: `Switch to layout ${n}`,
      keybinding: `Ctrl+Alt+${n}`,
      hidden: true,
      run: () => {
        const id = layout.presetForKey(n)
        if (id) layout.switchTo(id)
      },
    })
  }
  command({ id: 'layout.reset', title: 'Layout: reset the current layout', run: () => layout.reset() })
  command({
    id: 'layout.copyJson',
    title: 'Layout: copy as JSON (for a plugin preset)',
    run: async () => {
      await navigator.clipboard.writeText(JSON.stringify(layout.snapshot(), null, 2))
      api.notifications.info('The layout is on the clipboard.')
    },
  })
  command({ id: 'commands.palette', title: 'Show all commands', keybinding: 'Ctrl+Shift+P', run: () => (ui.paletteOpen = true) })
  for (const [id, title] of [
    ['chat', 'Chat'],
    ['chats', 'Chats'],
    ['files', 'Files'],
    ['console', 'Console'],
    ['plugins', 'Plugins'],
  ] as const) {
    command({ id: `view.${id}`, title: `View: ${title}`, run: () => layout.show(id) })
  }
  command({
    id: 'plugins.reloadAll',
    title: 'Plugins: reload all',
    run: async () => {
      for (const p of plugins.plugins) if (!p.builtIn && p.state !== 'disabled' && p.state !== 'awaiting-approval') await pluginLoader()?.reload(p.name)
    },
  })
  command({ id: 'plugins.reload', title: 'Reload a plugin', hidden: true, run: (name) => pluginLoader()?.reload(String(name)) })
  command({
    id: 'plugins.openFolder',
    title: 'Plugins: open the plugins folder',
    run: async () => {
      const dir = pluginsDir()
      if (dir) await revealItemInDir(dir)
    },
  })
}

export const core: BuiltInPlugin = {
  manifest: { name: 'core', displayName: 'Core commands', version: 'built-in' },
  activate,
}
