<script setup lang="ts">
// One terminal tab: an xterm.js instance wired to its shell through the terminal store.
// xterm.js does the terminal emulation (escape codes, colors, cursor, scrollback); the
// shell's bytes just pass through Rust.
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { openUrl } from '@tauri-apps/plugin-opener'
import '@xterm/xterm/css/xterm.css'
import { useTerminal } from '../stores/terminal'
import { terminalFont, terminalTheme } from '../terminal/theme'

const props = defineProps<{ tabKey: number; active: boolean }>()
const store = useTerminal()
const host = ref<HTMLElement>()

let term: Terminal | null = null
let fit: FitAddon | null = null
const cleanups: (() => void)[] = []

/** Fit the terminal to its box. Skipped while hidden (a hidden box has no size). */
function refit() {
  const el = host.value
  if (!term || !fit || !el || !el.clientWidth || !el.clientHeight) return
  fit.fit() // changes cols/rows if needed, which fires onResize below
}

/**
 * Keys xterm.js should not turn into terminal input. Returning false makes xterm
 * ignore the event, so the browser (and Tinkr's own shortcuts) still see it.
 */
function onKey(e: KeyboardEvent) {
  if (e.type !== 'keydown' || !term) return true
  const mod = e.ctrlKey || e.metaKey
  const k = e.key.toLowerCase()
  // Copy: Ctrl+Shift+C, or Ctrl+C while text is selected (as in Windows Terminal).
  // Without a selection, plain Ctrl+C still interrupts the running program.
  if (mod && k === 'c' && (e.shiftKey || term.hasSelection())) {
    if (term.hasSelection()) navigator.clipboard.writeText(term.getSelection()).catch(() => {})
    term.clearSelection()
    e.preventDefault()
    return false
  }
  // Paste: let the browser's paste event happen; xterm.js reads it from there.
  if (mod && k === 'v') return false
  // App shortcuts: toggle the terminal panel, open a folder.
  if (mod && (e.key === '`' || (k === 'o' && !e.shiftKey))) return false
  return true
}

onMounted(async () => {
  const t = new Terminal({
    fontFamily: terminalFont(),
    fontSize: 13,
    lineHeight: 1.15,
    cursorBlink: true,
    scrollback: 5000,
    theme: terminalTheme(),
  })
  term = t
  fit = new FitAddon()
  t.loadAddon(fit)
  // Ctrl/Cmd+click a URL to open it in the system browser.
  t.loadAddon(new WebLinksAddon((_event, uri) => openUrl(uri).catch(() => {})))
  t.attachCustomKeyEventHandler(onKey)
  t.open(host.value!)

  // Keystrokes and pastes go to the shell; size changes tell the shell to redraw.
  const input = t.onData((data) => store.write(props.tabKey, data))
  const resized = t.onResize(({ cols, rows }) => store.resize(props.tabKey, cols, rows))
  cleanups.push(() => input.dispose(), () => resized.dispose())

  // Refit whenever the box changes size (panel resized, window resized, tab shown).
  // `requestAnimationFrame` batches a burst of resize notifications into one fit.
  let frame = 0
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(refit)
  })
  observer.observe(host.value!)
  cleanups.push(() => observer.disconnect())

  // Follow the system light/dark switch.
  const scheme = matchMedia('(prefers-color-scheme: light)')
  const recolor = () => t && (t.options.theme = terminalTheme())
  scheme.addEventListener('change', recolor)
  cleanups.push(() => scheme.removeEventListener('change', recolor))

  // Size the terminal to its box before starting the shell, so the first prompt is
  // drawn at the right width.
  await nextTick()
  refit()
  if (props.active) t.focus()
  await store.start(
    props.tabKey,
    { cols: t.cols, rows: t.rows },
    {
      onData: (bytes) => term?.write(bytes),
      onExit: (code) => term?.write(`\r\n\x1b[2m[Process exited with code ${code}]\x1b[0m\r\n`),
    },
  )
})

// When this tab becomes the visible one, fit it (it may have been resized while
// hidden) and put the keyboard focus in it.
watch(
  () => props.active,
  async (active) => {
    if (!active) return
    await nextTick()
    refit()
    term?.focus()
  },
)

onBeforeUnmount(() => {
  for (const c of cleanups) c()
  term?.dispose()
  term = null
  fit = null
})

defineExpose({ focus: () => term?.focus() })
</script>

<template>
  <div class="terminal-view">
    <div ref="host" class="host" :data-testid="`terminal-${tabKey}`" />
  </div>
</template>

<style scoped>
.terminal-view { height: 100%; padding: 4px 0 0 10px; background: var(--tk-bg); }
.host { height: 100%; }
/* xterm.js draws its own scrollbar area; match the panel background. */
.host :deep(.xterm-viewport) { background-color: var(--tk-bg) !important; }
</style>
