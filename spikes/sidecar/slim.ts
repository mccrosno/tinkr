// Slim build: no CLI inside. Use TINKR_CLAUDE_PATH (set by the host, e.g. a bundled
// resource) or the user's installed `claude` on PATH.
import { run } from './core'

const cliPath = process.env.TINKR_CLAUDE_PATH || Bun.which('claude') || undefined
run(cliPath)
