// The one Pinia instance. The app installs it, and so does every built-in panel: each
// panel is its own small Vue app (mounted through the plugin API, like any plugin's
// panel), and they all share these stores.
import { createPinia } from 'pinia'

export const pinia = createPinia()
