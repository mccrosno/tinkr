// Puts the files that teach Claude (and people) to write plugins into the plugins
// folder: CLAUDE.md, the typed API and a skill (SPEC.md "Claude-authored plugins").
// Their contents are in kit.ts.

import { joinPath, parentOf } from '../../workspace/fs'

/** Every file in the kit carries this. A file without it is the user's, and is left alone. */
export const KIT_MARKER = 'Written by Tinkr'

export interface KitFile {
  /** Relative to the plugins folder, with "/". */
  path: string
  text: string
}

export interface KitFs {
  readText(path: string): Promise<string>
  writeText(path: string, text: string): Promise<void>
  /** Create a folder and any missing parents; fine if it exists. */
  mkdir(path: string): Promise<void>
}

/** Write the kit's files that are missing or out of date. Returns the paths written. */
export async function writeKit(fs: KitFs, dir: string, files: KitFile[]) {
  const written: string[] = []
  for (const file of files) {
    const path = file.path.split('/').reduce(joinPath, dir)
    const current = await fs.readText(path).catch(() => null) // null = not there yet
    if (current === file.text) continue
    if (current !== null && !current.includes(KIT_MARKER)) continue
    if (file.path.includes('/')) await fs.mkdir(parentOf(path))
    await fs.writeText(path, file.text)
    written.push(file.path)
  }
  return written
}
