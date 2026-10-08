/**
 * Stufen-Klassifikation der Präzedenzfälle (Curation Phase 0, Task 11).
 *
 * BEFUND 2026-10-06 (Spec „Datenquellen und Lernen"): Die Negativmenge
 * „gewählt, aber gestrichen" ist die stärkste Lernquelle des Betreibers —
 * aber ein gestrichenes Item, das mit >= 0,8 einem veröffentlichten
 * Heading entspricht, ist KEINE Ablehnung, sondern eine Zusammenlegung
 * (merged). Ein unberührtes Techmeme-Item, das im Job stand und nicht
 * lief, hat der Betreiber nie gewählt — es ist pending_never_selected.
 * Und ein Hand-Item, das unter einem H2 OHNE Queue-Marker lief (Altbestand,
 * Prod 2026-10-06: 171 von 858 H2), ist kein Fehltreffer.
 *
 * classifyPrecedents & Co. sind rein (keine Mocks). replacePrecedentDay
 * bekommt den Client als Parameter → makeChain-Muster, kein vi.mock.
 * Vektoren 2-D wie in semantic-dedup.test.ts:
 * cos([4,3],[1,0]) = 4/5 = 0,8 exakt (Ganzzahlen, keine Rundung);
 * cos([0.79,0.6131],[1,0]) ≈ 0,790; cos([0,0],·) = NaN (generator.ts:151).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueEventActor, QueueEventName, QueueEventRow } from '@/lib/news-queue/events'
import { isHandItem } from '@/lib/curation/origin'
import {
  berlinDay, buildPrecedentSelected, classifyPrecedents, eventsAsOf, isoDayShift, parseSinceArg, pickPrecedentJobs,
  precedentJobsSince, precedentSelectedItems, replacePrecedentDay, staleDaysOf,
  type PrecedentInputs, type PrecedentJob, type PrecedentQueueRow, type PrecedentRow, type PrecedentSelected,
  type PrecedentUnit,
} from '@/lib/curation/precedents'

const state = vi.hoisted(() => ({
  queues: {} as Record<string, unknown[]>,
  fallback: { data: null as unknown, error: null as unknown },
  chains: {} as Record<string, any[]>,
}))

function makeChain(table: string) {
  const chain: any = {}
  for (const m of ['select', 'eq', 'in', 'is', 'or', 'lt', 'gte', 'order', 'limit', 'range', 'update', 'insert', 'upsert', 'delete']) {
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

beforeEach(() => {
  state.queues = {}
  state.chains = {}
  state.fallback = { data: null, error: null }
  client.from.mockClear()
})

const DAY = '2026-10-05'
const JOB = 'job-1'
const POST = 'post-1'

const E_BASE = [1, 0]
const E_SIM_080 = [4, 3]          // cos zu E_BASE = 0,8 exakt
const E_SIM_079 = [0.79, 0.6131]  // cos zu E_BASE ≈ 0,790
const E_SIM_079_Y = [0.6131, 0.79] // cos zu E_FAR ≈ 0,790, zu E_BASE ≈ 0,613
const E_DIAG = [0.7071, 0.7071]   // cos zu E_BASE und E_FAR ≈ 0,707 (bitgleich)
const E_FAR = [0, 1]              // cos zu E_BASE = 0
const E_ZERO = [0, 0]             // cos zu allem = NaN
const E_NW = [-0.8, 0.6]          // cos zu E_FAR = 0,6, zu E_BASE = −0,8
const E_SE = [0.5, -0.866]        // cos zu E_BASE ≈ 0,5, zu E_FAR ≈ −0,866

function unit(position: number, heading: string, memberIds: string[], extra: Partial<PrecedentUnit> = {}): PrecedentUnit {
  return { position, heading, bundleType: null, memberIds, embedding: E_BASE, ...extra }
}

function sel(id: string, extra: Partial<PrecedentSelected> = {}): PrecedentSelected {
  return { id, bundle_type: null, embedding: null, isHand: true, ...extra }
}

function inputs(over: Partial<PrecedentInputs> = {}): PrecedentInputs {
  return { day: DAY, jobId: JOB, postId: POST, selected: [], poolNeverSelected: [], publishedUnits: [], ...over }
}

describe('classifyPrecedents — published', () => {
  it('Item in memberIds einer Einheit → published mit bundle_type_published, ohne matched_heading', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('a', { bundle_type: 'topic' })],
      publishedUnits: [unit(0, 'Nvidia kauft', ['a'], { bundleType: 'cover_story' })],
    }))
    expect(rows).toEqual([{
      day: DAY, item_id: 'a', story_key: null, stage: 'published',
      bundle_type_selected: 'topic', bundle_type_published: 'cover_story',
      job_id: JOB, post_id: POST, matched_heading: null, similarity: null,
    }])
  })

  it('published gilt auch für Nicht-Hand-Items (Techmeme, das lief) und ohne Embedding', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('t', { isHand: false, embedding: null })],
      publishedUnits: [unit(0, 'Thema des Tages', ['x', 't'], { bundleType: 'topic', embedding: null })],
    }))
    expect(rows.map((r) => r.stage)).toEqual(['published'])
    expect(rows[0].bundle_type_published).toBe('topic')
  })

  it('Mitgliedschaft schlägt Similarity: ein published Item wird nie merged', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('a', { embedding: E_SIM_080 })],
      publishedUnits: [unit(0, 'Erste', ['a']), unit(1, 'Zweite', ['b'], { embedding: E_BASE })],
    }))
    expect(rows[0].stage).toBe('published')
    expect(rows[0].similarity).toBeNull()
  })
})

describe('classifyPrecedents — merged vs. dropped_after_selection (Schwelle 0,8)', () => {
  it('Hand-Item mit Similarity 0,80 zu einer Einheit → merged mit matched_heading und similarity', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('a', { embedding: E_SIM_080, bundle_type: 'deep_dive' })],
      publishedUnits: [unit(0, 'Gelaufen', ['b'])],
    }))
    expect(rows).toEqual([{
      day: DAY, item_id: 'a', story_key: null, stage: 'merged',
      bundle_type_selected: 'deep_dive', bundle_type_published: null,
      job_id: JOB, post_id: POST, matched_heading: 'Gelaufen', similarity: 0.8,
    }])
  })

  it('Hand-Item mit Similarity 0,79 → dropped_after_selection, ohne matched_heading', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('a', { embedding: E_SIM_079 })],
      publishedUnits: [unit(0, 'Gelaufen', ['b'])],
    }))
    expect(rows[0].stage).toBe('dropped_after_selection')
    expect(rows[0].matched_heading).toBeNull()
    expect(rows[0].similarity).toBeNull()
  })

  it('expliziter threshold-Parameter: 0,79 wird mit threshold 0,75 zu merged', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('a', { embedding: E_SIM_079 })],
      publishedUnits: [unit(0, 'Gelaufen', ['b'])],
    }), 0.75)
    expect(rows[0].stage).toBe('merged')
    expect(rows[0].similarity).toBeCloseTo(0.79, 2)
  })

  it('merged nimmt die ÄHNLICHSTE Einheit (max cosine), nicht die erste über der Schwelle', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('a', { embedding: E_BASE })],
      publishedUnits: [
        unit(0, 'Knapp drüber', ['b'], { embedding: E_SIM_080 }),
        unit(1, 'Identisch', ['c'], { embedding: E_BASE }),
      ],
    }))
    expect(rows[0].stage).toBe('merged')
    expect(rows[0].matched_heading).toBe('Identisch')
    expect(rows[0].similarity).toBeCloseTo(1, 6)
  })

  it('Null-Vektor einer Einheit (cosine NaN) blockiert spätere Treffer nicht', () => {
    // BEFUND 2026-10-06: cosineSimilarity([1,0],[0,0]) = NaN. Ohne
    // Number.isFinite-Schutz wäre best = { Null, NaN } und jeder spätere
    // Vergleich `similarity > NaN` false → dropped statt merged.
    const rows = classifyPrecedents(inputs({
      selected: [sel('a', { embedding: E_BASE })],
      publishedUnits: [
        unit(0, 'Null', ['b'], { embedding: E_ZERO }),
        unit(1, 'Identisch', ['c'], { embedding: E_BASE }),
      ],
    }))
    expect(rows[0].stage).toBe('merged')
    expect(rows[0].matched_heading).toBe('Identisch')
    expect(rows[0].similarity).toBeCloseTo(1, 6)
  })

  it('Hand-Item ohne Embedding → dropped_after_selection (keine Similarity möglich)', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('a', { embedding: null })],
      publishedUnits: [unit(0, 'Gelaufen', ['b'])],
    }))
    expect(rows[0].stage).toBe('dropped_after_selection')
  })

  it('Einheiten ohne Embedding, mit fremder Dimension oder Null-Vektor werden still übersprungen', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('a', { embedding: E_BASE })],
      publishedUnits: [
        unit(0, 'Ohne', ['b'], { embedding: null }),
        unit(1, 'Leer', ['c'], { embedding: [] }),
        unit(2, 'Dreidimensional', ['d'], { embedding: [1, 0, 0] }),
        unit(3, 'Null', ['e'], { embedding: E_ZERO }),
      ],
    }))
    expect(rows[0].stage).toBe('dropped_after_selection')
    expect(rows[0].similarity).toBeNull()
  })

  it('Hand-Item, das zu keiner Einheit passt (Similarity 0) → dropped_after_selection', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('a', { embedding: E_FAR, bundle_type: 'recap' })],
      publishedUnits: [unit(0, 'Gelaufen', ['b'])],
    }))
    expect(rows[0]).toMatchObject({ stage: 'dropped_after_selection', bundle_type_selected: 'recap', job_id: JOB, post_id: POST })
  })
})

describe('classifyPrecedents — Einheiten ohne Queue-Marker (Review-Fokus 1, Entscheidung 7)', () => {
  it('ähnlichster Hand-Kandidat einer markerlosen Einheit bekommt KEINE Zeile, der Rest bleibt dropped', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('a', { embedding: E_SIM_079 }), sel('b', { embedding: E_FAR })],
      publishedUnits: [unit(0, 'Mit Marker', ['x'], { embedding: null }), unit(1, 'Ohne Marker', [])],
    }))
    expect(rows.map((r) => [r.item_id, r.stage])).toEqual([['b', 'dropped_after_selection']])
  })

  it('global bester Kandidat gewinnt, nicht der erste in der Eingabe', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('a', { embedding: E_DIAG }), sel('b', { embedding: E_SIM_079 })],
      publishedUnits: [unit(0, 'Ohne Marker', [])],
    }))
    expect(rows.map((r) => r.item_id)).toEqual(['a'])
    expect(rows[0].stage).toBe('dropped_after_selection')
  })

  it('eins-zu-eins: zwei markerlose Einheiten nehmen zwei verschiedene Kandidaten heraus', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('a', { embedding: E_SIM_079 }), sel('b', { embedding: E_SIM_079_Y }), sel('c', { embedding: E_DIAG })],
      publishedUnits: [unit(0, 'Ohne A', [], { embedding: E_BASE }), unit(1, 'Ohne B', [], { embedding: E_FAR })],
    }))
    expect(rows.map((r) => [r.item_id, r.stage])).toEqual([['c', 'dropped_after_selection']])
  })

  it('Gleichstand zweier Einheiten für einen Kandidaten: die kleinere Position gewinnt, nicht die Eingabereihenfolge', () => {
    // a passt zu beiden Einheiten gleich gut (0,707) und kommt zuerst dran.
    // Richtig: a → Position 0 (E_BASE); übrig bleibt Position 1 (E_FAR), dort
    // ist b (0,6) besser als c (−0,866) → b fällt heraus, c bleibt dropped.
    // Falsch (Eingabe-/Stabilitätsreihenfolge, Position 1 steht vorn): a →
    // Position 1, übrig Position 0, dort c (0,5) vor b (−0,8) → b bliebe.
    const rows = classifyPrecedents(inputs({
      selected: [sel('a', { embedding: E_DIAG }), sel('b', { embedding: E_NW }), sel('c', { embedding: E_SE })],
      publishedUnits: [unit(1, 'Ohne B', [], { embedding: E_FAR }), unit(0, 'Ohne A', [], { embedding: E_BASE })],
    }))
    expect(rows.map((r) => [r.item_id, r.stage])).toEqual([['c', 'dropped_after_selection']])
  })

  it('Gleichstand zweier Kandidaten für eine Einheit: die frühere Eingabe fällt heraus', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('a', { embedding: E_SIM_079 }), sel('b', { embedding: E_SIM_079 })],
      publishedUnits: [unit(0, 'Ohne Marker', [])],
    }))
    expect(rows.map((r) => [r.item_id, r.stage])).toEqual([['b', 'dropped_after_selection']])
  })

  it('markerlose Einheit ohne Embedding und Kandidat ohne Embedding bleiben unzugeordnet → dropped', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('a', { embedding: E_BASE }), sel('b', { embedding: null })],
      publishedUnits: [unit(0, 'Ohne Marker', [], { embedding: null }), unit(1, 'Mit Marker', ['x'], { embedding: E_FAR })],
    }))
    expect(rows.map((r) => r.stage)).toEqual(['dropped_after_selection', 'dropped_after_selection'])
  })

  it('merged in eine markerlose Einheit „erklärt" sie: kein weiterer Kandidat fällt heraus', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('a', { embedding: E_BASE }), sel('b', { embedding: E_SIM_079 })],
      publishedUnits: [unit(0, 'Ohne Marker', [])],
    }))
    expect(rows.map((r) => [r.item_id, r.stage, r.matched_heading])).toEqual([
      ['a', 'merged', 'Ohne Marker'],
      ['b', 'dropped_after_selection', null],
    ])
  })

  it('Nicht-Hand-Items und published Items sind nie Kandidaten', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('t', { isHand: false, embedding: E_BASE }), sel('p', { embedding: E_BASE })],
      publishedUnits: [unit(0, 'Mit Marker', ['p'], { embedding: null }), unit(1, 'Ohne Marker', [], { embedding: E_FAR })],
    }))
    expect(rows.map((r) => [r.item_id, r.stage])).toEqual([['t', 'pending_never_selected'], ['p', 'published']])
  })
})

describe('classifyPrecedents — Altbestand-Bündel mit höchstens einer ID (Entscheidung 7b, Abschluss-Review C1)', () => {
  // Altposts: Bündel-H2 trägt nur EINE queueItemId (embedQueueItemIds), die
  // Pipeline bündelte aber alle Items desselben Labels in diese H2.
  it('recap-Bündel mit 1 ID, drei gewählte recap-Items: A published, B und C ohne Zeile', () => {
    const rows = classifyPrecedents(inputs({
      selected: [
        sel('A', { bundle_type: 'recap', embedding: E_FAR }),
        sel('B', { bundle_type: 'recap', embedding: E_FAR }),
        sel('C', { bundle_type: 'recap', embedding: E_SIM_079 }),
      ],
      publishedUnits: [unit(0, 'Nachlese', ['A'], { bundleType: 'recap', embedding: E_BASE })],
    }))
    expect(rows.map((r) => [r.item_id, r.stage])).toEqual([['A', 'published']])
  })

  it('Bündel-H2 ganz ohne ID: alle gleich gelabelten Hand-Items ohne Zeile (n-zu-1), anders gelabelte bleiben dropped', () => {
    const rows = classifyPrecedents(inputs({
      selected: [
        sel('A', { bundle_type: 'deep_dive', embedding: E_FAR }),
        sel('B', { bundle_type: 'deep_dive', embedding: E_FAR }),
        sel('D', { bundle_type: 'recap', embedding: E_FAR }),
        sel('E', { bundle_type: null, embedding: E_FAR }),
      ],
      publishedUnits: [
        unit(0, 'Deep Dive', [], { bundleType: 'deep_dive', embedding: E_BASE }),
        unit(1, 'Einzel', ['x'], { embedding: E_BASE }),
      ],
    }))
    // Die markerlose Einheit ist durch 7b erklärt — Entscheidung 7 nimmt
    // daher nicht zusätzlich D oder E heraus.
    expect(rows.map((r) => [r.item_id, r.stage, r.bundle_type_selected])).toEqual([
      ['D', 'dropped_after_selection', 'recap'],
      ['E', 'dropped_after_selection', null],
    ])
  })

  it('Phase-0-Bündel mit allen IDs (≥ 2): ein gleich gelabeltes Hand-Item ohne ID-Treffer bleibt dropped', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('A', { bundle_type: 'recap' }), sel('B', { bundle_type: 'recap' }), sel('C', { bundle_type: 'recap', embedding: E_FAR })],
      publishedUnits: [unit(0, 'Nachlese', ['A', 'B'], { bundleType: 'recap', embedding: E_BASE })],
    }))
    expect(rows.map((r) => [r.item_id, r.stage])).toEqual([['A', 'published'], ['B', 'published'], ['C', 'dropped_after_selection']])
  })

  it('Einheit ohne Label (Einzelmeldung mit 1 ID) greift nicht: ungelabeltes Hand-Item bleibt dropped', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('A'), sel('B', { embedding: E_FAR })],
      publishedUnits: [unit(0, 'Einzel', ['A'], { embedding: E_BASE })],
    }))
    expect(rows.map((r) => [r.item_id, r.stage])).toEqual([['A', 'published'], ['B', 'dropped_after_selection']])
  })
})

describe('classifyPrecedents — Nicht-Hand-Items und Pool', () => {
  it('selected, nicht Hand, nicht veröffentlicht → pending_never_selected (auch bei Similarity 1,0)', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('t', { isHand: false, embedding: E_BASE, bundle_type: 'topic' })],
      publishedUnits: [unit(0, 'Gelaufen', ['b'])],
    }))
    expect(rows).toEqual([{
      day: DAY, item_id: 't', story_key: null, stage: 'pending_never_selected',
      bundle_type_selected: 'topic', bundle_type_published: null,
      job_id: JOB, post_id: POST, matched_heading: null, similarity: null,
    }])
  })

  it('poolNeverSelected → pending_never_selected ohne Label, nach den selected-Zeilen', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('a')],
      poolNeverSelected: ['p1', 'p2'],
      publishedUnits: [unit(0, 'Gelaufen', ['a'])],
    }))
    expect(rows.map((r) => [r.item_id, r.stage])).toEqual([
      ['a', 'published'],
      ['p1', 'pending_never_selected'],
      ['p2', 'pending_never_selected'],
    ])
    expect(rows[1]).toEqual({
      day: DAY, item_id: 'p1', story_key: null, stage: 'pending_never_selected',
      bundle_type_selected: null, bundle_type_published: null,
      job_id: JOB, post_id: POST, matched_heading: null, similarity: null,
    })
  })

  it('Pool-ID in memberIds einer Einheit → published ohne bundle_type_selected (Entscheidung 6)', () => {
    const rows = classifyPrecedents(inputs({
      poolNeverSelected: ['p'],
      publishedUnits: [unit(0, 'Lief trotzdem', ['p'], { bundleType: 'topic' })],
    }))
    expect(rows).toEqual([{
      day: DAY, item_id: 'p', story_key: null, stage: 'published',
      bundle_type_selected: null, bundle_type_published: 'topic',
      job_id: JOB, post_id: POST, matched_heading: null, similarity: null,
    }])
  })

  it('je item_id höchstens eine Zeile: Duplikate in selected und Pool∩selected fallen weg', () => {
    const rows = classifyPrecedents(inputs({
      selected: [sel('a', { bundle_type: 'topic' }), sel('a', { bundle_type: 'recap' })],
      poolNeverSelected: ['a', 'p1', 'p1'],
      publishedUnits: [unit(0, 'Gelaufen', ['a'])],
    }))
    expect(rows.map((r) => r.item_id)).toEqual(['a', 'p1'])
    expect(rows[0].bundle_type_selected).toBe('topic') // erstes Vorkommen gewinnt
  })

  it('leere Eingabe → leere Liste', () => {
    expect(classifyPrecedents(inputs())).toEqual([])
  })
})

describe('eventsAsOf — Hand-Status zum Zeitpunkt des Jobs (Review-Fokus 3)', () => {
  const ITEM = 'q-1'
  let seq = 0
  function ev(actor: QueueEventActor, event: QueueEventName, at: string, to_status: string | null): QueueEventRow {
    seq += 1
    return { id: seq, queue_item_id: ITEM, event, actor, from_status: null, to_status, from_role: null, to_role: null, reason: null, run_id: null, at }
  }

  it('operator select (Tag D) → remove → pipeline select (D+1): as-of Job am Tag D bleibt Hand-Item', () => {
    // WARUM: loadEventsForItems liefert ALLE Events, auch spätere. Ohne
    // as-of-Schnitt wäre das jüngste Herkunfts-Event der Nachtlauf (pipeline)
    // → kein Hand-Item → pending_never_selected statt dropped_after_selection.
    const events = [
      ev('operator', 'select', '2026-10-05T05:00:00.000Z', 'selected'),
      ev('operator', 'remove', '2026-10-05T07:00:00.000Z', 'pending'),
      ev('pipeline', 'select', '2026-10-06T03:30:00.000Z', 'selected'),
    ]
    const jobAt = '2026-10-05T06:00:00.000Z'
    const item = { id: ITEM, metadata: {} }
    expect(isHandItem(item, events)).toBe(false)
    expect(eventsAsOf(events, jobAt).map((e) => e.id)).toEqual([events[0].id])
    expect(isHandItem(item, eventsAsOf(events, jobAt))).toBe(true)
  })

  it('Event genau zum Job-Zeitpunkt zählt mit (<=), Reihenfolge bleibt', () => {
    const at = '2026-10-05T06:00:00.000Z'
    const events = [
      ev('pipeline', 'select', '2026-10-05T05:59:59.000Z', 'selected'),
      ev('operator', 'relabel', at, null),
      ev('operator', 'panel_accept', '2026-10-05T06:00:00.001Z', null),
    ]
    expect(eventsAsOf(events, at).map((e) => e.event)).toEqual(['select', 'relabel'])
  })

  it('Füll-Item der Pipeline mit select-Event vor dem Job → kein Hand-Item (ab Phase 0)', () => {
    const events = [ev('pipeline', 'select', '2026-10-05T05:59:50.000Z', 'selected')]
    expect(isHandItem({ id: ITEM, metadata: {} }, eventsAsOf(events, '2026-10-05T06:00:00.000Z'))).toBe(false)
  })
})

describe('buildPrecedentSelected — Label, Embedding, Hand-Status je gewähltem Item', () => {
  const AS_OF = '2026-10-05T06:00:00.000Z'
  function q(id: string, extra: Partial<PrecedentQueueRow> = {}): PrecedentQueueRow {
    return { id, bundle_type: null, metadata: {}, daily_repo_id: null, ...extra }
  }
  function ev(id: number, item: string, actor: QueueEventActor, at: string): QueueEventRow {
    return { id, queue_item_id: item, event: 'select', actor, from_status: 'pending', to_status: 'selected', from_role: null, to_role: null, reason: null, run_id: null, at }
  }

  it('Label zum Zeitpunkt der Auswahl gewinnt; news_queue.bundle_type nur bei fehlendem Schlüssel; ohne Queue-Zeile null (Entscheidungen 1, 2)', () => {
    const out = buildPrecedentSelected(
      [
        { id: 'a', bundle_type: 'topic' },
        { id: 'alt', bundle_type: undefined },
        { id: 'weg', bundle_type: undefined },
      ],
      new Map([['a', q('a', { bundle_type: 'recap' })], ['alt', q('alt', { bundle_type: 'deep_dive' })]]),
      new Map(), new Map(), AS_OF,
    )
    expect(out.map((s) => [s.id, s.bundle_type])).toEqual([['a', 'topic'], ['alt', 'deep_dive'], ['weg', null]])
    // Item nicht mehr in news_queue: metadata null → Fallback operator → Hand-Item, ohne Embedding.
    expect(out[2]).toEqual({ id: 'weg', bundle_type: null, embedding: null, isHand: true })
  })

  it('explizites null (zum Auswahlzeitpunkt ungelabelt) fällt NICHT auf ein späteres news_queue-Label zurück (Abschluss-Review C2)', () => {
    // toPipelineItem schreibt seit 2026-07-18 immer bundle_type: … ?? null.
    // Ein Label aus dem Bündel-Toggle nach dem Job darf nicht rückwirkend
    // in bundle_type_selected des vergangenen Tages landen.
    const out = buildPrecedentSelected(
      [{ id: 'x', bundle_type: null }],
      new Map([['x', q('x', { bundle_type: 'topic' })]]),
      new Map(), new Map(), AS_OF,
    )
    expect(out[0].bundle_type).toBeNull()
  })

  it('Embedding über daily_repo_id; ohne daily_repo_id oder ohne Vektor null', () => {
    const out = buildPrecedentSelected(
      [{ id: 'a', bundle_type: null }, { id: 'b', bundle_type: null }, { id: 'c', bundle_type: null }],
      new Map([['a', q('a', { daily_repo_id: 'r1' })], ['b', q('b', { daily_repo_id: 'r-ohne' })], ['c', q('c')]]),
      new Map([['r1', E_BASE]]), new Map(), AS_OF,
    )
    expect(out.map((s) => s.embedding)).toEqual([E_BASE, null, null])
  })

  it('Hand-Status as-of: späteres Pipeline-Select kippt kein Hand-Item, unberührtes Techmeme ist keins', () => {
    const out = buildPrecedentSelected(
      [{ id: 'h', bundle_type: null }, { id: 't', bundle_type: null }],
      new Map([['h', q('h')], ['t', q('t', { metadata: { techmeme: true } })]]),
      new Map(),
      new Map([['h', [ev(1, 'h', 'operator', '2026-10-05T05:00:00.000Z'), ev(2, 'h', 'pipeline', '2026-10-06T03:30:00.000Z')]]]),
      AS_OF,
    )
    expect(out.map((s) => [s.id, s.isHand])).toEqual([['h', true], ['t', false]])
  })
})

describe('precedentSelectedItems / berlinDay', () => {
  it('liest id + bundle_type aus selected_items, dedupliziert, verwirft Einträge ohne String-ID', () => {
    expect(precedentSelectedItems([
      { id: 'a', title: 'A', bundle_type: 'topic' },
      { id: 'b', bundle_type: null },
      { id: 'a', bundle_type: 'recap' },
      { id: '', bundle_type: 'topic' },
      { title: 'ohne id' },
      null,
      { id: 'c', bundle_type: '' },
      { id: 'd', title: 'Job vor 2026-07-18, ohne Schlüssel' },
    ])).toEqual([
      { id: 'a', bundle_type: 'topic' },
      { id: 'b', bundle_type: null },
      { id: 'c', bundle_type: null },
      { id: 'd', bundle_type: undefined },
    ])
    // toEqual setzt undefined und fehlend gleich — hier die Unterscheidung explizit.
    expect(precedentSelectedItems([{ id: 'b', bundle_type: null }])[0].bundle_type).toBeNull()
    expect(precedentSelectedItems([{ id: 'd' }])[0].bundle_type).toBeUndefined()
    expect(precedentSelectedItems(null)).toEqual([])
    expect(precedentSelectedItems({ id: 'a' })).toEqual([])
  })

  it('berlinDay: 22:30Z im Sommer ist schon der nächste Berliner Tag, 22:30Z im Winter noch nicht', () => {
    expect(berlinDay('2026-10-05T22:30:00.000Z')).toBe('2026-10-06')
    expect(berlinDay('2026-12-05T22:30:00.000Z')).toBe('2026-12-05')
  })
})

describe('pickPrecedentJobs — welche Jobs klassifiziert werden (Review-Fokus 2)', () => {
  const U_OK = [unit(0, 'Mit Marker', ['x'])]
  const U_NONE = [unit(0, 'Ohne Marker', []), unit(1, 'Auch ohne', [])]
  function job(id: string, created_at: string, generated_post_id: string | null, selected_items: unknown = [{ id: 'x' }]): PrecedentJob {
    return { id, created_at, generated_post_id, selected_items }
  }

  it('Job ohne Post → no_post, nicht klassifiziert', () => {
    const res = pickPrecedentJobs([job('j1', '2026-10-05T06:00:00Z', null)], new Map(), new Map())
    expect(res.byDay.size).toBe(0)
    expect(res.skipped).toMatchObject({ no_post: 1, not_published: 0 })
  })

  it('Post draft, archived oder fehlend → not_published, nicht klassifiziert', () => {
    const jobs = [
      job('j1', '2026-10-03T06:00:00Z', 'p-draft'),
      job('j2', '2026-10-04T06:00:00Z', 'p-arch'),
      job('j3', '2026-10-05T06:00:00Z', 'p-weg'),
    ]
    const status = new Map([['p-draft', 'draft'], ['p-arch', 'archived']])
    const units = new Map([['p-draft', U_OK], ['p-arch', U_OK], ['p-weg', U_OK]])
    const res = pickPrecedentJobs(jobs, status, units)
    expect(res.byDay.size).toBe(0)
    expect(res.skipped.not_published).toBe(3)
  })

  it('zwei Jobs mit veröffentlichtem Post am selben Berlin-Tag → der jüngste gewinnt, der andere superseded (auch unsortiert)', () => {
    // 22:30Z am 04.10. ist Berlin 05.10. (CEST) — gleicher Tag wie 06:00Z am 05.10.
    const late = job('spät', '2026-10-05T06:00:00Z', 'p2')
    const early = job('früh', '2026-10-04T22:30:00Z', 'p1')
    const status = new Map([['p1', 'published'], ['p2', 'published']])
    const units = new Map([['p1', U_OK], ['p2', U_OK]])
    for (const order of [[early, late], [late, early]]) {
      const res = pickPrecedentJobs(order, status, units)
      expect([...res.byDay.entries()].map(([d, j]) => [d, j.id])).toEqual([['2026-10-05', 'spät']])
      expect(res.skipped.superseded).toBe(1)
    }
  })

  it('jüngerer Job ohne Post lässt den älteren mit veröffentlichtem Post zum Zug kommen', () => {
    const res = pickPrecedentJobs(
      [job('alt', '2026-10-05T05:00:00Z', 'p1'), job('neu', '2026-10-05T06:00:00Z', null)],
      new Map([['p1', 'published']]), new Map([['p1', U_OK]]),
    )
    expect(res.byDay.get('2026-10-05')?.id).toBe('alt')
    expect(res.skipped).toMatchObject({ no_post: 1, superseded: 0 })
  })

  it('jüngster Job ohne published_units → no_units, OHNE Rückfall auf den älteren', () => {
    const res = pickPrecedentJobs(
      [job('alt', '2026-10-05T05:00:00Z', 'p1'), job('neu', '2026-10-05T06:00:00Z', 'p2')],
      new Map([['p1', 'published'], ['p2', 'published']]),
      new Map([['p1', U_OK]]),
    )
    expect(res.byDay.size).toBe(0)
    expect(res.skipped).toMatchObject({ superseded: 1, no_units: 1 })
  })

  it('nur Einheiten ohne Marker → no_attributable_units; leere Auswahl → no_selected', () => {
    const res = pickPrecedentJobs(
      [job('j1', '2026-10-04T06:00:00Z', 'p1'), job('j2', '2026-10-05T06:00:00Z', 'p2', [])],
      new Map([['p1', 'published'], ['p2', 'published']]),
      new Map([['p1', U_NONE], ['p2', U_OK]]),
    )
    expect(res.byDay.size).toBe(0)
    expect(res.skipped).toMatchObject({ no_attributable_units: 1, no_selected: 1 })
  })

  it('gültige Tage aufsteigend, Teil-Markierung reicht (eine Einheit mit Marker)', () => {
    const res = pickPrecedentJobs(
      [job('b', '2026-10-05T06:00:00Z', 'p2'), job('a', '2026-10-04T06:00:00Z', 'p1')],
      new Map([['p1', 'published'], ['p2', 'published']]),
      new Map([['p1', [...U_NONE, ...U_OK]], ['p2', U_OK]]),
    )
    expect([...res.byDay.keys()]).toEqual(['2026-10-04', '2026-10-05'])
    expect(Object.values(res.skipped).every((n) => n === 0)).toBe(true)
  })
})

describe('staleDaysOf / precedentJobsSince / parseSinceArg — welche Tage der Lauf leert (Entscheidung 12, 14)', () => {
  const U_OK = [unit(0, 'Mit Marker', ['x'])]
  function job(id: string, created_at: string, generated_post_id: string | null): PrecedentJob {
    return { id, created_at, generated_post_id, selected_items: [{ id: 'x' }] }
  }

  it('Tage nur mit no_post-, not_published- oder no_units-Jobs werden geleert, gewählte Tage nicht (auch mit übersprungenen Jobs)', () => {
    // WARUM: das ist die Löschmenge des [FREIGABE]-Laufs auf Prod.
    const jobs = [
      job('ok', '2026-10-03T06:00:00Z', 'p-ok'),
      job('ok-alt', '2026-10-03T05:00:00Z', 'p-ok2'),   // superseded, gleicher Tag
      job('ok-ohne', '2026-10-03T07:00:00Z', null),     // no_post, gleicher Tag
      job('ohne', '2026-10-01T06:00:00Z', null),
      job('entwurf', '2026-10-02T06:00:00Z', 'p-draft'),
      job('leer', '2026-10-04T06:00:00Z', 'p-leer'),
    ]
    const pick = pickPrecedentJobs(
      jobs,
      new Map([['p-ok', 'published'], ['p-ok2', 'published'], ['p-draft', 'draft'], ['p-leer', 'published']]),
      new Map([['p-ok', U_OK], ['p-ok2', U_OK]]),
    )
    expect([...pick.byDay.keys()]).toEqual(['2026-10-03'])
    expect(staleDaysOf(jobs, pick)).toEqual(['2026-10-01', '2026-10-02', '2026-10-04'])
  })

  it('--since-Grenze: der Tag vor since bleibt unberührt, 22:30Z im Sommer zählt schon zum since-Tag', () => {
    const jobs = [
      job('vorher', '2026-09-04T21:59:00Z', null),   // Berlin 04.09. 23:59
      job('grenze', '2026-09-04T22:30:00Z', null),   // Berlin 05.09. 00:30
      job('ok', '2026-09-06T06:00:00Z', 'p1'),
    ]
    const inRange = precedentJobsSince(jobs, '2026-09-05')
    expect(inRange.map((j) => j.id)).toEqual(['grenze', 'ok'])
    const pick = pickPrecedentJobs(inRange, new Map([['p1', 'published']]), new Map([['p1', U_OK]]))
    expect(staleDaysOf(inRange, pick)).toEqual(['2026-09-05'])
  })

  it('precedentJobsSince im Winter: 22:30Z ist noch der Vortag (den der +02:00-Vorfilter durchlässt); ohne since alle', () => {
    const jobs = [job('vortag', '2026-12-04T22:30:00Z', null), job('tag', '2026-12-04T23:30:00Z', null)]
    expect(precedentJobsSince(jobs, '2026-12-05').map((j) => j.id)).toEqual(['tag'])
    expect(precedentJobsSince(jobs, undefined)).toBe(jobs)
  })

  it('parseSinceArg: beide Schreibweisen; fehlend → undefined; ungültig oder ohne Wert → null', () => {
    expect(parseSinceArg(['--dry-run'])).toBeUndefined()
    expect(parseSinceArg(['--since=2026-09-05'])).toBe('2026-09-05')
    expect(parseSinceArg(['--dry-run', '--since', '2026-08-25'])).toBe('2026-08-25')
    expect(parseSinceArg(['--since', '05.09.2026'])).toBeNull()
    expect(parseSinceArg(['--since'])).toBeNull()
    expect(parseSinceArg(['--since='])).toBeNull()
    expect(parseSinceArg(['--since', '--dry-run'])).toBeNull()
  })
})

describe('replacePrecedentDay — der Lauf ersetzt je Tag (Entscheidung 12)', () => {
  function row(item_id: string, job_id = JOB): PrecedentRow {
    return {
      day: DAY, item_id, story_key: null, stage: 'pending_never_selected',
      bundle_type_selected: null, bundle_type_published: null,
      job_id, post_id: POST, matched_heading: null, similarity: null,
    }
  }

  it('löscht zuerst den ganzen Tag, schreibt dann per Upsert in Batches à 200', async () => {
    // WARUM: ein reiner Upsert ließe Zeilen eines früheren Jobs desselben
    // Tages stehen (Pool-Items aus [J1 − 48 h, J2 − 48 h) mit job_id J1).
    const rows = Array.from({ length: 250 }, (_, i) => row(`i-${i}`, 'job-2'))
    const written = await replacePrecedentDay(client, DAY, rows)
    expect(written).toBe(250)
    expect(client.from.mock.calls.map((c: unknown[]) => c[0])).toEqual(['curation_precedents', 'curation_precedents', 'curation_precedents'])
    const [del, up1, up2] = state.chains.curation_precedents
    expect(del.delete).toHaveBeenCalledTimes(1)
    expect(del.eq).toHaveBeenCalledWith('day', DAY)
    expect(del.upsert).not.toHaveBeenCalled()
    expect(up1.upsert).toHaveBeenCalledWith(rows.slice(0, 200), { onConflict: 'day,item_id' })
    expect(up2.upsert).toHaveBeenCalledWith(rows.slice(200), { onConflict: 'day,item_id' })
    expect(up1.delete).not.toHaveBeenCalled()
  })

  it('leere Zeilenliste leert nur den Tag (veralteter Tag, stale_days)', async () => {
    const written = await replacePrecedentDay(client, DAY, [])
    expect(written).toBe(0)
    expect(state.chains.curation_precedents).toHaveLength(1)
    expect(state.chains.curation_precedents[0].delete).toHaveBeenCalledTimes(1)
  })

  it('Delete-Fehler wirft mit Tag im Text, ohne Upsert', async () => {
    state.queues.curation_precedents = [{ data: null, error: { message: 'boom' } }]
    await expect(replacePrecedentDay(client, DAY, [row('a')])).rejects.toThrow('curation_precedents delete (2026-10-05): boom')
    expect(state.chains.curation_precedents).toHaveLength(1)
  })

  it('Upsert-Fehler wirft mit Tag im Text', async () => {
    state.queues.curation_precedents = [{ data: null, error: null }, { data: null, error: { message: 'kaputt' } }]
    await expect(replacePrecedentDay(client, DAY, [row('a')])).rejects.toThrow('curation_precedents upsert (2026-10-05): kaputt')
  })
})

describe('isoDayShift — Berlin-unabhängige Tagesverschiebung (Controller-Ruling K4)', () => {
  // Rumpf wie Task 15 Step 4: Datum als UTC-Mitternacht parsen, deltaDays*86400000
  // addieren, toISOString().slice(0,10). Task 12 und Task 15 importieren diesen
  // Helfer von hier statt eigene Kopien zu bauen.
  it('+1 Tag', () => {
    expect(isoDayShift('2026-10-05', 1)).toBe('2026-10-06')
  })

  it('-1 Tag', () => {
    expect(isoDayShift('2026-10-05', -1)).toBe('2026-10-04')
  })

  it('Monatsgrenze', () => {
    expect(isoDayShift('2026-10-31', 1)).toBe('2026-11-01')
    expect(isoDayShift('2026-11-01', -1)).toBe('2026-10-31')
  })

  it('Schaltjahr 2028: 2028-02-28 + 1 Tag ist der 29. Februar', () => {
    expect(isoDayShift('2028-02-28', 1)).toBe('2028-02-29')
  })
})
