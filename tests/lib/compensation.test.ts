import { describe, expect, it } from 'vitest'
import { hasBundles, computeBundleGroups } from '@/lib/claude/ghostwriter-pipeline'

describe('hasBundles', () => {
  it('true wenn topic oder recap Items', () => {
    expect(hasBundles({ topic: [1], recap: [] } as any)).toBe(true)
    expect(hasBundles({ topic: [], recap: [] } as any)).toBe(false)
  })
})

describe('Kompensations-Gate bei planArticle-Fallback', () => {
  // Wenn planArticle wirft, baut runGhostwriterPipeline einen Fallback-Plan OHNE
  // bundleGroups. buildBundleWriteUnits baut die Bündel-Units trotzdem aus
  // item.bundle_type → echte kind:'bundle'-Units existieren. Das Kompensations-Gate
  // MUSS deshalb aus den Items (computeBundleGroups) abgeleitet werden, nicht aus
  // plan.bundleGroups — sonst blieben normale Sektionen bei aktivem Bündel ungekürzt.
  const orderedItems = [
    { id: '1', title: 'T1', content: 'lang', source_identifier: 's', source_url: null, source_display_name: null, bundle_type: 'topic' },
    { id: '2', title: 'T2', content: 'c', source_identifier: 's', source_url: null, source_display_name: null, bundle_type: null },
  ] as any

  it('altes Gate (plan.bundleGroups) meldet Bündel im Fallback falsch als inaktiv', () => {
    const fallbackPlan = { bundleGroups: undefined } as any
    expect(hasBundles(fallbackPlan.bundleGroups ?? { topic: [], recap: [] })).toBe(false)
  })

  it('neues Gate (computeBundleGroups(items)) erkennt das Bündel korrekt → normale Sektion wird gekürzt', () => {
    expect(hasBundles(computeBundleGroups(orderedItems))).toBe(true)
  })
})
