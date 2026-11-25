// Compiles the sidecar to a single executable where Tauri expects it:
// src-tauri/binaries/tinkr-sidecar-<rust target triple>[.exe]
// (Tauri's externalBin naming; see src-tauri/tauri.release.conf.json).

import { join } from 'node:path'

const triple = (await Bun.$`rustc --print host-tuple`.text()).trim()
const ext = process.platform === 'win32' ? '.exe' : ''
const out = join(import.meta.dir, '..', '..', 'src-tauri', 'binaries', `tinkr-sidecar-${triple}${ext}`)

await Bun.$`bun build ${join(import.meta.dir, '..', 'src', 'main.ts')} --compile --minify --outfile ${out}`
console.log('built', out)
