export interface MultiSelectResult {
  selected: Set<string>
  anchorId: string | null
}

/**
 * Computes the next selection set and anchor for list multi-selection.
 * - Normal / Cmd / Ctrl click toggles `clickedId` and sets it as the new anchor.
 * - Shift+Click selects the inclusive visual range between `anchorId` and `clickedId`
 *   while preserving existing selections and keeping `anchorId` fixed.
 */
export function applyMultiSelect(opts: {
  visibleIds: string[]
  selected: ReadonlySet<string>
  anchorId: string | null
  clickedId: string
  shiftKey: boolean
}): MultiSelectResult {
  const next = new Set(opts.selected)
  const clickedIdx = opts.visibleIds.indexOf(opts.clickedId)
  if (clickedIdx === -1) {
    return { selected: next, anchorId: opts.anchorId }
  }

  if (!opts.shiftKey) {
    if (next.has(opts.clickedId)) {
      next.delete(opts.clickedId)
    } else {
      next.add(opts.clickedId)
    }
    return { selected: next, anchorId: opts.clickedId }
  }

  const anchorIdx = opts.anchorId ? opts.visibleIds.indexOf(opts.anchorId) : -1
  if (anchorIdx === -1) {
    if (next.has(opts.clickedId)) {
      next.delete(opts.clickedId)
    } else {
      next.add(opts.clickedId)
    }
    return { selected: next, anchorId: opts.clickedId }
  }

  const start = Math.min(anchorIdx, clickedIdx)
  const end = Math.max(anchorIdx, clickedIdx)
  for (let i = start; i <= end; i++) {
    next.add(opts.visibleIds[i])
  }
  return { selected: next, anchorId: opts.anchorId }
}
