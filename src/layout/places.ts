// Where a panel was when it was closed, so showing it again can put it back there.
// Dockview forgets a closed panel completely, so the dock (dock.ts) records this first.

import type { PanelId } from './dock'

export type Direction = 'left' | 'right' | 'above' | 'below'

/** The part of a DOMRect this needs. */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** Where a group of its own sat: along a whole edge of the dock, or on one side of another panel. */
export interface Side {
  direction: Direction
  /** The panel it was beside; none = the dock's edge. */
  panel?: PanelId
}

export interface Place {
  /** The panels it shared its group (tab bar) with. */
  mates: PanelId[]
  side?: Side
  width: number
  height: number
}

/** Neighboring groups are this far apart at most (the gap between cards, plus rounding). */
const TOUCHING = 12
const near = (a: number, b: number) => Math.abs(a - b) <= TOUCHING

/**
 * Describe where `mine` sits among the other groups on screen: along a whole edge of
 * the dock if it spans one, else beside the neighbor whose shared edge matches best.
 * Undefined if it was alone.
 */
export function findSide(mine: Box, others: { panel: PanelId; box: Box }[]): Side | undefined {
  if (!others.length) return undefined
  const all = [mine, ...others.map((o) => o.box)]
  const dock: Box = {
    left: Math.min(...all.map((b) => b.left)),
    top: Math.min(...all.map((b) => b.top)),
    right: Math.max(...all.map((b) => b.right)),
    bottom: Math.max(...all.map((b) => b.bottom)),
  }
  if (near(mine.left, dock.left) && near(mine.right, dock.right)) {
    if (near(mine.bottom, dock.bottom)) return { direction: 'below' }
    if (near(mine.top, dock.top)) return { direction: 'above' }
  }
  if (near(mine.top, dock.top) && near(mine.bottom, dock.bottom)) {
    if (near(mine.left, dock.left)) return { direction: 'left' }
    if (near(mine.right, dock.right)) return { direction: 'right' }
  }

  let best: Side | undefined
  let bestScore = 0
  for (const { panel, box } of others) {
    // How much of an edge the two share (0 to 1; 1 = the same length, fully side by side).
    const share = (a1: number, a2: number, b1: number, b2: number) =>
      Math.max(0, Math.min(a2, b2) - Math.max(a1, b1)) / Math.max(a2 - a1, b2 - b1, 1)
    const beside = share(mine.top, mine.bottom, box.top, box.bottom)
    const stacked = share(mine.left, mine.right, box.left, box.right)
    const candidates: [boolean, Direction, number][] = [
      [near(mine.left, box.right), 'right', beside],
      [near(mine.right, box.left), 'left', beside],
      [near(mine.top, box.bottom), 'below', stacked],
      [near(mine.bottom, box.top), 'above', stacked],
    ]
    for (const [touching, direction, score] of candidates) {
      if (touching && score > bestScore) [best, bestScore] = [{ direction, panel }, score]
    }
  }
  return best
}
