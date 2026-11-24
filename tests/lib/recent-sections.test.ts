/**
 * Tests für das 3-Tage-Abschnitts-Retrieval (`lib/posts/recent-sections.ts`).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  extractSectionsFromTiptap,
  findMatchingRecentSections,
  formatRecentCoverageForPrompt,
  formatRecentTakesForPrompt,
  loadRecentPublishedSections,
  matchRecentSections,
  type EmbeddedRecentSection,
  type RecentSectionMatch,
} from '@/lib/posts/recent-sections'

const meta = {
  postId: 'post-1',
  postTitle: 'Tagespost',
  publishedAt: '2026-11-23T06:00:00.000Z',
}

describe('extractSectionsFromTiptap', () => {
  it('extrahiert mehrere H2-Abschnitte mit mehrteiliger Zusammenfassung und Take und ignoriert Intro sowie Tag-/Quellzeilen', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Intro-Absatz vor der ersten H2.' }] },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Nvidia holt Jensen Huang zurück' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Das Board stimmte einstimmig für die Rückkehr nach {lex:Compliance}-Prüfung.' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Trump telefonierte mit dem Vorstand. {Nvidia} → ' },
            { type: 'text', marks: [{ type: 'link', attrs: { href: 'https://cnbc.com' } }], text: 'CNBC' },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '{Nvidia} → TechCrunch' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Synthszr Take:' },
            { type: 'text', text: ' Kontrolle ist im Ernstfall verhandelbar.' },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'OpenAI legt Perplexity-Kurven offen' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Die Kurve reicht bis GPT-6.' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '**Synthszr Take:** Skalierung bleibt messbar.' }],
        },
      ],
    }

    const sections = extractSectionsFromTiptap(JSON.stringify(doc), meta)
    expect(sections).toHaveLength(2)
    expect(sections[0]).toEqual({
      ...meta,
      heading: 'Nvidia holt Jensen Huang zurück',
      summary: 'Das Board stimmte einstimmig für die Rückkehr nach {lex:Compliance}-Prüfung.\n\nTrump telefonierte mit dem Vorstand.',
      take: 'Kontrolle ist im Ernstfall verhandelbar.',
    })
    expect(sections[1]).toEqual({
      ...meta,
      heading: 'OpenAI legt Perplexity-Kurven offen',
      summary: 'Die Kurve reicht bis GPT-6.',
      take: 'Skalierung bleibt messbar.',
    })
  })

  it('liefert bei kaputtem JSON oder leerem Dokument fail-open [] zurück', () => {
    expect(extractSectionsFromTiptap('{not-json', meta)).toEqual([])
    expect(extractSectionsFromTiptap(null, meta)).toEqual([])
    expect(extractSectionsFromTiptap({ type: 'doc', content: [] }, meta)).toEqual([])
  })
})

describe('matchRecentSections & findMatchingRecentSections', () => {
  const mk = (heading: string, embedding: number[], take = ''): EmbeddedRecentSection => ({
    postId: 'p',
    postTitle: 'T',
    publishedAt: '2026-11-23T06:00:00.000Z',
    heading,
    summary: `Bericht zu ${heading}`,
    take,
    embedding,
  })

  it('filtert unterhalb threshold, sortiert absteigend und kappt bei limit', () => {
    const query = [1, 0, 0]
    const candidates = [
      mk('schwach', [0.4, 0.916, 0]),          // sim = 0.40 < 0.68
      mk('mittel', [0.7, 0.714, 0]),           // sim ~ 0.70
      mk('stark', [0.95, 0.312, 0]),           // sim ~ 0.95
      mk('auch-stark', [0.85, 0.526, 0]),      // sim ~ 0.85
      mk('kaputt-laenge', [1, 0]),             // falsche Dimension
      mk('leer', []),                          // leerer Vektor
    ]
    const matches = matchRecentSections(query, candidates, { threshold: 0.68, limit: 2 })
    expect(matches.map((m) => m.section.heading)).toEqual(['stark', 'auch-stark'])
    expect(matches[0].similarity).toBeGreaterThan(matches[1].similarity)
  })

  it('findMatchingRecentSections liefert bei Fehler fail-open [] zurück', async () => {
    const index = [mk('stark', [1, 0, 0])]
    const res = await findMatchingRecentSections('Nvidia', index, {
      embedOne: async () => { throw new Error('Gemini 402') },
    })
    expect(res).toEqual([])
  })
})

describe('loadRecentPublishedSections', () => {
  function fakeSupabase(rows: unknown[] | null, error: { message: string } | null = null) {
    const ops: Array<[string, unknown[]]> = []
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'or', 'order', 'limit']) {
      chain[m] = vi.fn((...args: unknown[]) => {
        ops.push([m, args])
        return chain
      })
    }
    chain.then = (res: (v: unknown) => void) => res({ data: rows, error })
    return {
      ops,
      client: { from: vi.fn(() => chain) } as unknown as Parameters<typeof loadRecentPublishedSections>[0] extends infer O ? O extends { supabase?: infer S } ? S : never : never,
    }
  }

  it('filtert nur published Posts der letzten 3 Tage (inkl. JS-Cutoff) und bettet extrahierte Abschnitte in einem Batch ein', async () => {
    const now = Date.parse('2026-11-24T12:00:00.000Z')
    const recentDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Gestrige News' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Wichtige Entwicklung gestern.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Synthszr Take: Erster Take.' }] },
      ],
    }
    const oldDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Veraltet' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Vor fünf Tagen passiert.' }] },
      ],
    }
    const { ops, client } = fakeSupabase([
      { id: 'p-new', title: 'Neu', created_at: '2026-11-23T05:00:00Z', published_at: '2026-11-23T06:00:00Z', content: recentDoc },
      { id: 'p-fallback', title: 'Ohne published_at', created_at: '2026-11-22T06:00:00Z', published_at: null, content: recentDoc },
      { id: 'p-too-old', title: 'Alt', created_at: '2026-11-19T06:00:00Z', published_at: '2026-11-19T06:00:00Z', content: oldDoc },
    ])
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 0, 0]))

    const loaded = await loadRecentPublishedSections({ days: 3, now, supabase: client, embed })

    expect(ops).toContainEqual(['eq', ['status', 'published']])
    expect(loaded).toHaveLength(2)
    expect(loaded.every((s) => s.postId !== 'p-too-old')).toBe(true)
    expect(embed).toHaveBeenCalledTimes(1)
    expect(embed.mock.calls[0][0]).toHaveLength(2)
  })

  it('ruft embed nicht auf, wenn keine Abschnitte vorliegen, und ist fail-open bei DB-/Embedding-Fehlern', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const embed = vi.fn(async () => [])
      const emptyDb = fakeSupabase([])
      expect(await loadRecentPublishedSections({ supabase: emptyDb.client, embed })).toEqual([])
      expect(embed).not.toHaveBeenCalled()

      const errDb = fakeSupabase(null, { message: 'timeout' })
      expect(await loadRecentPublishedSections({ supabase: errDb.client, embed })).toEqual([])

      const doc = {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Inhalt' }] },
        ],
      }
      const goodDb = fakeSupabase([{ id: '1', title: 'T', created_at: new Date().toISOString(), published_at: new Date().toISOString(), content: doc }])
      const failingEmbed = vi.fn(async () => { throw new Error('quota') })
      expect(await loadRecentPublishedSections({ supabase: goodDb.client, embed: failingEmbed })).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })
})

describe('formatRecentCoverageForPrompt & formatRecentTakesForPrompt', () => {
  const sampleMatch: RecentSectionMatch = {
    similarity: 0.84,
    section: {
      postId: 'p1',
      postTitle: 'Tagespost',
      publishedAt: '2026-11-23T06:00:00.000Z',
      heading: 'Nvidia setzt Huang wieder ein',
      summary: 'Der Vorstand holte Huang nach elf Tagen zurück.',
      take: 'Marktkapitalisierung schlägt Governance.',
    },
  }

  it('gibt ohne Treffer leere Strings zurück', () => {
    expect(formatRecentCoverageForPrompt([])).toBe('')
    expect(formatRecentTakesForPrompt([])).toBe('')
    expect(formatRecentTakesForPrompt([{ ...sampleMatch, section: { ...sampleMatch.section, take: '' } }])).toBe('')
  })

  it('formatiert Datum, Bericht, bisherigen Take sowie Delta- und Anti-Erfindungs-Regeln', () => {
    const block = formatRecentCoverageForPrompt([sampleMatch])
    expect(block).toContain('BEREITS IN DEN LETZTEN 3 TAGEN BERICHTET')
    expect(block).toContain('Nvidia setzt Huang wieder ein')
    expect(block).toContain('Der Vorstand holte Huang nach elf Tagen zurück.')
    expect(block).toContain('Marktkapitalisierung schlägt Governance.')
    expect(block).toContain('KEIN Erfinden')

    const takesBlock = formatRecentTakesForPrompt([sampleMatch])
    expect(takesBlock).toContain('BISHERIGE SYNTHSZR TAKES DER LETZTEN 3 TAGE')
    expect(takesBlock).toContain('Marktkapitalisierung schlägt Governance.')
  })
})
