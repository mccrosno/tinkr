// Errors a plugin throws after it has loaded (in an event listener, a timer, a promise
// nobody awaits) don't pass through Tinkr's code, so nothing would log them. The browser
// reports them on `window`; if the stack points into a plugin's files, they go to the
// Console under that plugin, where the user and Claude can see them.

import { usePlugins } from '../stores/plugins'

/** A file URL of a plugin (see diskSource.ts), capturing the plugin's folder name. */
const PLUGIN_FILE = /(?:tinkr-plugin:\/\/localhost|tinkr-plugin\.localhost)\/([A-Za-z0-9._-]+)\/\d+\//

/** The plugin whose file is named first in `text` (a stack trace or a script URL). */
export function pluginIn(text: string): string | null {
  return PLUGIN_FILE.exec(text)?.[1] ?? null
}

const describe = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}`.trim() : String(e))

/** Log an uncaught error if it came from a plugin. `from` is the script's URL, if known. */
export function logUncaught(error: unknown, from = '') {
  const text = describe(error)
  const name = pluginIn(`${text}\n${from}`)
  const registry = usePlugins()
  if (name && registry.record(name)) registry.addLog(name, 'error', `uncaught error: ${text}${from ? `\n(in ${from})` : ''}`)
}

export function watchUncaughtErrors(target: Window = window) {
  target.addEventListener('error', (e) => logUncaught(e.error ?? e.message, e.filename ? `${e.filename}:${e.lineno}` : ''))
  target.addEventListener('unhandledrejection', (e) => logUncaught(e.reason))
}
