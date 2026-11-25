// Theming spike benchmark: cost of background images, animated SVG and backdrop blur.
// Runs inside the page so every webview (WebView2, WebKitGTK, WKWebView) runs identical code.
// Dev only. Triggered by e2e/blur-bench.ts over CDP, or automatically with VITE_AUTOBENCH=1
// (results are POSTed to the dev server's /__bench endpoint; see vite.config.ts).

import type { DockviewApi } from 'dockview-vue'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function makeImage(): string {
  const c = document.createElement('canvas')
  c.width = 1920
  c.height = 1080
  const g = c.getContext('2d')!
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `hsl(${(i * 37) % 360} 60% 45%)`
    g.beginPath()
    g.arc(Math.random() * 1920, Math.random() * 1080, 5 + Math.random() * 60, 0, 7)
    g.fill()
  }
  return c.toDataURL('image/png')
}

function makeSvg(): string {
  const circles = Array.from(
    { length: 12 },
    (_, i) =>
      `<circle cx="${30 * i + 20}" cy="150" r="40" fill="hsl(${i * 30} 70% 50%)">` +
      `<animate attributeName="cy" values="40;260;40" dur="${2 + i * 0.3}s" repeatCount="indefinite"/></circle>`,
  ).join('')
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">${circles}</svg>`)
}

// Measure frame times for `ms` while resizing a split every frame (like dragging a sash),
// which forces relayout and repaint of the blurred regions.
async function measure(dock: DockviewApi, ms: number) {
  const log = dock.getPanel('log')
  const times: number[] = []
  let last = performance.now()
  const end = last + ms
  await new Promise<void>((done) => {
    function frame(t: number) {
      times.push(t - last)
      last = t
      log?.api.setSize({ height: 120 + Math.round(80 * Math.sin(t / 200)) })
      if (t < end) requestAnimationFrame(frame)
      else done()
    }
    requestAnimationFrame(frame)
  })
  times.shift()
  times.sort((a, b) => a - b)
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  const pct = (p: number) => +times[Math.floor(times.length * p)].toFixed(1)
  return { fps: +(1000 / avg).toFixed(1), p50: pct(0.5), p95: pct(0.95), worst: +times[times.length - 1].toFixed(1), frames: times.length }
}

export async function runBench(dock: DockviewApi) {
  const image = makeImage()
  const svg = makeSvg()
  const translucent = `
    .dv-dockview, .dv-groupview, .dv-content-container, .dv-tabs-and-actions-container { background: transparent !important; }
    .dv-groupview { background: rgba(20,22,27,.55) !important; }
    .app { background: transparent; }`
  const blur = `.dv-groupview { backdrop-filter: blur(18px) saturate(1.2); -webkit-backdrop-filter: blur(18px) saturate(1.2); }`
  const bg = (url: string) => `body { background: #000 url("${url}") center/cover fixed; }`
  const scenarios: [string, string][] = [
    ['plain (no background)', ''],
    ['image background', bg(image) + translucent],
    ['image + blur', bg(image) + translucent + blur],
    ['animated SVG', bg(svg) + translucent],
    ['animated SVG + blur', bg(svg) + translucent + blur],
  ]

  const style = document.createElement('style')
  document.head.appendChild(style)
  const rows = []
  for (const [scenario, css] of scenarios) {
    style.textContent = css
    await sleep(500) // let images decode
    await measure(dock, 500) // warm-up
    rows.push({ scenario, ...(await measure(dock, 3000)) })
  }
  style.remove()
  dock.getPanel('log')?.api.setSize({ height: 160 })
  return {
    userAgent: navigator.userAgent,
    viewport: `${innerWidth}x${innerHeight} @${devicePixelRatio}x`,
    backdropFilterSupported: CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'),
    rows,
  }
}
