// Runs the in-page theming benchmark (src/bench.ts) in the running app over CDP.
// Windows/WebView2: start the app with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222.
// Linux/WebKitGTK has no CDP; run `VITE_AUTOBENCH=1 bun run tauri dev` there instead.
// Usage: bun e2e/blur-bench.ts [port]

import { connect } from './cdp'

const cdp = await connect(Number(process.argv[2] ?? 9222))
const result = await cdp.evaluate<{ userAgent: string; viewport: string; backdropFilterSupported: boolean; rows: object[] }>(
  '__runBench()',
)
console.log('webview:', result.userAgent)
console.log('viewport:', result.viewport, '| backdrop-filter supported:', result.backdropFilterSupported)
console.table(result.rows)
cdp.close()
process.exit(0)
