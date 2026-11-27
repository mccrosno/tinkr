// Plugins can be split into files: relative imports work, and editing any of them
// reloads the plugin.

/** Words (runs of letters, digits and underscores) and lines in a piece of text. */
export function countWords(text) {
  const words = text.match(/[\p{L}\p{N}_]+/gu)?.length ?? 0
  const lines = text ? text.split('\n').length : 0
  return { words, lines }
}
