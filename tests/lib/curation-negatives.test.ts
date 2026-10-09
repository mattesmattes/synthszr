/**
 * Block „Gewählt, aber gestrichen" (Curation Phase 0, Task 12).
 *
 * selectNegativeBlock und formatNegativeBlock sind rein. loadNegativeBlock
 * bekommt den Client als Parameter und wird mit dem makeChain-Muster aus
 * glossary-jobs-service.test.ts geprueft: pro Tabelle eine FIFO-Queue, jede
 * Chain-Methode ein vi.fn(), damit as-of-Filter, Tabellenreihenfolge und
 * Scheibenbildung sichtbar sind. Kein vi.mock.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { NegativeUnit } from '@/lib/curation/negatives'

const state = vi.hoisted(() => ({
  queues: {} as Record<string, unknown[]>,
  fallback: { data: null as unknown, error: null as unknown },
  chains: {} as Record<string, any[]>,
}))

function makeChain(table: string) {
  const chain: any = {}
  for (const m of ['select', 'eq', 'in', 'is', 'or', 'lt', 'gte', 'order', 'limit', 'range', 'update', 'insert']) {
    chain[m] = vi.fn(() => chain)
  }
  const queue = state.queues[table]
  const own = queue && queue.length ? queue.shift() : undefined
  const resolved = () => own ?? state.fallback
  chain.single = vi.fn(async () => resolved())
  chain.maybeSingle = vi.fn(async () => resolved())
  chain.then = (res: (v: unknown) => void) => res(resolved())
  ;(state.chains[table] ??= []).push(chain)
  return chain
}

const client = { from: vi.fn((t: string) => makeChain(t)) } as any

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  state.queues = {}
  state.chains = {}
  state.fallback = { data: null, error: null }
  client.from.mockClear()
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
  vi.useRealTimers()
})

/** Fixture: eine Negativ-Einheit mit sinnvollen Defaults. */
const unit = (over: Partial<NegativeUnit> & { item_id: string }): NegativeUnit => ({
  item_id: over.item_id,
  title: over.title ?? `Titel ${over.item_id}`,
  source: over.source ?? 'Quelle',
  bundle_type_selected: over.bundle_type_selected ?? null,
  day: over.day ?? '2026-10-01',
  contrast_heading: over.contrast_heading ?? null,
})

/** 'YYYY-MM-DD' fuer Tag n eines Monats (n = 1..30). */
const sep = (n: number) => `2026-09-${String(n).padStart(2, '0')}`

describe('selectNegativeBlock', () => {
  it('kappt gelabelte Einheiten auf 8 je Rolle und behaelt die juengsten', async () => {
    const { selectNegativeBlock } = await import('@/lib/curation/negatives')
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => unit({ item_id: `t${i}`, bundle_type_selected: 'topic', day: sep(10 + i) })),
      ...Array.from({ length: 3 }, (_, i) => unit({ item_id: `r${i}`, bundle_type_selected: 'recap', day: sep(1 + i) })),
    ]

    const out = selectNegativeBlock(rows)

    expect(out.filter(u => u.bundle_type_selected === 'topic').map(u => u.item_id))
      .toEqual(['t9', 't8', 't7', 't6', 't5', 't4', 't3', 't2'])
    expect(out.filter(u => u.bundle_type_selected === 'recap')).toHaveLength(3)
    expect(out).toHaveLength(11)
  })

  it('kappt insgesamt auf 20 und behaelt die juengsten ungelabelten', async () => {
    const { selectNegativeBlock } = await import('@/lib/curation/negatives')
    // Eingabe absichtlich aufsteigend: die Funktion muss selbst nach day desc sortieren.
    const rows = Array.from({ length: 30 }, (_, i) => unit({ item_id: `u${i + 1}`, day: sep(i + 1) }))

    const out = selectNegativeBlock(rows)

    expect(out).toHaveLength(20)
    expect(out[0].day).toBe(sep(30))
    expect(out[19].day).toBe(sep(11))
  })

  it('stellt gelabelte vor ungelabelte, auch wenn ungelabelte juenger sind', async () => {
    const { selectNegativeBlock } = await import('@/lib/curation/negatives')
    const rows = [
      unit({ item_id: 'u1', day: '2026-10-05' }),
      unit({ item_id: 'l1', day: '2026-10-01', bundle_type_selected: 'topic' }),
      unit({ item_id: 'l2', day: '2026-10-03', bundle_type_selected: 'deep_dive' }),
    ]

    expect(selectNegativeBlock(rows).map(u => u.item_id)).toEqual(['l2', 'l1', 'u1'])
  })

  it('zaehlt gelabelte gegen das Gesamtlimit', async () => {
    const { selectNegativeBlock } = await import('@/lib/curation/negatives')
    // 3 Rollen x 8 = 24 gelabelte > 20: ungelabelte kommen gar nicht mehr dran.
    const rows = [
      ...['topic', 'recap', 'deep_dive'].flatMap(role =>
        Array.from({ length: 8 }, (_, i) => unit({ item_id: `${role}-${i}`, bundle_type_selected: role, day: sep(i + 1) }))),
      unit({ item_id: 'u1', day: '2026-10-05' }),
    ]

    const out = selectNegativeBlock(rows)

    expect(out).toHaveLength(20)
    expect(out.every(u => u.bundle_type_selected !== null)).toBe(true)
  })

  it('nimmt Kappungen aus opts', async () => {
    const { selectNegativeBlock } = await import('@/lib/curation/negatives')
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => unit({ item_id: `t${i}`, bundle_type_selected: 'topic', day: sep(i + 1) })),
      ...Array.from({ length: 5 }, (_, i) => unit({ item_id: `u${i}`, day: sep(i + 1) })),
    ]

    const out = selectNegativeBlock(rows, { maxTotal: 3, maxPerRole: 1 })

    expect(out.map(u => u.item_id)).toEqual(['t3', 'u4', 'u3'])
  })
})

const INTRO =
  'Diese Meldungen hat der Betreiber selbst gewählt und dann aus dem Post gestrichen — sie zeigen die Grenze seines Interesses genauer als nie Gewähltes.'

describe('formatNegativeBlock', () => {
  it('liefert bei leerer Liste einen leeren String', async () => {
    const { formatNegativeBlock } = await import('@/lib/curation/negatives')
    expect(formatNegativeBlock([])).toBe('')
  })

  it('schreibt Ueberschrift, Einleitungssatz und je Einheit eine Zeile plus Kontrastzeile', async () => {
    const { formatNegativeBlock, NEGATIVE_BLOCK_INTRO } = await import('@/lib/curation/negatives')
    const units = [
      unit({ item_id: 'a', day: '2026-10-01', source: 'The Information', title: 'OpenAI kauft X', bundle_type_selected: 'topic', contrast_heading: 'OpenAI übernimmt Y' }),
      unit({ item_id: 'b', day: '2026-09-30', source: 'Stratechery', title: 'Apple und KI' }),
    ]

    const text = formatNegativeBlock(units)
    const lines = text.split('\n')

    expect(NEGATIVE_BLOCK_INTRO).toBe(INTRO)
    expect(lines[0]).toBe('Gewählt, aber gestrichen')
    expect(lines[1]).toBe(INTRO)
    expect(lines.slice(2)).toEqual([
      '- 2026-10-01 · The Information · OpenAI kauft X [topic]',
      '  stattdessen lief: OpenAI übernimmt Y',
      '- 2026-09-30 · Stratechery · Apple und KI',
    ])
  })
})

describe('loadNegativeBlock', () => {
  // q1: gelabelt, Embedding [1,0], Post p1 → Kontrast aus p1 (0,71 schlaegt 0,65; kaputte/3-D-Einheiten werden uebersprungen)
  // q2: ungelabelt, ohne daily_repo → kein Kontrast, Quelle = source_identifier
  // q3: ungelabelt, Embedding '[0,1]' (String-Form), Post p2 → Einheit mit genau 0,8 ist KEIN Kontrast
  // q4: ohne news_queue-Zeile → faellt aus dem Block
  // q5: ungelabelt, Embedding [1,0], Post p3 → Einheit mit genau 0,65 IST Kontrast (untere Grenze inklusiv)
  const PREC = [
    { item_id: 'q1', day: '2026-10-04', bundle_type_selected: 'topic', post_id: 'p1' },
    { item_id: 'q2', day: '2026-10-03', bundle_type_selected: null, post_id: 'p1' },
    { item_id: 'q3', day: '2026-10-02', bundle_type_selected: null, post_id: 'p2' },
    { item_id: 'q4', day: '2026-10-01', bundle_type_selected: null, post_id: 'p2' },
    { item_id: 'q5', day: '2026-09-30', bundle_type_selected: null, post_id: 'p3' },
  ]
  const QUEUE = [
    { id: 'q1', title: 'OpenAI kauft X', source_display_name: 'The Information', source_identifier: 'theinformation.com', daily_repo_id: 'r1' },
    { id: 'q2', title: 'Apple und KI', source_display_name: null, source_identifier: 'stratechery.com', daily_repo_id: null },
    { id: 'q3', title: 'Nvidia-Quartal', source_display_name: 'Heise', source_identifier: 'heise.de', daily_repo_id: 'r2' },
    { id: 'q5', title: 'Anthropic-Runde', source_display_name: 'Bloomberg', source_identifier: 'bloomberg.com', daily_repo_id: 'r3' },
  ]
  const REPO = [
    { id: 'r1', embedding: [1, 0] },       // pgvector als Array …
    { id: 'r2', embedding: '[0,1]' },      // … oder als String (PostgREST liefert beides)
    { id: 'r3', embedding: [1, 0] },
  ]
  const UNITS = [
    { post_id: 'p1', heading: 'Kontrast 0,71', embedding: [0.7, 0.7] },     // cos zu [1,0] = 0,707 → Kontrast
    { post_id: 'p1', heading: 'Merged 0,99', embedding: '[0.9,0.1]' },     // cos = 0,994 → ≥ 0,8, kein Kontrast
    { post_id: 'p1', heading: 'Fern', embedding: [-1, 0] },                 // cos = -1
    { post_id: 'p1', heading: 'Kaputt', embedding: 'kaputt' },              // parseEmbedding → [] → Zeile ignoriert
    { post_id: 'p1', heading: 'Dreidimensional', embedding: [1, 0, 0] },    // fremde Dimension → uebersprungen (sonst wirft cosineSimilarity)
    { post_id: 'p2', heading: 'Gleicher Vektor, anderer Post', embedding: [1, 0] }, // cos zu q1 = 1, aber anderer Post → zaehlt nicht; zu q3 [0,1] = 0
    { post_id: 'p2', heading: 'Genau 0,8', embedding: [3, 4] },             // cos zu [0,1] = 4/5 = 0,8 → obere Grenze exklusiv
    { post_id: 'p3', heading: 'Genau 0,65', embedding: [13, Math.sqrt(231)] }, // cos zu [1,0] = 13/20 = 0,65 exakt → untere Grenze inklusiv
    { post_id: 'p3', heading: 'Knapp darunter', embedding: [3, 4] },        // cos zu [1,0] = 3/5 = 0,6 → kein Kontrast
  ]

  it('laedt as-of, liest Tabellen in fester Reihenfolge und setzt Kontraste', async () => {
    const { loadNegativeBlock } = await import('@/lib/curation/negatives')
    state.queues['curation_precedents'] = [{ data: PREC, error: null }]
    state.queues['news_queue'] = [{ data: QUEUE, error: null }]
    state.queues['daily_repo'] = [{ data: REPO, error: null }]
    state.queues['published_units'] = [{ data: UNITS, error: null }]

    const res = await loadNegativeBlock(client, { days: 14, asOf: '2026-10-06' })

    expect(client.from.mock.calls.map((c: unknown[]) => c[0]))
      .toEqual(['curation_precedents', 'news_queue', 'daily_repo', 'published_units'])

    const prec = state.chains['curation_precedents'][0]
    expect(prec.eq).toHaveBeenCalledWith('stage', 'dropped_after_selection')
    expect(prec.gte).toHaveBeenCalledWith('day', '2026-09-22')
    expect(prec.lt).toHaveBeenCalledWith('day', '2026-10-06')
    expect(state.chains['news_queue'][0].in).toHaveBeenCalledWith('id', ['q1', 'q2', 'q3', 'q4', 'q5'])
    expect(state.chains['daily_repo'][0].in).toHaveBeenCalledWith('id', ['r1', 'r2', 'r3'])
    expect(state.chains['published_units'][0].in).toHaveBeenCalledWith('post_id', ['p1', 'p2', 'p3'])

    expect(res.units).toEqual([
      { item_id: 'q1', title: 'OpenAI kauft X', source: 'The Information', bundle_type_selected: 'topic', day: '2026-10-04', contrast_heading: 'Kontrast 0,71' },
      { item_id: 'q2', title: 'Apple und KI', source: 'stratechery.com', bundle_type_selected: null, day: '2026-10-03', contrast_heading: null },
      { item_id: 'q3', title: 'Nvidia-Quartal', source: 'Heise', bundle_type_selected: null, day: '2026-10-02', contrast_heading: null },
      { item_id: 'q5', title: 'Anthropic-Runde', source: 'Bloomberg', bundle_type_selected: null, day: '2026-09-30', contrast_heading: 'Genau 0,65' },
    ])
    expect(res.text).toContain('- 2026-10-04 · The Information · OpenAI kauft X [topic]\n  stattdessen lief: Kontrast 0,71')
    expect(res.text).toContain('- 2026-09-30 · Bloomberg · Anthropic-Runde\n  stattdessen lief: Genau 0,65')
    expect(warnSpy).toHaveBeenCalledTimes(1) // q4 ohne news_queue-Zeile
  })

  it('nimmt den Post des jeweiligen Praezedenzfalls, wenn dasselbe Item an zwei Tagen gestrichen wurde', async () => {
    const { loadNegativeBlock } = await import('@/lib/curation/negatives')
    // curation_precedents ist nur auf (day, item_id) unique: q1 wurde am 10-04 aus p2
    // und am 10-02 aus p1 gestrichen. Jede Einheit bekommt den Kontrast aus IHREM Post.
    state.queues['curation_precedents'] = [{ data: [
      { item_id: 'q1', day: '2026-10-04', bundle_type_selected: null, post_id: 'p2' },
      { item_id: 'q1', day: '2026-10-02', bundle_type_selected: null, post_id: 'p1' },
    ], error: null }]
    state.queues['news_queue'] = [{ data: [QUEUE[0]], error: null }]
    state.queues['daily_repo'] = [{ data: [REPO[0]], error: null }]
    state.queues['published_units'] = [{ data: [
      { post_id: 'p1', heading: 'aus p1', embedding: [0.7, 0.7] },    // cos zu [1,0] = 0,707
      { post_id: 'p2', heading: 'aus p2', embedding: [0.75, 0.66] },  // cos zu [1,0] = 0,751
    ], error: null }]

    const res = await loadNegativeBlock(client, { days: 14, asOf: '2026-10-06' })

    expect(state.chains['news_queue'][0].in).toHaveBeenCalledWith('id', ['q1', 'q1'])
    expect(state.chains['published_units'][0].in).toHaveBeenCalledWith('post_id', ['p2', 'p1'])
    expect(res.units.map(u => [u.day, u.contrast_heading])).toEqual([
      ['2026-10-04', 'aus p2'],
      ['2026-10-02', 'aus p1'],
    ])
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('ueberspringt daily_repo und published_units, wenn kein Item ein Embedding hat', async () => {
    const { loadNegativeBlock } = await import('@/lib/curation/negatives')
    state.queues['curation_precedents'] = [{ data: [PREC[1]], error: null }]
    state.queues['news_queue'] = [{ data: [QUEUE[1]], error: null }]

    const res = await loadNegativeBlock(client, { days: 14, asOf: '2026-10-06' })

    expect(client.from.mock.calls.map((c: unknown[]) => c[0])).toEqual(['curation_precedents', 'news_queue'])
    expect(res.units).toHaveLength(1)
    expect(res.units[0].contrast_heading).toBeNull()
    expect(res.text).toBe(`Gewählt, aber gestrichen\n${INTRO}\n- 2026-10-03 · stratechery.com · Apple und KI`)
    // 24 + 1 + 150 + 1 + 45 = 221 Zeichen; ceil(221 / 3,5) = 64 — fester Wert, damit
    // eine geaenderte Formel (z. B. / 4) den Test rot macht.
    expect(res.text).toHaveLength(221)
    expect(res.approxTokens).toBe(64)
  })

  it('liest news_queue in Scheiben von 200 IDs', async () => {
    const { loadNegativeBlock } = await import('@/lib/curation/negatives')
    const ids = Array.from({ length: 201 }, (_, i) => `q${i}`)
    state.queues['curation_precedents'] = [{ data: ids.map(id => ({ item_id: id, day: '2026-10-01', bundle_type_selected: null, post_id: null })), error: null }]
    state.queues['news_queue'] = [
      { data: [], error: null },
      { data: [{ id: 'q200', title: 'Letztes Item', source_display_name: null, source_identifier: 'x.com', daily_repo_id: null }], error: null },
    ]

    const res = await loadNegativeBlock(client, { days: 14, asOf: '2026-10-06' })

    expect(client.from.mock.calls.map((c: unknown[]) => c[0])).toEqual(['curation_precedents', 'news_queue', 'news_queue'])
    expect(state.chains['news_queue']).toHaveLength(2)
    expect(state.chains['news_queue'][0].in).toHaveBeenCalledWith('id', ids.slice(0, 200))
    expect(state.chains['news_queue'][1].in).toHaveBeenCalledWith('id', ['q200'])
    expect(res.units.map(u => u.item_id)).toEqual(['q200'])
    expect(warnSpy).toHaveBeenCalledTimes(1) // 200 Praezedenzfaelle ohne news_queue-Zeile, eine Meldung
  })

  it('liefert bei leerer Treffermenge leeren Block ohne weitere Reads', async () => {
    const { loadNegativeBlock } = await import('@/lib/curation/negatives')
    state.queues['curation_precedents'] = [{ data: [], error: null }]

    const res = await loadNegativeBlock(client, { days: 14, asOf: '2026-10-06' })

    expect(res).toEqual({ text: '', units: [], approxTokens: 0 })
    expect(client.from).toHaveBeenCalledTimes(1)
  })

  it('nimmt ohne asOf den heutigen Berlin-Tag', async () => {
    const { loadNegativeBlock } = await import('@/lib/curation/negatives')
    // 23:30 UTC am 5.10. ist in Berlin (CEST, UTC+2) schon der 6.10. — ein UTC-Datum
    // oder eine andere Zeitzone wuerde hier '2026-10-05' liefern.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T23:30:00Z'))
    state.queues['curation_precedents'] = [{ data: [], error: null }]

    await loadNegativeBlock(client, { days: 14 })

    const prec = state.chains['curation_precedents'][0]
    expect(prec.lt).toHaveBeenCalledWith('day', '2026-10-06')
    expect(prec.gte).toHaveBeenCalledWith('day', '2026-09-22')
  })

  it('wirft bei DB-Fehler in curation_precedents mit Tabellenname', async () => {
    const { loadNegativeBlock } = await import('@/lib/curation/negatives')
    state.queues['curation_precedents'] = [{ data: null, error: { message: 'boom' } }]

    await expect(loadNegativeBlock(client, { days: 14, asOf: '2026-10-06' }))
      .rejects.toThrow('curation_precedents: boom')
  })

  it('wirft bei DB-Fehler in published_units mit Tabellenname (nach drei erfolgreichen Reads)', async () => {
    const { loadNegativeBlock } = await import('@/lib/curation/negatives')
    state.queues['curation_precedents'] = [{ data: PREC, error: null }]
    state.queues['news_queue'] = [{ data: QUEUE, error: null }]
    state.queues['daily_repo'] = [{ data: REPO, error: null }]
    state.queues['published_units'] = [{ data: null, error: { message: 'boom' } }]

    await expect(loadNegativeBlock(client, { days: 14, asOf: '2026-10-06' }))
      .rejects.toThrow('published_units: boom')
    expect(client.from.mock.calls.map((c: unknown[]) => c[0]))
      .toEqual(['curation_precedents', 'news_queue', 'daily_repo', 'published_units'])
  })
})
