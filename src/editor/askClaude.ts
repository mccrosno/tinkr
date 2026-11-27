// "Ask Claude" / "Request changes" on selected code (SPEC.md "Selection menu").
// Three ways in: a small popup next to the selection, Ctrl+L / Ctrl+Shift+L, and the
// right-click menu (drawn by EditorPane.vue; this extension only reports the click).

import { Prec, StateField, type EditorState } from '@codemirror/state'
import { EditorView, keymap, showTooltip, type Tooltip } from '@codemirror/view'
import type { CodeRef, RefPurpose } from '../chat/refs'

/**
 * The selected lines as a code reference. With nothing selected it's the cursor's line.
 * A selection ending at the very start of a line doesn't include that line.
 */
export function selectionRef(state: EditorState, path: string, relPath: string, purpose: RefPurpose): CodeRef {
  const { from, to } = state.selection.main
  const doc = state.doc
  const first = doc.lineAt(from)
  let last = doc.lineAt(to)
  if (to > from && to === last.from && last.number > first.number) last = doc.line(last.number - 1)
  // Empty selection: the whole line. Otherwise exactly what was selected.
  const text = from === to ? first.text : state.sliceDoc(from, to)
  return { path, relPath, fromLine: first.number, toLine: last.number, text, purpose }
}

export interface AskClaudeHandlers {
  /** "Ask Claude" or "Request changes" was chosen. */
  ask(purpose: RefPurpose): void
  /** Right-click: draw the context menu at these screen coordinates. */
  contextMenu(x: number, y: number): void
}

/** The popup shown above a non-empty selection. */
function selectionPopup(handlers: AskClaudeHandlers) {
  const tooltip = (state: EditorState): Tooltip | null => {
    const sel = state.selection.main
    if (sel.empty) return null
    return {
      pos: sel.head,
      above: sel.head === sel.from, // selected upwards: show it above the start
      strictSide: false,
      arrow: false,
      create() {
        const dom = document.createElement('div')
        dom.className = 'cm-ask-claude'
        dom.setAttribute('role', 'toolbar')
        dom.setAttribute('aria-label', 'Selection actions')
        for (const [label, purpose, hint] of [
          ['Ask Claude', 'question', 'Ctrl+L'],
          ['Request changes', 'change', 'Ctrl+Shift+L'],
        ] as const) {
          const b = document.createElement('button')
          b.type = 'button'
          b.textContent = label
          b.title = `${label} (${hint})`
          b.dataset.purpose = purpose
          // mousedown, not click: a click would first move the cursor and lose the selection.
          b.addEventListener('mousedown', (e) => {
            e.preventDefault()
            handlers.ask(purpose)
          })
          dom.append(b)
        }
        return { dom }
      },
    }
  }
  // Recompute the tooltip only when the selection changes.
  return StateField.define<Tooltip | null>({
    create: tooltip,
    update: (value, tr) => (tr.selection || tr.docChanged ? tooltip(tr.state) : value),
    provide: (f) => showTooltip.from(f),
  })
}

export function askClaude(handlers: AskClaudeHandlers) {
  return [
    selectionPopup(handlers),
    // High precedence: Ctrl+L is "select line" and Ctrl+Shift+L "select all matches"
    // in CodeMirror's default keymaps; Tinkr uses them for Claude instead.
    Prec.high(
      keymap.of([
        { key: 'Mod-l', preventDefault: true, run: () => (handlers.ask('question'), true) },
        { key: 'Mod-Shift-l', preventDefault: true, run: () => (handlers.ask('change'), true) },
      ]),
    ),
    EditorView.domEventHandlers({
      contextmenu(e, view) {
        // Right-clicking outside the selection moves the cursor there first, so the
        // menu acts on the line that was clicked.
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
        const sel = view.state.selection.main
        if (pos !== null && (sel.empty || pos < sel.from || pos > sel.to)) view.dispatch({ selection: { anchor: pos } })
        e.preventDefault()
        handlers.contextMenu(e.clientX, e.clientY)
        return true
      },
    }),
  ]
}
