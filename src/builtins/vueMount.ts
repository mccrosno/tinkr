// A panel `mount` for built-in panels written as Vue components.
import { createApp, h, type Component } from 'vue'
import { pinia } from '../pinia'
import type { PanelDefinition } from '../plugins/api'

/** Run a Vue component as its own small app in the panel, sharing Tinkr's stores. */
export function vueMount(component: Component, props?: Record<string, unknown>): PanelDefinition['mount'] {
  return (el) => {
    // `tk-fill` (base.css): the component's root fills the panel (the container is a flex column).
    const app = createApp({ render: () => h(component, { ...props, class: 'tk-fill' }) })
    app.use(pinia)
    app.mount(el)
    return () => app.unmount()
  }
}
