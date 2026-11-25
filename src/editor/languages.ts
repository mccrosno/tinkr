// File extension -> CodeMirror language. Languages load on demand so the editor
// doesn't ship every grammar up front.

import type { LanguageSupport } from '@codemirror/language'

type Loader = () => Promise<LanguageSupport>

const js = (opts: { typescript?: boolean; jsx?: boolean }): Loader => async () => (await import('@codemirror/lang-javascript')).javascript(opts)

const byExtension: Record<string, { id: string; load: Loader }> = {
  js: { id: 'javascript', load: js({}) },
  mjs: { id: 'javascript', load: js({}) },
  cjs: { id: 'javascript', load: js({}) },
  jsx: { id: 'javascript', load: js({ jsx: true }) },
  ts: { id: 'typescript', load: js({ typescript: true }) },
  mts: { id: 'typescript', load: js({ typescript: true }) },
  cts: { id: 'typescript', load: js({ typescript: true }) },
  tsx: { id: 'typescript', load: js({ typescript: true, jsx: true }) },
  json: { id: 'json', load: async () => (await import('@codemirror/lang-json')).json() },
  css: { id: 'css', load: async () => (await import('@codemirror/lang-css')).css() },
  html: { id: 'html', load: async () => (await import('@codemirror/lang-html')).html() },
  // Vue SFCs are close enough to HTML (with embedded JS/CSS) for highlighting.
  vue: { id: 'html', load: async () => (await import('@codemirror/lang-html')).html() },
  md: { id: 'markdown', load: async () => (await import('@codemirror/lang-markdown')).markdown() },
  markdown: { id: 'markdown', load: async () => (await import('@codemirror/lang-markdown')).markdown() },
  py: { id: 'python', load: async () => (await import('@codemirror/lang-python')).python() },
  rs: { id: 'rust', load: async () => (await import('@codemirror/lang-rust')).rust() },
  yml: { id: 'yaml', load: async () => (await import('@codemirror/lang-yaml')).yaml() },
  yaml: { id: 'yaml', load: async () => (await import('@codemirror/lang-yaml')).yaml() },
}

/** Language id for a file name, or 'text'. */
export function languageOf(fileName: string): string {
  return byExtension[extension(fileName)]?.id ?? 'text'
}

/** Load the CodeMirror language for a file name, or null for plain text. */
export async function loadLanguage(fileName: string): Promise<LanguageSupport | null> {
  const entry = byExtension[extension(fileName)]
  return entry ? entry.load() : null
}

function extension(fileName: string) {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}
