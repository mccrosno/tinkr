import { createApp } from 'vue'
import App from './App.vue'
import { ClaudeSidecarProvider } from './agent/claudeSidecar'
import { pinia } from './pinia'
import { openFolder } from './app/workspace'
import { bootPlugins } from './plugins/boot'
import { useChat } from './stores/chat'
import { useEditor } from './stores/editor'
import { useReview } from './stores/review'
import { useWorkspace } from './stores/workspace'
import './styles/tokens.css'
import './styles/base.css'
import './styles/dock.css'

const app = createApp(App)
app.use(pinia)
app.mount('#app')

// Dev only: expose the stores for e2e scripts that drive the window over CDP.
// `__tinkrOpenFolder`: folder pickers can't be driven over CDP.
if (import.meta.env.DEV) Object.assign(window, { __tinkr: { pinia }, __tinkrOpenFolder: (p: string) => openFolder(p) })

// Wiring between stores that doesn't belong to any one panel.
const chat = useChat()
const ws = useWorkspace()
const editor = useEditor()
const review = useReview()
ws.onFilesChanged((paths) => {
  editor.onDiskChange(paths)
  review.onDiskChange(paths)
})
// Claude's edits: the review store keeps baselines; changed files open in the editor so
// you can watch them change.
chat.onFileEvent((e) => review.onAgentFile(e))
review.onChanged(async (path) => {
  await editor.onDiskChange([path]) // refresh it now if it's already open (the watcher is slower)
  await editor.open(path)
})

chat.connect(new ClaudeSidecarProvider())
ws.init()
// Panels, commands and buttons: the built-in plugins, then the ones on disk. The dock waits for them.
void bootPlugins()
