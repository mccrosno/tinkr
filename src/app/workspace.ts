// Opening and closing folders, and opening a past chat in its own folder. The `core`
// built-in plugin registers these as commands (workspace.openFolder, chat.openIn, ...),
// so any plugin, button or shortcut uses the same path.

import { ask } from '@tauri-apps/plugin-dialog'
import { useChat } from '../stores/chat'
import { useEditor } from '../stores/editor'
import { useLayout } from '../stores/layout'
import { useReview } from '../stores/review'
import { useTerminal } from '../stores/terminal'
import { useWorkspace } from '../stores/workspace'
import { samePath } from '../workspace/fs'

/**
 * Ask before leaving the folder if that would discard unsaved edits or kill running
 * shells (a dev server, say). Returns true if it's OK to continue. Claude's unreviewed
 * changes stay on disk either way, so they don't need a warning.
 */
export async function confirmLeave() {
  const files = useEditor().dirtyCount
  const shells = useTerminal().runningCount
  if (!files && !shells) return true
  const lines = []
  if (files) lines.push(`You have unsaved changes in ${files} file(s).`)
  if (shells) lines.push(`${shells} open terminal(s) will be closed, stopping anything running in them.`)
  return ask(`${lines.join('\n')}\n\nContinue?`, {
    title: files ? 'Unsaved changes' : 'Close terminals',
    kind: 'warning',
    okLabel: files ? 'Discard changes' : 'Close terminals',
    cancelLabel: 'Cancel',
  })
}

/** Everything that belongs to the old folder: its tabs, terminals and pending review. */
function leaveFolder() {
  useEditor().closeAll()
  useTerminal().closeAll()
  useReview().clear()
}

/**
 * Open a folder (a path, or pick one). Opening it yourself brings the Files panel to
 * the front; `showFiles: false` leaves the panels as they are (when a chat from another
 * folder is being opened from the Chats list).
 */
export async function openFolder(path?: string, { showFiles = true } = {}) {
  if (!(await confirmLeave())) return
  const ws = useWorkspace()
  const before = ws.root
  if (path) await ws.openFolder(path)
  else await ws.pickAndOpen()
  if (ws.root !== before) {
    leaveFolder()
    if (showFiles) useLayout().show('files')
  }
}

export async function closeFolder() {
  if (!(await confirmLeave())) return
  leaveFolder()
  await useWorkspace().closeFolder()
}

/**
 * Open a chat from the all-folders list that belongs to another folder: switch to that
 * folder (or close the folder, for a chat without one) the usual way, which asks first
 * about unsaved edits and running terminals, then show the chat.
 */
export async function openChatIn(folder: string | null, sessionId: string) {
  const chat = useChat()
  const ws = useWorkspace()
  if (chat.busy) return
  if (folder === null) await closeFolder()
  else await openFolder(folder, { showFiles: false })
  const arrived = folder === null ? ws.root === null : !!ws.root && samePath(ws.root, folder)
  if (!arrived) {
    // Cancelled, or the folder couldn't be opened (moved or deleted): say so in the list.
    if (ws.error) chat.chatsError = `Couldn't open that chat's folder: ${ws.error}`
    return
  }
  await chat.setProject(ws.root)
  useLayout().show('chat') // it may have been closed
  await chat.openChat(sessionId)
}
