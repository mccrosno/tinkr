// The plugin authoring kit's contents. `?raw` makes Vite put a file's text in the app,
// so the API and token files are the very ones Tinkr is built from and can't drift.

import apiTypes from '../api.ts?raw'
import tokens from '../../styles/tokens.css?raw'
import guide from './guide.md?raw'
import skill from './skill.md?raw'
import { KIT_MARKER, type KitFile } from './write'

const notice = `${KIT_MARKER}, and replaced when Tinkr updates it. To keep your own changes, delete this line.`

export const KIT: KitFile[] = [
  { path: 'CLAUDE.md', text: guide },
  { path: '.claude/skills/tinkr-plugin/SKILL.md', text: skill },
  // api.ts has no imports and declares only types, so it is a valid .d.ts as it stands.
  { path: 'tinkr-api.d.ts', text: `// ${notice}\n${apiTypes}` },
  { path: 'tinkr-tokens.css', text: `/* ${notice} */\n${tokens}` },
]
