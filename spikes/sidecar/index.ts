// Embedded build: the SDK's native CLI is baked into the exe (~500 MB total).
import { extractFromBunfs } from '@anthropic-ai/claude-agent-sdk/extract'
import embeddedCli from '@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe' with { type: 'file' }
import { run } from './core'

// Inside a compiled exe the embedded path lives in Bun's virtual FS (B:\~BUN\...),
// which can't be spawned, so extract it to a real file. Uncompiled, it's already real.
const isCompiled = embeddedCli.includes('~BUN') || embeddedCli.startsWith('/$bunfs')
run(isCompiled ? extractFromBunfs(embeddedCli) : embeddedCli)
