import { describe, expect, test } from 'bun:test'
import { withGapShares, type GridNode } from '../src/layout/gap'

const leaf = (size: number, visible?: boolean): GridNode => ({ type: 'leaf', data: {}, size, ...(visible === false ? { visible } : {}) })
const branch = (size: number, data: GridNode[]): GridNode => ({ type: 'branch', data, size })
const sizes = (n: GridNode): unknown => (n.type === 'branch' ? [n.size, (n.data as GridNode[]).map(sizes)] : n.size)

describe('gap shares in saved layouts', () => {
  test('each visible card gets its row share of the gaps back', () => {
    // 300 + 742 in a 1048 row, with a 6px gap: each card was saved 3px short.
    expect(sizes(withGapShares(branch(1048, [leaf(297), leaf(739)]), 6))).toEqual([1048, [300, 742]])
    // Three cards share two gaps: 4px each.
    expect(sizes(withGapShares(branch(900, [leaf(296), leaf(296), leaf(296)]), 6))).toEqual([900, [300, 300, 300]])
  })

  test('hidden cards keep their size and take no part', () => {
    expect(sizes(withGapShares(branch(600, [leaf(297), leaf(360, false), leaf(297)]), 6))).toEqual([600, [300, 360, 300]])
  })

  test('nested rows: a row gets its parent share, its cards their own', () => {
    const tree = branch(800, [branch(497, [leaf(197), leaf(297)]), leaf(297)])
    expect(sizes(withGapShares(tree, 6))).toEqual([800, [[500, [200, 300]], 300]])
  })

  test('a card alone has no gap, and the input is not changed', () => {
    const tree = branch(600, [leaf(600)])
    expect(sizes(withGapShares(tree, 6))).toEqual([600, [600]])
    const two = branch(600, [leaf(297), leaf(297)])
    withGapShares(two, 6)
    expect(sizes(two)).toEqual([600, [297, 297]])
  })
})
