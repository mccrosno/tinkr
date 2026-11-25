// CodeMirror look, built only from Tinkr's CSS variables (src/styles/tokens.css), so
// themes restyle the editor with no code changes.

import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

const chrome = EditorView.theme({
  '&': { height: '100%', color: 'var(--tk-text)', backgroundColor: 'var(--tk-bg)', fontSize: '13.5px' },
  '.cm-scroller': { fontFamily: 'var(--tk-font-mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--tk-accent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--tk-accent)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--tk-selection)',
  },
  '.cm-gutters': { backgroundColor: 'var(--tk-bg)', color: 'var(--tk-gutter-text)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--tk-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--tk-active-line)', color: 'var(--tk-text-muted)' },
  '.cm-matchingBracket': { outline: '1px solid var(--tk-border)', backgroundColor: 'transparent' },
  '.cm-searchMatch': { backgroundColor: 'var(--tk-selection)', outline: '1px solid var(--tk-accent)' },
  '.cm-panels': { backgroundColor: 'var(--tk-surface)', color: 'var(--tk-text)', borderColor: 'var(--tk-border)' },
  '.cm-tooltip': { backgroundColor: 'var(--tk-surface)', border: '1px solid var(--tk-border)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--tk-surface-2)', border: 'none', color: 'var(--tk-text-muted)' },
})

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword, t.definitionKeyword], color: 'var(--tk-syntax-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.attributeValue], color: 'var(--tk-syntax-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--tk-syntax-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--tk-syntax-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--tk-syntax-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: 'var(--tk-syntax-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--tk-syntax-property)' },
  { tag: t.heading, color: 'var(--tk-syntax-heading)', fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.link, color: 'var(--tk-accent)', textDecoration: 'underline' },
  { tag: t.invalid, color: 'var(--tk-danger)' },
])

export const tinkrTheme = [chrome, syntaxHighlighting(highlight)]
