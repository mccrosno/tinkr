import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/tokens.css'
import './styles/base.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.mount('#app')

// Dev only: expose the stores for e2e scripts that drive the window over CDP.
if (import.meta.env.DEV) (window as unknown as { __tinkr: unknown }).__tinkr = { pinia }
