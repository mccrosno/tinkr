// What lets Claude write Tinkr plugins: two tools of its own (reload_plugin and
// plugin_status) and a few lines in the system prompt saying where plugins live.
//
// The tools are an in-process MCP server: Claude Code calls them, and the calls arrive
// here in the sidecar. Plugins run in the app's webview, though, so each call is passed
// on to the app (a `pluginRequest` event) and answered with what the app reports.

import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { PluginAction } from '../../shared/protocol'

/** The MCP server's name; Claude Code calls its tools "mcp__tinkr__<tool>". */
const SERVER = 'tinkr'
const TOOLS: Record<string, PluginAction> = { reload_plugin: 'reload', plugin_status: 'status' }

/** The full names of the plugin tools, as permission checks and transcripts see them. */
export const PLUGIN_TOOLS = new Set(Object.keys(TOOLS).map((name) => `mcp__${SERVER}__${name}`))

export interface PluginReport {
  text: string
  isError: boolean
}

/** Asks the app about a plugin and waits for its answer. */
export type AskApp = (action: PluginAction, name: string) => Promise<PluginReport>

const DESCRIPTIONS: Record<PluginAction, string> = {
  reload:
    'Load a Tinkr plugin afresh from its folder and report the result: its state, what it registered, and any errors. ' +
    'Call this after writing or changing a plugin, and fix what it reports. For a plugin Tinkr has not seen before, ' +
    'the user is first asked whether to turn it on.',
  status:
    "Report a Tinkr plugin's state, what it registered and its recent log messages, without reloading it. " +
    'Use this to see errors that happened while the user was using the plugin.',
}

/** A fresh server for one turn (a server can only be connected once). */
export function pluginToolServer(ask: AskApp): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: SERVER,
    tools: Object.entries(TOOLS).map(([toolName, action]) =>
      tool(
        toolName,
        DESCRIPTIONS[action],
        { name: z.string().describe("The plugin's folder name, the same as \"name\" in its plugin.json") },
        async ({ name }) => {
          const report = await ask(action, name)
          return { content: [{ type: 'text', text: report.text }], isError: report.isError }
        },
        // Always listed, rather than found through tool search: they're part of Tinkr.
        { alwaysLoad: true },
      ),
    ),
  })
}

/** Added to the system prompt when there's a plugins folder. */
export function pluginPrompt(pluginsDir: string) {
  return `- Tinkr is extended with plugins (panels, commands, buttons, layouts and themes), each a folder in ${pluginsDir}. When the user asks to add to or change Tinkr itself, write a plugin there: first read CLAUDE.md in that folder (the tinkr-plugin skill and tinkr-api.d.ts have the details), and after writing or changing one, call reload_plugin and fix what it reports.`
}
