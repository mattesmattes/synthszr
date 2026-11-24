/**
 * Manuelle Artikel-Erzeugung vs. Auto-Post-Befüllung in `selectAndEnrichItems`.
 *
 * BEFUND 2026-11-24: Beim manuellen Lauf mit 26 ausgewählten Items (davon 9 als
 * `long_read` über 4 Techmeme-Stories -> 1 Einheit, insgesamt 16 Einheiten) sah
 * `maxItems (26) - selectedUnits (16)` 10 fehlende Einheiten, rief
 * `getBalancedSelection(10)` auf und zog 10 nicht ausgewählte `pending`-Items
 * (mit veraltetem `bundle_type: 'topic'` aus einem vorherigen Reset) in den
 * Artikel.
 *
 * 1. `fillFromBalanced: false` (Default für manuelle Jobs): lädt KEINE
 *    `pending`-Items nach, selbst wenn `selectedUnits < maxItems`. Alle
 *    `long_read`-Quellen bleiben mit `bundle_key: null` in 1 Einheit erhalten.
 * 2. `fillFromBalanced: true` (Auto-Post): darf auffüllen, entfernt aber
 *    veraltete `bundle_type`-Labels auf den nachgeladenen `pending`-Items.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  selectedItems: [] as Array<Record<string, unknown>>,
  balancedItems: [] as Array<Record<string, unknown>>,
  fillReturnItems: [] as Array<Record<string, unknown>>,
}))

const mocks = vi.hoisted(() => ({
  getBalancedSelection: vi.fn(async () => state.balancedItems),
  selectItemsForArticle: vi.fn(async (ids: string[]) => ({
    items: state.fillReturnItems.filter((i) => ids.includes(String(i.id))),
  })),
}))

function makeChain() {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'in', 'eq', 'order']) chain[m] = vi.fn(() => chain)
  chain.then = (res: (v: unknown) => void) => res({ data: [], error: null })
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => makeChain() }),
}))

vi.mock('@/lib/news-queue/service', () => ({
  getSelectedItems: vi.fn(async () => state.selectedItems),
  getBalancedSelection: mocks.getBalancedSelection,
  selectItemsForArticle: mocks.selectItemsForArticle,
  deriveSourceUrl: vi.fn((_url: string | null, source: string) => `https://${source}`),
}))

import { countSelectionUnits, selectAndEnrichItems } from '@/lib/claude/queue-article'

const row = (id: string, score: number, bundle_type: string | null, story?: string) => ({
  id,
  daily_repo_id: null,
  title: `Titel ${id}`,
  content: `Inhalt ${id}`,
  source_display_name: 'Quelle',
  source_url: `https://example.com/${id}`,
  source_identifier: `src-${id}`,
  total_score: score,
  bundle_type,
  metadata: story ? { techmeme_story: story } : null,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  state.selectedItems = []
  state.balancedItems = []
  state.fillReturnItems = []
})

describe('selectAndEnrichItems — manuelle Auswahl & Balanced-Fill', () => {
  it('fillFromBalanced=false lädt bei manueller Auswahl KEINE pending-Items nach und hält 9 long_read-Items in 1 Einheit', async () => {
    const longReads = [
      row('lr1', 9.9, 'long_read', 'story-1'),
      row('lr2', 9.8, 'long_read', 'story-1'),
      row('lr3', 9.7, 'long_read', 'story-2'),
      row('lr4', 9.6, 'long_read', 'story-2'),
      row('lr5', 9.5, 'long_read', 'story-3'),
      row('lr6', 9.4, 'long_read', 'story-3'),
      row('lr7', 9.3, 'long_read', 'story-4'),
      row('lr8', 9.2, 'long_read', 'story-4'),
      row('lr9', 9.1, 'long_read'),
    ]
    const singles = Array.from({ length: 10 }, (_, i) => row(`s${i + 1}`, 8 - i * 0.1, null))
    state.selectedItems = [...longReads, ...singles]
    state.balancedItems = [{ id: 'pending-1', source_identifier: 'x' }]
    state.fillReturnItems = [row('pending-1', 10, 'topic', 'old-story')]

    const res = await selectAndEnrichItems({ useSelected: true, maxItems: 26, fillFromBalanced: false })

    expect(mocks.getBalancedSelection).not.toHaveBeenCalled()
    expect(mocks.selectItemsForArticle).not.toHaveBeenCalled()
    expect(res.pipelineItems).toHaveLength(19)
    const pipelineLongReads = res.pipelineItems.filter((p) => p.bundle_type === 'long_read')
    expect(pipelineLongReads).toHaveLength(9)
    expect(pipelineLongReads.every((p) => p.bundle_key === null)).toBe(true)
    expect(countSelectionUnits(res.pipelineItems)).toBe(11)
  })

  it('fillFromBalanced=true füllt bis maxItems auf und streift veraltete bundle_type-Labels auf pending-Items ab', async () => {
    state.selectedItems = [row('lr1', 9, 'long_read', 'story-1'), row('lr2', 8, 'long_read', 'story-2')]
    state.balancedItems = [
      { id: 'pending-1', source_identifier: 's1' },
      { id: 'pending-2', source_identifier: 's2' },
    ]
    state.fillReturnItems = [
      row('pending-1', 7, 'topic', 'stale-techmeme-story'),
      row('pending-2', 6, null),
    ]

    const res = await selectAndEnrichItems({ useSelected: true, maxItems: 3, fillFromBalanced: true })

    expect(mocks.getBalancedSelection).toHaveBeenCalledWith(2)
    expect(mocks.selectItemsForArticle).toHaveBeenCalledWith(['pending-1', 'pending-2'], { actor: 'pipeline' })
    expect(res.pipelineItems).toHaveLength(4)
    const pending1 = res.pipelineItems.find((p) => p.id === 'pending-1')
    const pending2 = res.pipelineItems.find((p) => p.id === 'pending-2')
    expect(pending1?.bundle_type).toBeNull()
    expect(pending1?.bundle_key).toBeNull()
    expect(pending2?.bundle_type).toBeNull()
  })
})
