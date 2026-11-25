import { describe, expect, it } from 'vitest'
import { computeSmoothedPubRate, extractQueueItemIds } from '@/lib/synthesis/pipeline'
import { isJunkTitle } from '@/lib/news-queue/service'

describe('computeSmoothedPubRate', () => {
  it('liefert 0 bei 0 Publikationen oder 0 Gesamtartikeln', () => {
    expect(computeSmoothedPubRate(0, 50)).toBe(0)
    expect(computeSmoothedPubRate(0, 0)).toBe(0)
    expect(computeSmoothedPubRate(3, 0)).toBe(0)
  })

  it('glättet kleine Stichproben per Laplace-Shrinkage und kappt bei 0.30', () => {
    // 1 von 2 Artikeln wäre ungeschützt 0.50; mit +15 Shrinkage = 1/17 = 0.059
    expect(computeSmoothedPubRate(1, 2)).toBe(0.059)
    // 10 von 26 Artikeln (wie Alberto Romero) -> 10 / 41 = 0.244
    expect(computeSmoothedPubRate(10, 26)).toBe(0.244)
    // Sehr hohe Raten werden auf NUMERIC(4,3)-Cap 0.30 begrenzt
    expect(computeSmoothedPubRate(30, 35)).toBe(0.30)
  })
})

describe('extractQueueItemIds', () => {
  it('extrahiert sowohl queueItemId als auch gebündelte queueItemIds[] aus TipTap-Headings', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2, queueItemId: 'id-single' } },
        { type: 'heading', attrs: { level: 2, queueItemIds: ['id-b1', 'id-b2'] } },
        { type: 'paragraph', attrs: { queueItemId: 'not-a-heading' } },
      ],
    }
    const ids = new Set<string>()
    extractQueueItemIds(doc, ids)
    expect([...ids]).toEqual(['id-single', 'id-b1', 'id-b2'])
  })
})

describe('isJunkTitle — erweiterte Filter', () => {
  it.each([
    'Partner Content and Sponsorships',
    'Partner Content: Future of Cloud',
    'Sponsorships',
    'The Deep View (@theDeepView) auf X',
    'AI Lab (@ailab) on X',
    'Featured in Techpresso | Toolradar',
    'Dupple X: AI Courses, Software Deals, Ad-Free Techpresso',
    "The Who's Who of AI",
    'Presentations — Benedict Evans',
  ])('filtert bekannten Junk-Titel: %s', (title) => {
    expect(isJunkTitle(title)).toBe(true)
  })

  it.each([
    'OpenAI signs major cloud sponsorship deal with Nvidia',
    'Why Jensen Huang proved to be too big to fire',
    'inclusionAI drops Ling-3.2-air, 124B MoE at 5.5B active',
    'China’s Huawei found guilty of stealing trade secrets',
    "Google's Neon Is Great… On a Short Leash",
  ])('lässt echte Artikel-Titel passieren: %s', (title) => {
    expect(isJunkTitle(title)).toBe(false)
  })
})
