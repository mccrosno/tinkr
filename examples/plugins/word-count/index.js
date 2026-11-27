// An example Tinkr plugin. Copy this folder to ~/.config/tinkr/plugins/word-count and
// Tinkr will ask whether to turn it on. It shows:
// - a panel built with plain DOM (any framework works: `mount` just gets an element),
// - a "selection" action (right-click selected code in the editor),
// - a command with a keybinding (also in the command palette, Ctrl+Shift+P),
// - settings that survive restarts, and talking to Claude (needs "agent" in plugin.json).
//
// Edit this file while Tinkr is running: the plugin reloads and its panel stays put.

import { countWords } from './lib/count.js'

/** @param {import('../../../src/plugins/api').TinkrApi} api */
export function activate(api) {
  let total = api.settings.get('total', 0)
  let render = () => {}

  api.panels.register({
    id: 'panel',
    title: 'Word count',
    location: 'right',
    mount(el) {
      el.style.padding = '12px'
      el.innerHTML = `
        <p>Words counted so far: <strong class="total"></strong></p>
        <p style="color: var(--tk-text-muted)">Select code in the editor, right-click, and choose “Count words”.</p>
        <button class="tk-button ask">Ask Claude for a word count fun fact</button>`
      render = () => (el.querySelector('.total').textContent = String(total))
      el.querySelector('.ask').addEventListener('click', () =>
        api.agent.setDraft(`I've counted ${total} words of code in Tinkr today. Tell me one fun fact about that number.`),
      )
      render()
      return () => (render = () => {})
    },
  })

  api.actions.register({
    id: 'count',
    slot: 'selection',
    title: 'Count words',
    run(selection) {
      const { words, lines } = countWords(selection.text)
      total += words
      api.settings.set('total', total)
      render()
      api.notifications.info(`${words} words on ${lines} line(s).`)
      api.layout.show('word-count.panel')
    },
  })

  api.commands.register({
    id: 'reset',
    title: 'Word count: reset',
    keybinding: 'Ctrl+Alt+Shift+W',
    run() {
      total = 0
      api.settings.set('total', 0)
      render()
    },
  })

  api.log.info('ready; total so far', total)
}
