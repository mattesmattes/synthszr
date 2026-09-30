import { describe, it, expect, vi } from 'vitest'
import { assignManualToStories, attachManualToStories } from '@/lib/claude/bundle-attach'
import { computeBundleUnits } from '@/lib/claude/ghostwriter-pipeline'
import { toPipelineItem } from '@/lib/claude/queue-article'

/**
 * Handmarkierte Meldungen wandern per Themen-Ähnlichkeit in die passende
 * Techmeme-Story (Betreiber-Vorgabe 2026-09-30). Hintergrund: Die Regel „ein
 * Label, ein Abschnitt" (2026-09-28) verschmolz ALLE Techmeme-Stories zu einem
 * Abschnitt, weil Techmeme jede Story automatisch als „Thema des Tages" labelt —
 * der Nachtlauf vom 2026-09-30 bekam aus fünf Stories einen einzigen Abschnitt.
 */
type Zeile = { id: string; title: string; content: string | null; bundle_type: string | null; metadata: Record<string, unknown> | null }

const zeile = (id: string, bundle_type: string | null, story?: string): Zeile => ({
  id,
  title: `Titel ${id}`,
  content: `Inhalt ${id}`,
  bundle_type,
  metadata: story ? { techmeme_story: story } : null,
})

describe('assignManualToStories', () => {
  // Einheitsvektoren: gleiche Richtung = Ähnlichkeit 1, orthogonal = 0.
  const A = [1, 0, 0]
  const B = [0, 1, 0]
  const C = [0, 0, 1]
  const nahB = [0.1, 0.99, 0] // cos zu B ≈ 0.995

  it('hängt eine handmarkierte Meldung an die ähnlichste Story desselben Labels', () => {
    const items = [zeile('a1', 'topic', 'story-a'), zeile('b1', 'topic', 'story-b'), zeile('hand', 'topic')]
    const out = assignManualToStories(items, [A, B, nahB], 0.8)
    expect(out.find((i) => i.id === 'hand')?.metadata).toEqual({ techmeme_story: 'story-b' })
  })

  it('lässt die Meldung ohne Story, wenn keine Story die Schwelle erreicht', () => {
    const items = [zeile('a1', 'topic', 'story-a'), zeile('hand', 'topic')]
    const out = assignManualToStories(items, [A, C], 0.8)
    expect(out.find((i) => i.id === 'hand')?.metadata).toBeNull()
  })

  it('vergleicht nur mit Stories DESSELBEN Labels', () => {
    const items = [zeile('t1', 'topic', 'story-t'), zeile('cover', 'cover_story')]
    const out = assignManualToStories(items, [A, A], 0.8)
    expect(out.find((i) => i.id === 'cover')?.metadata).toBeNull()
  })

  it('nimmt bei mehreren passenden Stories die ähnlichste', () => {
    const fastA = [0.9, 0.44, 0] // cos zu A ≈ 0.90, zu B ≈ 0.44
    const items = [zeile('a1', 'topic', 'story-a'), zeile('b1', 'topic', 'story-b'), zeile('hand', 'topic')]
    const out = assignManualToStories(items, [A, B, fastA], 0.4)
    expect(out.find((i) => i.id === 'hand')?.metadata?.techmeme_story).toBe('story-a')
  })

  it('misst gegen die ähnlichste Quelle einer Story, nicht gegen die erste', () => {
    const items = [zeile('a1', 'topic', 'story-a'), zeile('a2', 'topic', 'story-a'), zeile('hand', 'topic')]
    const out = assignManualToStories(items, [C, B, nahB], 0.8)
    expect(out.find((i) => i.id === 'hand')?.metadata?.techmeme_story).toBe('story-a')
  })

  it('lässt Meldungen ohne Embedding, Einzelmeldungen und Techmeme-Quellen unverändert', () => {
    const items = [zeile('a1', 'topic', 'story-a'), zeile('hand', 'topic'), zeile('einzel', null)]
    const out = assignManualToStories(items, [A, [], A], 0.8)
    expect(out).toEqual(items)
  })

  it('verändert die Eingabe nicht', () => {
    const items = [zeile('b1', 'topic', 'story-b'), zeile('hand', 'topic')]
    assignManualToStories(items, [B, B], 0.8)
    expect(items[1].metadata).toBeNull()
  })
})

describe('attachManualToStories', () => {
  it('ruft keine Embeddings ab, wenn es keine Handmarkierung neben einer Story gibt', async () => {
    const embed = vi.fn()
    const items = [zeile('a1', 'topic', 'story-a'), zeile('b1', 'topic', 'story-b'), zeile('einzel', null)]
    expect(await attachManualToStories(items, { embed })).toEqual(items)
    expect(embed).not.toHaveBeenCalled()
  })

  it('ruft keine Embeddings ab, wenn das Label der Handmarkierung keine Story hat', async () => {
    const embed = vi.fn()
    const items = [zeile('a1', 'topic', 'story-a'), zeile('cover', 'cover_story')]
    expect(await attachManualToStories(items, { embed })).toEqual(items)
    expect(embed).not.toHaveBeenCalled()
  })

  it('bettet nur die gelabelten Meldungen ein und hängt die passende an', async () => {
    const embed = vi.fn(async (texts: string[]) => texts.map((t) => (t.includes('hand') || t.includes('b1') ? [0, 1] : [1, 0])))
    const items = [zeile('a1', 'topic', 'story-a'), zeile('b1', 'topic', 'story-b'), zeile('einzel', null), zeile('hand', 'topic')]
    const out = await attachManualToStories(items, { embed })
    expect(embed).toHaveBeenCalledTimes(1)
    expect((embed.mock.calls[0][0] as string[]).length).toBe(3) // a1, b1, hand — nicht die Einzelmeldung
    expect(out.find((i) => i.id === 'hand')?.metadata?.techmeme_story).toBe('story-b')
    expect(out.map((i) => i.id)).toEqual(['a1', 'b1', 'einzel', 'hand']) // Reihenfolge bleibt
  })

  it('gibt die Eingabe unverändert zurück, wenn die Embeddings scheitern', async () => {
    const embed = vi.fn(async () => { throw new Error('Gemini 503') })
    const items = [zeile('a1', 'topic', 'story-a'), zeile('hand', 'topic')]
    expect(await attachManualToStories(items, { embed })).toEqual(items)
  })
})

describe('Abschnitte nach der Zuordnung (Prod-Fälle 2026-09-28 und 2026-09-30)', () => {
  const row = (id: string, story?: string) => ({
    id, title: `Titel ${id}`, content: 'Inhalt', source_display_name: 'Quelle',
    source_url: `https://example.com/${id}`, source_identifier: 'example.com',
    bundle_type: 'topic' as const, metadata: story ? { techmeme_story: story } : null,
  })

  it('macht aus fünf Techmeme-Stories fünf Abschnitte', () => {
    const stories = ['openai-astra', 'anthropic-ipo', 'instinct', 'sonnet-5-5', 'amd-world-labs']
    const items = stories.flatMap((s) => [row(`${s}-1`, s), row(`${s}-2`, s)])
    expect(computeBundleUnits(items.map(toPipelineItem))).toHaveLength(5)
  })

  it('führt die zugeordnete Handmarkierung im Abschnitt ihrer Story', async () => {
    const items = [row('ap', 'openai-agents'), row('decoder', 'openai-agents'), row('info', 'china-nvidia'), row('evans')]
    const embed = async (texts: string[]) => texts.map((t) => (t.includes('info') ? [0, 1] : [1, 0]))
    const zugeordnet = await attachManualToStories(items, { embed })
    const units = computeBundleUnits(zugeordnet.map(toPipelineItem))
    expect(units.map((u) => u.indices)).toEqual([[1, 2, 4], [3]])
  })
})
