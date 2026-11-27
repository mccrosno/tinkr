// A fix for saved layouts with a gap between cards (dockview-core 8.10).
//
// The cards in a row give up a share of their size to make room for the gaps between
// them. Dockview saves each card's size without that share, but reads saved sizes back
// as if it were included, so every restore (a restart, a preset switch) would move a
// pixel or so from some panels to others. Adding the share back before saving keeps
// the sizes the same.

/** The parts of dockview's saved grid tree this needs. */
export interface GridNode {
  type: string
  /** A branch's children, or a leaf's group. */
  data: unknown
  size?: number
  /** False for a hidden node; its saved size already includes the share. */
  visible?: boolean
}

export function withGapShares<T extends GridNode>(node: T, gap: number): T {
  if (node.type !== 'branch') return node
  const children = node.data as GridNode[]
  const visible = children.filter((c) => c.visible !== false).length
  // n cards in a row have n - 1 gaps between them, shared equally.
  const share = visible ? (gap * (visible - 1)) / visible : 0
  const data = children.map((c) => withGapShares(c.visible === false || c.size === undefined ? c : { ...c, size: c.size + share }, gap))
  return { ...node, data }
}
