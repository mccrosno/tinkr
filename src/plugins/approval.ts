// What the user is asked before a plugin runs, and again before it may run a program
// they haven't agreed to.

import type { PluginManifest } from './api'

export interface ApprovalRequest {
  /** Programs the plugin asks to run that the user hasn't agreed to yet. */
  programs: string[]
  /** True if the plugin itself is already allowed (or was just turned on), and only programs are in question. */
  again: boolean
}

/** The programs a manifest asks to run: "run:gh" in `permissions` means "gh". */
export function programsOf(manifest: PluginManifest): string[] {
  const permissions: unknown = manifest.permissions
  if (!Array.isArray(permissions)) return []
  return permissions.flatMap((p) => (typeof p === 'string' && p.startsWith('run:') ? [p.slice(4)] : []))
}

export function approvalPrompt(manifest: PluginManifest, dir: string, request: ApprovalRequest) {
  const name = manifest.displayName ?? manifest.name
  const programs = request.programs.length
    ? `It asks to run these programs on your computer, as you and with your saved logins: ${request.programs.join(', ')}. ` +
      `It can give them any arguments.`
    : ''
  if (request.again) {
    return {
      title: 'Plugin asks to run a program',
      message: `The plugin "${name}", in\n${dir}\n\nwants something you haven't approved yet. ${programs}\n\nAllow it? If not, the plugin stays off.`,
      okLabel: 'Allow',
    }
  }
  const others = (Array.isArray(manifest.permissions) ? manifest.permissions : []).filter((p) => !String(p).startsWith('run:'))
  const uses = others.length ? `\n\nIt asks to use: ${others.join(', ')}.` : ''
  return {
    title: 'New plugin',
    message:
      `Tinkr found a new plugin, "${name}", in\n${dir}\n\n` +
      `Plugins run inside Tinkr as trusted code: they can read and change your files, ` +
      `run commands and talk to Claude. Only turn on plugins you trust.${uses}${programs ? `\n\n${programs}` : ''}\n\nTurn it on?`,
    okLabel: 'Turn on',
  }
}
