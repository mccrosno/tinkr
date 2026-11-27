// Is blur affordable here? (SPEC.md "Spike findings", spike 4: blur is the one costly
// effect, and only where the webview draws without a GPU, as WebKitGTK can on Linux.)
// Run for about a second while forcing the blurred page to redraw every frame, and
// report the 95th-percentile frame time. Over ~25 ms, blur should default to off.

export const SLOW_FRAME_MS = 25

/** p95 of a list of numbers (0 for none). */
export function percentile95(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
}

/**
 * Measure frame times for `ms` while `nudge(frame)` changes something under the blur
 * each frame (without a change, nothing repaints and blur costs nothing).
 */
export function measureFrames(ms: number, nudge: (frame: number) => void): Promise<number> {
  return new Promise((resolve) => {
    const deltas: number[] = []
    let start = 0
    let last = 0
    let frame = 0
    const step = (now: number) => {
      if (!start) start = now
      else deltas.push(now - last)
      last = now
      nudge(frame++)
      if (now - start < ms) requestAnimationFrame(step)
      else resolve(percentile95(deltas))
    }
    requestAnimationFrame(step)
  })
}
