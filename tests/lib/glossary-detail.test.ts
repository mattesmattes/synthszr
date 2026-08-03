/**
 * Seiten-Loader für die Detailseite (Task 5): Begriff + Übersetzungs-Fallback
 * + drei arrondierende Blöcke (verwandte Begriffe, Produkte, News).
 *
 * Der Loader spricht mehrere Tabellen an, teils mehrfach (glossary_terms und
 * glossary_term_translations je einmal für den Begriff selbst und einmal für
 * die Matcher-Kandidatenliste aus getMatcherTerms). Ein einzelner globaler
 * Chain-Stub (wie in newsletter-access-tokens.test.ts) kann das nicht
 * auseinanderhalten — deshalb hier pro Tabelle eine eigene FIFO-Queue. Jede
 * Filtermethode bleibt ein vi.fn(), Constraints bleiben also weiterhin
 * prüfbar, nur die Antwort-Zuordnung ist tabellenbewusst.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  queues: {} as Record<string, unknown[]>,
  fallback: { data: null as unknown, error: null as unknown },
  chains: {} as Record<string, any[]>,
}))

function makeChain(table: string) {
  const chain: any = {}
  for (const m of ['select', 'eq', 'in', 'is', 'gt', 'order', 'limit', 'update', 'insert', 'delete']) {
    chain[m] = vi.fn(() => chain)
  }
  const queue = state.queues[table]
  const own = queue && queue.length ? queue.shift() : undefined
  const resolved = () => own ?? state.fallback
  chain.single = vi.fn(async () => resolved())
  chain.maybeSingle = vi.fn(async () => resolved())
  chain.then = (res: (v: unknown) => void) => res(resolved()) // await auf die Chain
  ;(state.chains[table] ??= []).push(chain)
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: vi.fn((table: string) => makeChain(table)) }),
}))

beforeEach(() => {
  state.queues = {}
  state.fallback = { data: null, error: null }
  state.chains = {}
})

function queue(table: string, ...results: unknown[]) {
  state.queues[table] = [...(state.queues[table] ?? []), ...results]
}

const TERM_ROW = {
  id: 't1',
  slug: 'moe',
  canonical_name: 'Mixture-of-Experts',
  aliases: ['MoE'],
  status: 'published',
  summary: 'Kurz erklärt.',
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reiner Text ohne Verweise.' }] }] },
  illustration_url: null,
  illustration_alt: null,
}

describe('getGlossaryTerm — Basisabfrage', () => {
  it('gibt null, wenn der Begriff nicht existiert', async () => {
    queue('glossary_terms', { data: null, error: null })
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    expect(await getGlossaryTerm('nope', 'de')).toBeNull()
  })

  it('gibt bei DB-Fehler null statt zu werfen', async () => {
    queue('glossary_terms', { data: null, error: { message: 'boom' } })
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    await expect(getGlossaryTerm('moe', 'de')).resolves.toBeNull()
  })

  it('filtert auf slug und status=published', async () => {
    queue('glossary_terms', { data: TERM_ROW, error: null }, { data: [], error: null })
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    await getGlossaryTerm('moe', 'de')
    const termChain = state.chains['glossary_terms'][0]
    expect(termChain.eq).toHaveBeenCalledWith('slug', 'moe')
    expect(termChain.eq).toHaveBeenCalledWith('status', 'published')
  })

  it('liefert alle GlossaryTerm-Felder plus die drei arrondierenden Blöcke', async () => {
    queue('glossary_terms', { data: TERM_ROW, error: null }, { data: [], error: null })
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'de')
    expect(term).toMatchObject({
      id: 't1',
      slug: 'moe',
      canonicalName: 'Mixture-of-Experts',
      aliases: ['MoE'],
      status: 'published',
      summary: 'Kurz erklärt.',
      illustrationUrl: null,
      illustrationAlt: null,
      relatedTerms: [],
      products: [],
      news: [],
    })
  })
})

describe('getGlossaryTerm — Übersetzungs-Fallback', () => {
  it('behält die deutsche Fassung, wenn keine Übersetzungszeile existiert', async () => {
    queue('glossary_terms', { data: TERM_ROW, error: null }, { data: [], error: null })
    queue('glossary_term_translations', { data: null, error: null })
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'en')
    expect(term?.canonicalName).toBe('Mixture-of-Experts')
    expect(term?.summary).toBe('Kurz erklärt.')
  })

  it('überschreibt Name/Summary/Body, wenn eine Übersetzungszeile existiert', async () => {
    queue('glossary_terms', { data: TERM_ROW, error: null }, { data: [], error: null })
    queue('glossary_term_translations', {
      data: {
        canonical_name: 'Mixture of Experts',
        aliases: ['MoE'],
        summary: 'Short EN summary.',
        body: { type: 'doc', content: [] },
      },
      error: null,
    })
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'en')
    expect(term?.canonicalName).toBe('Mixture of Experts')
    expect(term?.summary).toBe('Short EN summary.')
  })

  it('filtert die Übersetzung über den vollen Primary Key (term_id + language)', async () => {
    queue('glossary_terms', { data: TERM_ROW, error: null }, { data: [], error: null })
    queue('glossary_term_translations', { data: null, error: null })
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    await getGlossaryTerm('moe', 'en')
    const t9nChain = state.chains['glossary_term_translations'][0]
    expect(t9nChain.eq).toHaveBeenCalledWith('term_id', 't1')
    expect(t9nChain.eq).toHaveBeenCalledWith('language', 'en')
  })
})

/** Sammelt alle Textknoten mit glossaryLink-Mark, flach — gleiches Muster wie
 *  tests/lib/glossary-inject-marks.test.ts. */
function linked(node: unknown): Array<{ text: string; slug: string }> {
  const out: Array<{ text: string; slug: string }> = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    const marks = Array.isArray(o.marks) ? o.marks : []
    const mark = marks.find((m) => (m as { type?: string }).type === 'glossaryLink')
    if (typeof o.text === 'string' && mark) {
      out.push({ text: o.text, slug: (mark as { attrs: { slug: string } }).attrs.slug })
    }
    if (Array.isArray(o.content)) o.content.forEach(walk)
  }
  walk(node)
  return out
}

describe('getGlossaryTerm — verwandte Begriffe', () => {
  const CANDIDATE = { id: 'x1', slug: 'llm', canonical_name: 'Large Language Model', aliases: ['LLM'] }
  const TERM_WITH_MENTION = {
    ...TERM_ROW,
    body: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Ein MoE-Modell spart Rechenleistung gegenüber einem dichten LLM.' }],
        },
      ],
    },
  }

  it('findet einen Begriff, den der Erklärungstext erwähnt', async () => {
    queue('glossary_terms', { data: TERM_WITH_MENTION, error: null }, { data: [CANDIDATE], error: null })
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'de')
    expect(term?.relatedTerms).toEqual([{ slug: 'llm', canonicalName: 'Large Language Model' }])
  })

  it('bleibt leer, wenn der Text keinen anderen Begriff erwähnt', async () => {
    queue('glossary_terms', { data: TERM_ROW, error: null }, { data: [CANDIDATE], error: null })
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'de')
    expect(term?.relatedTerms).toEqual([])
  })

  it('bleibt leer, wenn es noch keine anderen veröffentlichten Begriffe gibt', async () => {
    queue('glossary_terms', { data: TERM_WITH_MENTION, error: null }, { data: [], error: null })
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'de')
    expect(term?.relatedTerms).toEqual([])
  })

  it('verlinkt den erwähnten Begriff direkt im body — nicht nur als Block darunter', async () => {
    queue('glossary_terms', { data: TERM_WITH_MENTION, error: null }, { data: [CANDIDATE], error: null })
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'de')
    expect(linked(term?.body)).toEqual([{ text: 'LLM', slug: 'llm' }])
  })

  it('lässt den body unverändert, wenn der Text nichts erwähnt', async () => {
    queue('glossary_terms', { data: TERM_ROW, error: null }, { data: [CANDIDATE], error: null })
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'de')
    expect(linked(term?.body)).toEqual([])
    expect(term?.body).toEqual(TERM_ROW.body)
  })

  it('degradiert auf keine verwandten Begriffe, wenn getMatcherTerms wegen eines Übersetzungs-Ladefehlers null zurückgibt (Review-Fund Important 1, Fix-Runde 1)', async () => {
    // lang='en': zwei separate glossary_term_translations-Konsumenten in
    // Folge — zuerst applyTermTranslation (eigener Begriff, hier: keine
    // Übersetzung vorhanden), danach getMatcherTerms('en') intern für die
    // Kandidatenliste, hier mit einem echten Query-Fehler statt "keine
    // Übersetzung". getMatcherTerms gibt dafür null zurück (terms.ts) —
    // linkRelatedTerms muss das über `?? []` abfangen, statt zu werfen.
    queue('glossary_terms', { data: TERM_WITH_MENTION, error: null }, { data: [CANDIDATE], error: null })
    queue('glossary_term_translations', { data: null, error: null }, { data: null, error: { message: 'boom' } })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'en')
    expect(term?.relatedTerms).toEqual([])
    expect(linked(term?.body)).toEqual([])
    errSpy.mockRestore()
  })

  it('verlinkt den eigenen Begriff nicht, auch wenn der eigene Text ihn nennt', async () => {
    // TERM_WITH_MENTION erwähnt "MoE" — der Begriff selbst. Die Kandidatenliste
    // enthält hier absichtlich auch die eigene Zeile, um den Selbstausschluss
    // wirklich zu prüfen (nicht nur, dass er in der Praxis nie auftaucht).
    const SELF_CANDIDATE = { id: 't1', slug: 'moe', canonical_name: 'Mixture-of-Experts', aliases: ['MoE'] }
    queue('glossary_terms', { data: TERM_WITH_MENTION, error: null }, { data: [SELF_CANDIDATE, CANDIDATE], error: null })
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'de')
    expect(term?.relatedTerms).toEqual([{ slug: 'llm', canonicalName: 'Large Language Model' }])
    expect(term?.relatedTerms.some((t) => t.slug === 'moe')).toBe(false)
    expect(linked(term?.body).some((l) => l.slug === 'moe')).toBe(false)
  })
})

describe('getGlossaryTerm — Produkte', () => {
  it('selektiert kein history-JSONB und filtert auf term_id + sichtbare Produkte', async () => {
    queue('glossary_terms', { data: TERM_ROW, error: null }, { data: [], error: null })
    queue('glossary_term_products', {
      data: [{ relevance: 0.9, product: { slug: 'gpt-5', canonical_name: 'GPT-5' } }],
      error: null,
    })
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'de')
    const chain = state.chains['glossary_term_products'][0]
    const cols = chain.select.mock.calls[0][0] as string
    expect(cols).not.toContain('history')
    expect(chain.eq).toHaveBeenCalledWith('term_id', 't1')
    expect(chain.eq).toHaveBeenCalledWith('products.visibility_status', 'visible')
    expect(term?.products).toEqual([{ slug: 'gpt-5', canonicalName: 'GPT-5', relevance: 0.9 }])
  })

  it('bleibt leer, solange die Tabelle noch nicht befüllt ist (Task 15)', async () => {
    queue('glossary_terms', { data: TERM_ROW, error: null }, { data: [], error: null })
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'de')
    expect(term?.products).toEqual([])
  })
})

describe('getGlossaryTerm — News', () => {
  it('filtert auf term_id, sortiert nach Datum und mapped die Felder', async () => {
    queue('glossary_terms', { data: TERM_ROW, error: null }, { data: [], error: null })
    queue('glossary_term_news', {
      data: [
        {
          title: 'Neues Modell nutzt MoE',
          source_name: 'Beispiel-Blog',
          source_url: 'https://example.com/a',
          published_at: '2026-07-01T00:00:00Z',
          context_sentence: 'Zitat aus dem Artikel.',
        },
      ],
      error: null,
    })
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'de')
    const chain = state.chains['glossary_term_news'][0]
    expect(chain.eq).toHaveBeenCalledWith('term_id', 't1')
    expect(chain.order).toHaveBeenCalledWith('published_at', { ascending: false })
    expect(term?.news).toEqual([
      {
        title: 'Neues Modell nutzt MoE',
        sourceName: 'Beispiel-Blog',
        sourceUrl: 'https://example.com/a',
        publishedAt: '2026-07-01T00:00:00Z',
        contextSentence: 'Zitat aus dem Artikel.',
      },
    ])
  })

  it('bleibt leer, solange die Cache-Tabelle noch nicht befüllt ist (Task 14)', async () => {
    queue('glossary_terms', { data: TERM_ROW, error: null }, { data: [], error: null })
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'de')
    expect(term?.news).toEqual([])
  })
})

describe('getGlossaryTerm — zwei Aufrufe mit unterschiedlichen Args', () => {
  it('liefert für unterschiedliche Slugs unabhängige, korrekte Ergebnisse', async () => {
    // Deckt keine Memoisierung ab (siehe Report: React cache() no-opt außerhalb
    // eines RSC-Renders, in Vitest daher nicht sinnvoll prüfbar) — wohl aber,
    // dass zwei verschiedene Aufrufe sich nicht gegenseitig verwechseln.
    queue(
      'glossary_terms',
      { data: TERM_ROW, error: null },
      { data: [], error: null },
      { data: { ...TERM_ROW, id: 't2', slug: 'rag', canonical_name: 'Retrieval-Augmented Generation' }, error: null },
      { data: [], error: null },
    )
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const first = await getGlossaryTerm('moe', 'de')
    const second = await getGlossaryTerm('rag', 'de')
    expect(first?.canonicalName).toBe('Mixture-of-Experts')
    expect(second?.canonicalName).toBe('Retrieval-Augmented Generation')
  })
})
