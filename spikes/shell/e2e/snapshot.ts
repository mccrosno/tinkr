// Capture a PNG of the running window over CDP (no focus or mouse needed).
// Usage: bun e2e/snapshot.ts <out.png> [port]
import { connect } from './cdp'

const [out, port] = [process.argv[2] ?? 'snapshot.png', Number(process.argv[3] ?? 9222)]
const cdp = await connect(port)
const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
await Bun.write(out, Buffer.from(shot.result.data, 'base64'))
console.log('wrote', out)
cdp.close()
process.exit(0)
