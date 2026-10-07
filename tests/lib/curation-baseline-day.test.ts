/**
 * Tagesdaten, Helfer und Messlogik der Baseline-Messung (Phase 0, Vertrag 2.10).
 *
 * Testmuster wie tests/lib/glossary-jobs-service.test.ts: pro Tabelle eine
 * FIFO-Queue, jede Filtermethode bleibt ein vi.fn(), damit das Pool-Fenster
 * (queued_at in [asOf − 48 h, asOf)), die Seiten à 1000, das Job→Post-Mapping,
 * die Payload-Scheiben à 10, das Chunking der .in()-Listen und der
 * Hand-Begriff (isHandItem über queue_item_events, wie
 * build-curation-precedents) prüfbar sind. Client als Parameter, kein vi.mock.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mulberry32 } from '@/lib/curation/baseline-metrics'
import {
  berlinDay, berlinHHMM, berlinMinutesOfDay, poolWindow, seededShuffle,
  loadDayInputs, loadRepoEmbeddings, loadJobPayloads, loadPrecedentJobId, loadPickInputs, llmRowOf,
  selectedIdsOf, writeUnitsOf, minutesBetween, parseArgs, rangeStartOf, rangeFromIso, inBerlinRange,
  daySeed, dailyAnalysisMinuteOf,
  mean, meanFinite, sampleSd, utcMinutesOfDay, hhmm, isoDayShift, clusterRuns,
  groupJobsByDay, neutralizeHandLabels, totalScoreCandidates, totalScoreListsByK, unitCappedMetricsOf, coverageOf,
  wantedIdsOf, repoIdsOf, itemEmbeddingsOf, publishedContentLengthsOf,
  rankedMetricsOf, handMetricsOf, aggregateRanked, aggregateHandExtras, pairedDiffs, precedentAgreementOf,
  techmemeAdoption, draftCostOf, draftCostsOf, analysisEndByDay, throughputOf, newsletterArrivalOf, techmemeByUtcDay,
  POOL_LIMIT, POOL_PAGE, JOB_PAYLOAD_CHUNK,
  type BaselineJobMeta, type BaselineJobRow, type BaselineUnit, type HandMetrics,
  type ItemRow, type PoolItem, type RankedMetrics,
} from '@/lib/curation/baseline-day'

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

beforeEach(() => {
  state.queues = {}
  state.chains = {}
  state.fallback = { data: null, error: null }
  client.from.mockClear()
})

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const U3 = '33333333-3333-4333-8333-333333333333'
const HAND_OLD = '44444444-4444-4444-8444-444444444444'
const NIGHT = '66666666-6666-4666-8666-666666666666'
const TM = '77777777-7777-4777-8777-777777777777'
const TM_LABELED = '88888888-8888-4888-8888-888888888888'

const JOB: BaselineJobRow = {
  id: 'job-1', source: 'manual', status: 'done',
  created_at: '2026-09-10T04:30:00.000Z', started_at: '2026-09-10T04:31:00.000Z', completed_at: '2026-09-10T05:00:00.000Z',
  generated_post_id: 'post-1',
  selected_items: [{ id: U1, bundle_type: 'topic' }, { id: HAND_OLD }, { id: U1 }],
  written_sections: ['a', 'b'],
}

const poolRow = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: 'Eine brauchbare Meldung mit Titel', source_identifier: 'src-a', total_score: '12.5',
  bundle_type: null, metadata: {}, content_length: 1200, daily_repo_id: `repo-${id.slice(0, 8)}`,
  queued_at: '2026-09-09T20:00:00.000Z', ...over,
})

const PUBLISHED = { data: { id: 'post-1', status: 'published' }, error: null }

describe('berlinDay / berlinHHMM / poolWindow / seededShuffle', () => {
  it('berlinDay nimmt das Berlin-Datum (Sommer +2 h, Winter +1 h), berlinHHMM die Berlin-Uhrzeit — Mitternacht als 00:00', () => {
    expect(berlinDay('2026-09-10T23:30:00.000Z')).toBe('2026-09-11')
    expect(berlinDay('2026-12-01T23:30:00.000Z')).toBe('2026-12-02')
    expect(berlinDay('2026-12-01T22:30:00.000Z')).toBe('2026-12-01')
    expect(berlinHHMM('2026-09-21T03:12:40.000Z')).toBe('05:12')
    expect(berlinHHMM('2026-12-01T03:12:40.000Z')).toBe('04:12')
    expect(berlinHHMM('2026-09-20T22:00:00.000Z')).toBe('00:00')   // Entscheidung 17: nie '24:00'
    expect(berlinHHMM('2026-12-01T23:00:00.000Z')).toBe('00:00')
  })

  it('poolWindow ist [asOf − 48 h, asOf)', () => {
    expect(poolWindow('2026-09-10T04:30:00.000Z')).toEqual({ from: '2026-09-08T04:30:00.000Z', to: '2026-09-10T04:30:00.000Z' })
  })

  it('seededShuffle ist eine Permutation und mit gleichem PRNG reproduzierbar', () => {
    const seq = [0.9, 0.1, 0.5, 0.3, 0.7]
    const rand = () => { const v = seq.shift() ?? 0.5; seq.push(v); return v }
    const a = seededShuffle(['a', 'b', 'c', 'd', 'e'], rand)
    const seq2 = [0.9, 0.1, 0.5, 0.3, 0.7]
    const rand2 = () => { const v = seq2.shift() ?? 0.5; seq2.push(v); return v }
    const b = seededShuffle(['a', 'b', 'c', 'd', 'e'], rand2)
    expect([...a].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(a).toEqual(b)
    expect(a).not.toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('seededShuffle mit mulberry32 aus Task 14: gleicher Seed → gleiche Permutation, anderer Seed → andere; [] → []', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `id-${i}`)
    const a = seededShuffle(ids, mulberry32(42 + 20717))
    expect(seededShuffle(ids, mulberry32(42 + 20717))).toEqual(a)
    expect(seededShuffle(ids, mulberry32(42 + 20718))).not.toEqual(a)
    expect([...a].sort()).toEqual([...ids].sort())
    expect(seededShuffle([], mulberry32(1))).toEqual([])
  })
})

describe('reine Helfer des Scripts', () => {
  it('parseArgs: --since in beiden Schreibweisen; ungültig, ohne Wert oder --since= → null', () => {
    expect(parseArgs([])).toEqual({ dryRun: false, since: undefined })
    expect(parseArgs(['--dry-run', '--since', '2026-09-01'])).toEqual({ dryRun: true, since: '2026-09-01' })
    expect(parseArgs(['--since=2026-09-01'])).toEqual({ dryRun: false, since: '2026-09-01' })
    expect(parseArgs(['--since', '28.09.'])).toBeNull()
    expect(parseArgs(['--since'])).toBeNull()
    expect(parseArgs(['--since='])).toBeNull()
  })

  it('clusterRuns: Lücke > gap eröffnet einen neuen Lauf, Lücke = gap nicht; leer → leer', () => {
    const gap = 10 * 60 * 1000
    const runs = clusterRuns(['2026-09-21T00:10:00.000Z', '2026-09-21T00:12:00.000Z', '2026-09-21T00:30:00.000Z'], gap)
    expect(runs).toEqual([
      { start: '2026-09-21T00:10:00.000Z', end: '2026-09-21T00:12:00.000Z', calls: 2 },
      { start: '2026-09-21T00:30:00.000Z', end: '2026-09-21T00:30:00.000Z', calls: 1 },
    ])
    expect(clusterRuns(['2026-09-21T00:10:00.000Z', '2026-09-21T00:20:00.000Z'], gap)).toEqual([
      { start: '2026-09-21T00:10:00.000Z', end: '2026-09-21T00:20:00.000Z', calls: 2 },
    ])
    expect(clusterRuns([], 1000)).toEqual([])
  })

  it('utcMinutesOfDay / hhmm: Minute des UTC-Tages und zurück; NaN oder negativ → null', () => {
    expect(utcMinutesOfDay('2026-09-21T03:12:40.000Z')).toBe(192)
    expect(hhmm(192)).toBe('03:12')
    expect(hhmm(192.6)).toBe('03:13')
    expect(hhmm(1439.6)).toBe('00:00')
    expect(hhmm(NaN)).toBeNull()
    expect(hhmm(-1)).toBeNull()
  })

  it('mean / sampleSd: leer bzw. unter zwei Werten NaN, sonst Stichproben-Standardabweichung (n − 1)', () => {
    expect(mean([])).toBeNaN()
    expect(mean([1, 2, 3])).toBe(2)
    expect(sampleSd([1])).toBeNaN()
    expect(sampleSd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3)
  })

  it('meanFinite: null/NaN zählen nicht; nichts Endliches → NaN', () => {
    expect(meanFinite([1, null, 3, NaN])).toBe(2)
    expect(meanFinite([null, NaN])).toBeNaN()
    expect(meanFinite([])).toBeNaN()
  })

  it('berlinMinutesOfDay: Minute des Berlin-Tages (Sommer +2 h, Winter +1 h, Mitternacht 0)', () => {
    expect(berlinMinutesOfDay('2026-09-21T03:12:40.000Z')).toBe(5 * 60 + 12)
    expect(berlinMinutesOfDay('2026-12-01T03:12:40.000Z')).toBe(4 * 60 + 12)
    expect(berlinMinutesOfDay('2026-09-20T22:00:00.000Z')).toBe(0)
  })

  it('rangeStartOf: --since gewinnt, sonst der frühere von Gate-Start und heute − 30 Tage (Entscheidung 1)', () => {
    expect(rangeStartOf('2026-10-06', undefined, '2026-08-25', 30)).toBe('2026-08-25')
    expect(rangeStartOf('2026-09-20', undefined, '2026-08-25', 30)).toBe('2026-08-21')
    expect(rangeStartOf('2026-10-06', '2026-09-28', '2026-08-25', 30)).toBe('2026-09-28')
  })

  it('rangeFromIso / inBerlinRange: UTC-Vorfilter 3 h vor rangeStart 00:00Z, exakter Schnitt am Berlin-Tag (Sommer und Winter)', () => {
    expect(rangeFromIso('2026-08-25')).toBe('2026-08-24T21:00:00.000Z')
    expect(inBerlinRange('2026-08-24T22:30:00.000Z', '2026-08-25')).toBe(true)    // Berlin 00:30 am 25.
    expect(inBerlinRange('2026-08-24T21:59:00.000Z', '2026-08-25')).toBe(false)   // Berlin 23:59 am 24.
    expect(inBerlinRange('2026-12-01T23:00:00.000Z', '2026-12-02')).toBe(true)    // Winter: Berlin 00:00 am 02.12.
    expect(inBerlinRange('2026-12-01T22:59:00.000Z', '2026-12-02')).toBe(false)
    // jeder Berlin-Tag ≥ rangeStart liegt nach dem Vorfilter
    expect('2026-08-24T22:00:00.000Z' >= rangeFromIso('2026-08-25')).toBe(true)
  })

  it('daySeed: Seed je Kalendertag, unabhängig vom Bereichsanfang (Entscheidung 5)', () => {
    expect(daySeed('1970-01-01', 42)).toBe(42)
    expect(daySeed('2026-09-21', 42)).toBe(42 + 20717)
    expect(daySeed('2026-09-22', 42) - daySeed('2026-09-21', 42)).toBe(1)
    expect(daySeed('2026-03-30', 42) - daySeed('2026-03-29', 42)).toBe(1)   // Sommerzeit-Umstellung ändert nichts
  })

  it('dailyAnalysisMinuteOf: Berlin-Minute aus schedule_config, sonst Default 05:00', () => {
    expect(dailyAnalysisMinuteOf({ dailyAnalysis: { enabled: true, hour: 4, minute: 30 } })).toBe(270)
    expect(dailyAnalysisMinuteOf({ dailyAnalysis: { enabled: true, hour: 3 } })).toBe(180)
    expect(dailyAnalysisMinuteOf({ newsletterFetch: { hour: 4 } })).toBe(300)
    expect(dailyAnalysisMinuteOf({ dailyAnalysis: { hour: '5' } })).toBe(300)
    expect(dailyAnalysisMinuteOf(null)).toBe(300)
  })

  it('isoDayShift / minutesBetween', () => {
    expect(isoDayShift('2026-10-06', -30)).toBe('2026-09-06')
    expect(isoDayShift('2026-03-01', -1)).toBe('2026-02-28')
    expect(minutesBetween('2026-09-10T04:31:00.000Z', '2026-09-10T05:00:00.000Z')).toBe(29)
    expect(minutesBetween('2026-09-10T05:00:00.000Z', '2026-09-10T04:31:00.000Z')).toBeNull()
    expect(minutesBetween(null, '2026-09-10T05:00:00.000Z')).toBeNull()
  })

  it('selectedIdsOf / writeUnitsOf: null-jsonb → leer bzw. 0; Hand-IDs dedupliziert in Reihenfolge', () => {
    expect(selectedIdsOf(JOB)).toEqual([U1, HAND_OLD])
    expect(selectedIdsOf({ ...JOB, selected_items: null })).toEqual([])
    expect(writeUnitsOf(JOB)).toBe(2)
    expect(writeUnitsOf({ ...JOB, written_sections: null })).toBe(0)
  })

  it('llmRowOf: cost_usd gewinnt; NULL → computeCostUsd aus den Token-Spalten (repriced); Modell ohne Preis → null (Entscheidung 10)', () => {
    const base = { created_at: '2026-09-28T04:40:00+00:00', use_case: 'ghostwriter', input_tokens: 1_000_000, output_tokens: 1_000_000, cache_write_tokens: 0, cache_read_tokens: 0 }
    // NUMERIC kommt als String
    expect(llmRowOf({ ...base, model: 'claude-opus-4-6', cost_usd: '0.5' })).toEqual({
      at: Date.parse('2026-09-28T04:40:00.000Z'), iso: '2026-09-28T04:40:00+00:00', use_case: 'ghostwriter', cost: 0.5, repriced: false,
    })
    // claude-opus-4-6: 5 $ Input + 25 $ Output je 1M Token (lib/ai/model-pricing.ts)
    const repriced = llmRowOf({ ...base, model: 'claude-opus-4-6', cost_usd: null })
    expect(repriced.repriced).toBe(true)
    expect(repriced.cost).toBeCloseTo(30)
    // Cache-Posten: Schreiben 1,25×, Lesen 0,1× Input (lib/ai/usage-cost.ts)
    expect(llmRowOf({ ...base, model: 'claude-opus-4-6', cost_usd: null, input_tokens: 0, output_tokens: 0, cache_write_tokens: 1_000_000, cache_read_tokens: 1_000_000 }).cost).toBeCloseTo(6.75)
    expect(llmRowOf({ ...base, model: 'claude-unbekannt-9', cost_usd: null })).toMatchObject({ cost: null, repriced: false })
    expect(llmRowOf({ ...base, model: null, cost_usd: undefined })).toMatchObject({ cost: null, repriced: false })
  })
})

describe('loadDayInputs — Pool-Fenster, Seiten und Nachladen', () => {
  it('lädt den Pool strikt in [asOf − 48 h, asOf) per range(0, 999), filtert Junk und kurze Items, mappt Einheiten und Handauswahl', async () => {
    state.queues.generated_posts = [PUBLISHED]
    state.queues.published_units = [{ data: [
      { id: 'unit-b', position: 1, heading: 'Zweite', bundle_type: null, member_ids: [U3] },
      { id: 'unit-a', position: 0, heading: 'Erste', bundle_type: 'topic', member_ids: [U1, U2] },
    ], error: null }]
    state.queues.news_queue = [
      { data: [
        poolRow(U1),
        poolRow(U2, { title: 'https://nur-eine-url.example', total_score: 9 }),   // Junk-Titel → raus
        poolRow(U3, { content_length: 120 }),                                    // zu kurz → raus
        poolRow('55555555-5555-4555-8555-555555555555', { total_score: null, daily_repo_id: null, metadata: null }),
      ], error: null },
      // Member-/Hand-Zeilen außerhalb des Pools (U2, U3 flogen aus dem Pool; HAND_OLD war nie drin)
      { data: [
        { id: U2, content_length: 900, daily_repo_id: 'repo-u2', source_identifier: 'src-a' },
        { id: U3, content_length: 120, daily_repo_id: null, source_identifier: 'src-b' },
        { id: HAND_OLD, content_length: 3000, daily_repo_id: 'repo-old', source_identifier: 'src-c' },
      ], error: null },
    ]

    const res = await loadDayInputs(client, JOB)
    expect(res.reason).toBeNull()
    const inputs = res.inputs!

    // Fenster: gte(asOf − 48 h), lt(asOf), erste Seite range(0, 999) — aus der Pool-Chain (erste news_queue-Chain);
    // 4 Zeilen < POOL_PAGE → keine zweite Seite
    const poolChain = state.chains.news_queue[0]
    expect(poolChain.gte).toHaveBeenCalledWith('queued_at', '2026-09-08T04:30:00.000Z')
    expect(poolChain.lt).toHaveBeenCalledWith('queued_at', '2026-09-10T04:30:00.000Z')
    expect(poolChain.range).toHaveBeenCalledWith(0, POOL_PAGE - 1)
    expect(poolChain.limit).not.toHaveBeenCalled()
    expect(poolChain.order).toHaveBeenCalledWith('id', { ascending: true })
    expect(state.chains.news_queue).toHaveLength(2)

    expect(inputs.day).toBe('2026-09-10')
    expect(inputs.asOf).toBe('2026-09-10T04:30:00.000Z')
    expect(inputs.poolFrom).toBe('2026-09-08T04:30:00.000Z')
    expect(inputs.poolTruncated).toBe(false)
    expect(inputs.pool.map((p) => p.id)).toEqual([U1, '55555555-5555-4555-8555-555555555555'])
    expect(inputs.pool[0].total_score).toBe(12.5)          // NUMERIC kommt als String → Number
    expect(inputs.pool[1].total_score).toBe(0)             // null → 0
    expect(inputs.pool[1].metadata).toBeNull()
    expect(inputs.techmemeItems).toEqual([])

    // Einheiten nach position sortiert (DB-Order), memberIds durchgereicht
    expect(inputs.units.map((u) => u.position)).toEqual([1, 0])
    expect(inputs.units[1]).toEqual({ id: 'unit-a', position: 0, heading: 'Erste', bundleType: 'topic', memberIds: [U1, U2] })

    // Handauswahl: Reihenfolge aus selected_items, dedupliziert; ohne Events
    // greift der Metadaten-Fallback → beide sind Hand-Items (operator)
    expect(inputs.selectedIds).toEqual([U1, HAND_OLD])
    expect(inputs.handIds).toEqual([U1, HAND_OLD])
    expect(state.chains.queue_item_events).toHaveLength(1)
    expect(state.chains.queue_item_events[0].in).toHaveBeenCalledWith('queue_item_id', [U1, HAND_OLD])

    // Nachgeladen wurden genau die IDs außerhalb des Pools, in Reihenfolge
    // Einheiten (unit-b: U3, unit-a: U1 im Pool, U2) dann Hand (U1 im Pool, HAND_OLD)
    const memberChain = state.chains.news_queue[1]
    expect(memberChain.select).toHaveBeenCalledWith('id, content_length, daily_repo_id, source_identifier, metadata')
    expect(memberChain.in).toHaveBeenCalledWith('id', [U3, U2, HAND_OLD])
    expect(inputs.itemRows.get(U1)).toEqual({ content_length: 1200, daily_repo_id: `repo-${U1.slice(0, 8)}`, source_identifier: 'src-a', metadata: {} })
    expect(inputs.itemRows.get(U3)).toEqual({ content_length: 120, daily_repo_id: null, source_identifier: 'src-b', metadata: null })
    expect(inputs.itemRows.get(HAND_OLD)?.daily_repo_id).toBe('repo-old')
  })

  it('extraIds (Nachtlauf) außerhalb des Pools werden nachgeladen — Entscheidung 6', async () => {
    state.queues.generated_posts = [PUBLISHED]
    state.queues.published_units = [{ data: [{ id: 'u', position: 0, heading: 'H', bundle_type: null, member_ids: [U1] }], error: null }]
    state.queues.news_queue = [
      { data: [poolRow(U1)], error: null },
      { data: [{ id: NIGHT, content_length: 700, daily_repo_id: 'repo-night', source_identifier: 'src-n' }], error: null },
    ]
    const res = await loadDayInputs(client, { ...JOB, selected_items: [{ id: U1 }] }, [NIGHT, U1])
    expect(res.reason).toBeNull()
    // Member U1 und Hand U1 liegen im Pool; nur NIGHT fehlt — genau eine Member-Chain mit [NIGHT]
    expect(state.chains.news_queue).toHaveLength(2)
    expect(state.chains.news_queue[1].in).toHaveBeenCalledWith('id', [NIGHT])
    expect(res.inputs?.itemRows.get(NIGHT)).toEqual({ content_length: 700, daily_repo_id: 'repo-night', source_identifier: 'src-n', metadata: null })
    // Events nur für die selected_items, nicht für Nachtlauf-IDs
    expect(state.chains.queue_item_events[0].in).toHaveBeenCalledWith('queue_item_id', [U1])
  })

  it('Hand = isHandItem as-of asOf wie build-curation-precedents: unberührtes Techmeme-Thema raus, Techmeme mit Betreiber-Label vor dem Job rein (Entscheidung 24)', async () => {
    state.queues.generated_posts = [PUBLISHED]
    state.queues.published_units = [{ data: [{ id: 'u', position: 0, heading: 'H', bundle_type: 'topic', member_ids: [U1, TM] }], error: null }]
    state.queues.news_queue = [
      { data: [poolRow(U1)], error: null },
      // Techmeme-Themen sind oft < 500 Zeichen → nicht im Pool, aber nachgeladen MIT metadata
      { data: [
        { id: TM, content_length: 300, daily_repo_id: null, source_identifier: 'techmeme', metadata: { techmeme: true, techmeme_story: 's' } },
        { id: TM_LABELED, content_length: 300, daily_repo_id: null, source_identifier: 'techmeme', metadata: { techmeme: true, techmeme_story: 't' } },
      ], error: null },
    ]
    state.queues.queue_item_events = [{ data: [
      { id: 7, queue_item_id: TM_LABELED, event: 'relabel', actor: 'operator', from_status: null, to_status: null, from_role: 'topic', to_role: 'deep_dive', reason: null, run_id: null, at: '2026-09-10T04:00:00.000Z' },
      // NACH asOf (04:30): darf TM rückwirkend nicht zum Hand-Item machen (eventsAsOf, Task 11 Entscheidung 8)
      { id: 9, queue_item_id: TM, event: 'relabel', actor: 'operator', from_status: null, to_status: null, from_role: 'topic', to_role: 'recap', reason: null, run_id: null, at: '2026-09-11T08:00:00.000Z' },
    ], error: null }]
    const res = await loadDayInputs(client, { ...JOB, selected_items: [{ id: U1 }, { id: TM, bundle_type: 'topic' }, { id: TM_LABELED, bundle_type: 'topic' }] })
    expect(res.inputs?.selectedIds).toEqual([U1, TM, TM_LABELED])
    expect(res.inputs?.handIds).toEqual([U1, TM_LABELED])
    expect(state.chains.queue_item_events[0].in).toHaveBeenCalledWith('queue_item_id', [U1, TM, TM_LABELED])
  })

  it('selected_items/written_sections/member_ids null → leere Listen; techmemeItems aus den UNGEFILTERTEN Zeilen', async () => {
    state.queues.generated_posts = [PUBLISHED]
    state.queues.published_units = [{ data: [{ id: 'u', position: 0, heading: 'H', bundle_type: 'topic', member_ids: null }], error: null }]
    state.queues.news_queue = [{ data: [
      // zu kurz → nicht im Pool, aber Techmeme-Story (Entscheidung 13)
      poolRow(U1, { content_length: 120, daily_repo_id: null, metadata: { techmeme: true, techmeme_story: 'story-a', techmeme_story_index: 0 } }),
      poolRow(U2, { daily_repo_id: null, metadata: { techmeme: true, techmeme_story: 'story-a', techmeme_story_index: 0 } }),
      poolRow(U3, { daily_repo_id: null, metadata: { techmeme: true, techmeme_story: 'story-b' } }),   // ohne Index → ignoriert
    ], error: null }]
    const res = await loadDayInputs(client, { ...JOB, selected_items: null, written_sections: null })
    expect(res.reason).toBeNull()
    const inputs = res.inputs!
    expect(inputs.handIds).toEqual([])
    expect(inputs.selectedIds).toEqual([])
    expect(state.chains.queue_item_events).toBeUndefined()   // keine selected_items → keine Event-Query
    expect(inputs.units[0].memberIds).toEqual([])
    expect(inputs.pool.map((p) => p.id)).toEqual([U2, U3])
    expect(inputs.techmemeItems).toEqual([
      { id: U1, story: 'story-a', storyIndex: 0 },
      { id: U2, story: 'story-a', storyIndex: 0 },
    ])
    expect(state.chains.news_queue).toHaveLength(1)   // nichts nachzuladen
  })

  it('Pool-Seiten à POOL_PAGE: zwei volle Seiten → poolTruncated = true, keine dritte Seite (Entscheidung 2)', async () => {
    state.queues.generated_posts = [PUBLISHED]
    state.queues.published_units = [{ data: [{ id: 'u', position: 0, heading: 'H', bundle_type: null, member_ids: [] }], error: null }]
    const page = (start: number) => Array.from({ length: POOL_PAGE }, (_, i) => poolRow(`00000000-0000-4000-8000-${String(start + i).padStart(12, '0')}`))
    state.queues.news_queue = [{ data: page(0), error: null }, { data: page(POOL_PAGE), error: null }]
    const res = await loadDayInputs(client, JOB)
    expect(res.inputs?.poolTruncated).toBe(true)
    expect(res.inputs?.pool).toHaveLength(POOL_LIMIT)
    // Seite 0, Seite 1, dann genau eine Member-Chain (U1 und HAND_OLD aus
    // selected_items liegen nicht im Pool; die Chain bekommt den Fallback { data: null })
    expect(state.chains.news_queue).toHaveLength(3)
    expect(state.chains.news_queue[0].range).toHaveBeenCalledWith(0, POOL_PAGE - 1)
    expect(state.chains.news_queue[1].range).toHaveBeenCalledWith(POOL_PAGE, 2 * POOL_PAGE - 1)
    expect(state.chains.news_queue[2].in).toHaveBeenCalledWith('id', [U1, HAND_OLD])
  })

  it('Member-Nachladen läuft in Scheiben à 200', async () => {
    state.queues.generated_posts = [PUBLISHED]
    const memberIds = Array.from({ length: 201 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`)
    state.queues.published_units = [{ data: [{ id: 'u', position: 0, heading: 'H', bundle_type: null, member_ids: memberIds }], error: null }]
    state.queues.news_queue = [
      { data: [], error: null },                       // leerer Pool (eine Seite, 0 Zeilen)
      { data: memberIds.slice(0, 200).map((id) => ({ id, content_length: 1000, daily_repo_id: null, source_identifier: 's' })), error: null },
      { data: memberIds.slice(200).map((id) => ({ id, content_length: 1000, daily_repo_id: null, source_identifier: 's' })), error: null },
    ]
    const job: BaselineJobRow = { ...JOB, selected_items: [] }
    const res = await loadDayInputs(client, job)
    expect(res.inputs?.itemRows.size).toBe(201)
    expect(state.chains.news_queue[1].in.mock.calls[0][1]).toHaveLength(200)
    expect(state.chains.news_queue[2].in.mock.calls[0][1]).toHaveLength(1)
  })
})

describe('loadDayInputs — Mapping Job → Post (Review-Fokus 2) und DB-Fehler', () => {
  it('generated_post_id null → no_post ohne DB-Zugriff', async () => {
    const res = await loadDayInputs(client, { ...JOB, generated_post_id: null })
    expect(res).toEqual({ inputs: null, reason: 'no_post' })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('Post gelöscht → no_post', async () => {
    state.queues.generated_posts = [{ data: null, error: null }]
    const res = await loadDayInputs(client, JOB)
    expect(res).toEqual({ inputs: null, reason: 'no_post' })
    expect(state.chains.generated_posts[0].eq).toHaveBeenCalledWith('id', 'post-1')
    expect(state.chains.published_units).toBeUndefined()
  })

  it('Post noch draft/archiviert → post_not_published', async () => {
    state.queues.generated_posts = [{ data: { id: 'post-1', status: 'archived' }, error: null }]
    const res = await loadDayInputs(client, JOB)
    expect(res).toEqual({ inputs: null, reason: 'post_not_published' })
  })

  it('Post ohne published_units → no_units (Backfill fehlt oder keine H2)', async () => {
    state.queues.generated_posts = [PUBLISHED]
    state.queues.published_units = [{ data: [], error: null }]
    const res = await loadDayInputs(client, JOB)
    expect(res).toEqual({ inputs: null, reason: 'no_units' })
    expect(state.chains.news_queue).toBeUndefined()
  })

  it('generated_posts-Fehler wirft mit Tabellenname', async () => {
    state.queues.generated_posts = [{ data: null, error: { message: 'kaputt' } }]
    await expect(loadDayInputs(client, JOB)).rejects.toThrow('generated_posts: kaputt')
  })

  it('published_units-Fehler wirft mit Tabellenname', async () => {
    state.queues.generated_posts = [PUBLISHED]
    state.queues.published_units = [{ data: null, error: { message: 'weg' } }]
    await expect(loadDayInputs(client, JOB)).rejects.toThrow('published_units: weg')
  })

  it('Pool-Fehler wirft mit „news_queue (pool)"', async () => {
    state.queues.generated_posts = [PUBLISHED]
    state.queues.published_units = [{ data: [{ id: 'u', position: 0, heading: 'H', bundle_type: null, member_ids: [U1] }], error: null }]
    state.queues.news_queue = [{ data: null, error: { message: 'timeout' } }]
    await expect(loadDayInputs(client, JOB)).rejects.toThrow('news_queue (pool): timeout')
  })

  it('Nachlade-Fehler wirft mit „news_queue (members)"', async () => {
    state.queues.generated_posts = [PUBLISHED]
    state.queues.published_units = [{ data: [{ id: 'u', position: 0, heading: 'H', bundle_type: null, member_ids: [U1] }], error: null }]
    state.queues.news_queue = [
      { data: [poolRow(U1)], error: null },
      { data: null, error: { message: 'zu lang' } },   // HAND_OLD fehlt im Pool → Nachladen
    ]
    await expect(loadDayInputs(client, JOB)).rejects.toThrow('news_queue (members): zu lang')
  })

  it('Event-Fehler wirft mit „queue_item_events" (Fehlertext aus loadEventsForItems, Task 3)', async () => {
    state.queues.generated_posts = [PUBLISHED]
    state.queues.published_units = [{ data: [{ id: 'u', position: 0, heading: 'H', bundle_type: null, member_ids: [U1] }], error: null }]
    state.queues.news_queue = [{ data: [poolRow(U1)], error: null }]
    state.queues.queue_item_events = [{ data: null, error: { message: 'rls' } }]
    await expect(loadDayInputs(client, { ...JOB, selected_items: [{ id: U1 }] })).rejects.toThrow('queue_item_events: rls')
  })
})

describe('loadPrecedentJobId — Job der Präzedenzfälle je Tag (Entscheidung 25)', () => {
  it('liest job_id einer Zeile des Tages; ohne Zeile → null', async () => {
    state.queues.curation_precedents = [{ data: [{ job_id: 'job-1' }], error: null }, { data: [], error: null }]
    expect(await loadPrecedentJobId(client, '2026-09-10')).toBe('job-1')
    const chain = state.chains.curation_precedents[0]
    expect(chain.select).toHaveBeenCalledWith('job_id')
    expect(chain.eq).toHaveBeenCalledWith('day', '2026-09-10')
    expect(chain.limit).toHaveBeenCalledWith(1)
    expect(await loadPrecedentJobId(client, '2026-09-11')).toBeNull()
  })

  it('Fehler wirft mit Tabellenname', async () => {
    state.queues.curation_precedents = [{ data: null, error: { message: 'fehlt' } }]
    await expect(loadPrecedentJobId(client, '2026-09-10')).rejects.toThrow('curation_precedents: fehlt')
  })
})

describe('loadPickInputs — Eingaben für pickPrecedentJobs (Entscheidung 1)', () => {
  it('Status je Post und Einheiten je Post (schmal, embedding null), dedupliziert, Scheiben à 200, Einheiten seitenweise', async () => {
    const postIds = Array.from({ length: 201 }, (_, i) => `post-${i}`)
    state.queues.generated_posts = [
      { data: [{ id: 'post-0', status: 'published' }, { id: 'post-1', status: 'draft' }], error: null },
      { data: [{ id: 'post-200', status: 'published' }], error: null },
    ]
    state.queues.published_units = [
      { data: [
        { post_id: 'post-0', position: 0, heading: 'Erste', bundle_type: 'topic', member_ids: [U1, U2] },
        { post_id: 'post-0', position: 1, heading: 'Zweite', bundle_type: null, member_ids: null },
      ], error: null },
      { data: [], error: null },
    ]
    const res = await loadPickInputs(client, [...postIds, 'post-0'])
    expect(state.chains.generated_posts).toHaveLength(2)
    expect(state.chains.generated_posts[0].in.mock.calls[0][1]).toHaveLength(200)
    expect(state.chains.generated_posts[1].in).toHaveBeenCalledWith('id', ['post-200'])
    expect(state.chains.published_units[0].select).toHaveBeenCalledWith('post_id, position, heading, bundle_type, member_ids')
    expect(state.chains.published_units[0].range).toHaveBeenCalledWith(0, POOL_PAGE - 1)
    expect([...res.statusById.entries()]).toEqual([['post-0', 'published'], ['post-1', 'draft'], ['post-200', 'published']])
    expect(res.unitsByPost.get('post-0')).toEqual([
      { position: 0, heading: 'Erste', bundleType: 'topic', memberIds: [U1, U2], embedding: null },
      { position: 1, heading: 'Zweite', bundleType: null, memberIds: [], embedding: null },
    ])
    expect(res.unitsByPost.has('post-200')).toBe(false)
  })

  it('published_units über zwei Seiten: volle erste Seite → zweite Seite mit range(POOL_PAGE, 2*POOL_PAGE-1), alle Einheiten beim Post', async () => {
    state.queues.generated_posts = [{ data: [{ id: 'post-0', status: 'published' }], error: null }]
    const unit = (position: number) => ({ post_id: 'post-0', position, heading: `H${position}`, bundle_type: null, member_ids: [U1] })
    state.queues.published_units = [
      { data: Array.from({ length: POOL_PAGE }, (_, i) => unit(i)), error: null },
      { data: [unit(POOL_PAGE)], error: null },
    ]
    const res = await loadPickInputs(client, ['post-0'])
    // zweite Seite < POOL_PAGE → keine dritte Abfrage
    expect(state.chains.published_units).toHaveLength(2)
    expect(state.chains.published_units[0].range).toHaveBeenCalledWith(0, POOL_PAGE - 1)
    expect(state.chains.published_units[1].range).toHaveBeenCalledWith(POOL_PAGE, 2 * POOL_PAGE - 1)
    expect(state.chains.published_units[1].in).toHaveBeenCalledWith('post_id', ['post-0'])
    const units = res.unitsByPost.get('post-0') ?? []
    expect(units).toHaveLength(POOL_PAGE + 1)
    expect(units[0].position).toBe(0)
    expect(units[POOL_PAGE]).toEqual({ position: POOL_PAGE, heading: `H${POOL_PAGE}`, bundleType: null, memberIds: [U1], embedding: null })
  })

  it('leere Liste → keine Query; Fehler werfen mit Tabellenname', async () => {
    const empty = await loadPickInputs(client, [])
    expect(empty.statusById.size).toBe(0)
    expect(client.from).not.toHaveBeenCalled()
    state.queues.generated_posts = [{ data: null, error: { message: 'weg' } }]
    await expect(loadPickInputs(client, ['post-0'])).rejects.toThrow('generated_posts: weg')
    state.queues.generated_posts = [{ data: [], error: null }]
    state.queues.published_units = [{ data: null, error: { message: 'kaputt' } }]
    await expect(loadPickInputs(client, ['post-0'])).rejects.toThrow('published_units: kaputt')
  })
})

describe('loadRepoEmbeddings — fehlende Embeddings', () => {
  it('parst String- und Array-Vektoren, lässt NULL/leer weg, dedupliziert und chunkt à 200', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `repo-${i}`)
    state.queues.daily_repo = [
      { data: [
        { id: 'repo-0', embedding: '[0.1,0.2,0.3]' },
        { id: 'repo-1', embedding: [0.4, 0.5, 0.6] },
        { id: 'repo-2', embedding: null },
        { id: 'repo-3', embedding: '[]' },
        { id: 'repo-4', embedding: 'kein json' },
      ], error: null },
      { data: [{ id: 'repo-200', embedding: '[1,0,0]' }], error: null },
    ]
    const map = await loadRepoEmbeddings(client, [...ids, 'repo-0'])
    expect(map.get('repo-0')).toEqual([0.1, 0.2, 0.3])
    expect(map.get('repo-1')).toEqual([0.4, 0.5, 0.6])
    expect(map.has('repo-2')).toBe(false)
    expect(map.has('repo-3')).toBe(false)
    expect(map.has('repo-4')).toBe(false)
    expect(map.get('repo-200')).toEqual([1, 0, 0])
    expect(state.chains.daily_repo).toHaveLength(2)
    expect(state.chains.daily_repo[0].in.mock.calls[0][1]).toHaveLength(200)
    expect(state.chains.daily_repo[1].in.mock.calls[0][1]).toEqual(['repo-200'])
  })

  it('leere Liste → keine Query, leere Map', async () => {
    const map = await loadRepoEmbeddings(client, [])
    expect(map.size).toBe(0)
    expect(client.from).not.toHaveBeenCalled()
  })

  it('daily_repo-Fehler wirft mit Tabellenname', async () => {
    state.queues.daily_repo = [{ data: null, error: { message: 'egress' } }]
    await expect(loadRepoEmbeddings(client, ['repo-0'])).rejects.toThrow('daily_repo: egress')
  })
})

describe('loadJobPayloads — Payload in Scheiben à 10', () => {
  const meta = (i: number): BaselineJobMeta => ({
    id: `job-${i}`, source: 'manual', status: 'done', created_at: '2026-09-10T04:30:00.000Z',
    started_at: null, completed_at: null, generated_post_id: null,
  })

  it('lädt selected_items/written_sections in Scheiben à JOB_PAYLOAD_CHUNK; fehlende oder nicht-Array-Payloads → null', async () => {
    const metas = Array.from({ length: JOB_PAYLOAD_CHUNK + 1 }, (_, i) => meta(i))
    state.queues.article_jobs = [
      { data: [
        { id: 'job-0', selected_items: [{ id: U1 }], written_sections: ['a', 'b'] },
        { id: 'job-1', selected_items: null, written_sections: 'kaputt' },
      ], error: null },
      { data: [], error: null },
    ]
    const rows = await loadJobPayloads(client, [...metas, meta(0)])
    expect(state.chains.article_jobs).toHaveLength(2)
    expect(state.chains.article_jobs[0].select).toHaveBeenCalledWith('id, selected_items, written_sections')
    expect(state.chains.article_jobs[0].in.mock.calls[0][1]).toHaveLength(JOB_PAYLOAD_CHUNK)
    expect(state.chains.article_jobs[1].in).toHaveBeenCalledWith('id', [`job-${JOB_PAYLOAD_CHUNK}`])
    expect(rows.size).toBe(JOB_PAYLOAD_CHUNK + 1)
    expect(rows.get('job-0')).toEqual({ ...meta(0), selected_items: [{ id: U1 }], written_sections: ['a', 'b'] })
    expect(rows.get('job-1')).toEqual({ ...meta(1), selected_items: null, written_sections: null })
    expect(rows.get(`job-${JOB_PAYLOAD_CHUNK}`)?.selected_items).toBeNull()   // keine Payload-Zeile
  })

  it('leere Liste → keine Query; Fehler wirft mit „article_jobs (payload)"', async () => {
    expect((await loadJobPayloads(client, [])).size).toBe(0)
    expect(client.from).not.toHaveBeenCalled()
    state.queues.article_jobs = [{ data: null, error: { message: 'zu groß' } }]
    await expect(loadJobPayloads(client, [meta(0)])).rejects.toThrow('article_jobs (payload): zu groß')
  })
})
const job = (over: Partial<BaselineJobRow>): BaselineJobRow => ({ ...JOB, ...over })
const unit = (id: string, memberIds: string[]): BaselineUnit => ({ id, position: 0, heading: id, bundleType: null, memberIds })
const llmRow = (iso: string, use_case: string, cost: number | null, repriced = false) => ({ at: new Date(iso).getTime(), iso, use_case, cost, repriced })
const pItem = (id: string, total_score: number, over: Partial<PoolItem> = {}): PoolItem => ({
  id, title: id, source_identifier: 's', total_score, bundle_type: null, metadata: {}, content_length: 1000,
  daily_repo_id: null, queued_at: '2026-09-09T20:00:00.000Z', ...over,
})

describe('Messlogik — Jobs je Tag', () => {
  it('groupJobsByDay: manuelle Jobs je Berlin-Tag in Reihenfolge; Auto = jüngster Job mit status=done (Entscheidung 4)', () => {
    const a1 = job({ id: 'a1', source: 'auto', status: 'done', created_at: '2026-09-10T01:00:00.000Z' })
    const a2 = job({ id: 'a2', source: 'auto', status: 'done', created_at: '2026-09-10T02:00:00.000Z' })
    const a3 = job({ id: 'a3', source: 'auto', status: 'error', created_at: '2026-09-10T03:00:00.000Z' })
    const m1 = job({ id: 'm1', source: 'manual', status: 'done', created_at: '2026-09-10T04:00:00.000Z' })
    const m2 = job({ id: 'm2', source: 'manual', status: 'error', created_at: '2026-09-10T22:30:00.000Z' })   // Berlin 00:30 am 11.
    const m3 = job({ id: 'm3', source: 'manual', status: 'done', created_at: '2026-09-10T05:00:00.000Z' })
    const { manualByDay, autoByDay } = groupJobsByDay([a1, a2, a3, m1, m3, m2])
    expect([...manualByDay.entries()].map(([d, js]) => [d, js.map((j) => j.id)])).toEqual([['2026-09-10', ['m1', 'm3']], ['2026-09-11', ['m2']]])
    expect(autoByDay.get('2026-09-10')?.id).toBe('a2')   // a3 ist error → nicht der Nachtlauf
    expect(autoByDay.has('2026-09-11')).toBe(false)
    // WARUM unsortiert: die Wahl darf nicht von der Sortierung des Aufrufers
    // abhängen („letzter gewinnt" nähme hier a1) — wie pickPrecedentJobs (Task 11).
    expect(groupJobsByDay([a2, a1]).autoByDay.get('2026-09-10')?.id).toBe('a2')
  })
})

describe('Messlogik — total_score-Baseline ohne Hand-Leaks, Abdeckung', () => {
  it('neutralizeHandLabels: Betreiber-Labels → null, nur Techmeme-topic bleibt; Eingabe unverändert (Entscheidung 3)', () => {
    const items = [
      { id: 'hand', bundle_type: 'topic' as string | null, metadata: {} as Record<string, unknown> | null },
      { id: 'tm', bundle_type: 'topic' as string | null, metadata: { techmeme: true, techmeme_story: 's' } as Record<string, unknown> | null },
      { id: 'single', bundle_type: null as string | null, metadata: null as Record<string, unknown> | null },
      // deep_dive auf einem Techmeme-Item setzt nur der Betreiber (bundle-type-Route) → neutralisiert
      { id: 'tm-relabel', bundle_type: 'deep_dive' as string | null, metadata: { techmeme: true, techmeme_story: 's' } as Record<string, unknown> | null },
    ]
    const out = neutralizeHandLabels(items)
    expect(out.map((i) => i.bundle_type)).toEqual([null, 'topic', null, null])
    expect(out.map((i) => i.id)).toEqual(['hand', 'tm', 'single', 'tm-relabel'])
    expect(items[0].bundle_type).toBe('topic')
    expect(items[3].bundle_type).toBe('deep_dive')
  })

  it('totalScoreCandidates: Hand-Items (metadata.manual) auf Score 0 ans Ende, absteigend stabil, Labels neutralisiert, Eingabe unverändert', () => {
    const pool = [
      pItem('a', 8),
      pItem('manual', 20.05, { metadata: { manual: true }, bundle_type: 'topic' }),
      pItem('b', 10.5, { bundle_type: 'deep_dive' }),
      pItem('c', 8),
      pItem('tm', 9, { bundle_type: 'topic', metadata: { techmeme: true, techmeme_story: 's' } }),
    ]
    const out = totalScoreCandidates(pool)
    expect(out.map((p) => p.id)).toEqual(['b', 'tm', 'a', 'c', 'manual'])
    expect(out.map((p) => p.bundle_type)).toEqual([null, 'topic', null, null, null])
    expect(out[4].total_score).toBe(0)
    expect(pool[1].total_score).toBe(20.05)
    expect(pool[1].bundle_type).toBe('topic')
  })

  it('totalScoreListsByK: K zählt Einheiten — ein Techmeme-Bündel mit 5 Quellen ist EINE Einheit, die Liste für 20 umfasst genau 20 Einheiten (Entscheidung 3)', () => {
    // Eine Techmeme-Story mit 6 Quellen (capByUnits kappt auf BUNDLE_SOURCES_MAX = 5)
    // und 25 Einzelmeldungen mit absteigendem Score.
    const tm = Array.from({ length: 6 }, (_, i) =>
      pItem(`tm${i}`, 9.9 - i * 0.1, { bundle_type: 'topic', metadata: { techmeme: true, techmeme_story: 's1' } }))
    const singles = Array.from({ length: 25 }, (_, i) => pItem(`s${String(i).padStart(2, '0')}`, 8 - i * 0.1))
    const lists = totalScoreListsByK([...singles, ...tm], [10, 20])
    const unitsOf = (ids: string[]) => new Set(ids.map((id) => (id.startsWith('tm') ? 'story:s1' : id))).size
    expect(lists['20']).toHaveLength(24)   // 5 Bündel-Quellen + 19 Singles
    expect(unitsOf(lists['20'])).toBe(20)
    expect(lists['10']).toHaveLength(14)   // 5 + 9
    expect(unitsOf(lists['10'])).toBe(10)
    expect(lists['20'].slice(0, 5)).toEqual(['tm0', 'tm1', 'tm2', 'tm3', 'tm4'])   // tm5 fällt am 5er-Kap
    expect(lists['20'].slice(0, 14)).toEqual(lists['10'])   // Präfix — wantedIdsOf bekommt nur die 20er-Liste
    // WARUM dieser Fall: ein ID-Schnitt bei K = 20 sähe nur 16 Einheiten (5 IDs für das Bündel).
    expect(unitsOf(lists['20'].slice(0, 20))).toBe(16)
  })

  it('coverageOf: attribuierbar = mit Membern; abgedeckt = ≥1 Member im Pool; techmemeOnly = nicht abgedeckt und nur Techmeme-Member', () => {
    const A = unit('A', [U1]); const B = unit('B', ['tm-1']); const C = unit('C', []); const D = unit('D', [U2])
    const res = coverageOf([A, B, C, D], new Set([U1]), new Set(['tm-1']))
    expect(res.attributable.map((u) => u.id)).toEqual(['A', 'B', 'D'])
    expect(res.covered.map((u) => u.id)).toEqual(['A'])
    expect(res.techmemeOnly.map((u) => u.id)).toEqual(['B'])
  })

  it('publishedContentLengthsOf: nur endliche content_length bekannter Items, in Reihenfolge der IDs', () => {
    const itemRows = new Map<string, ItemRow>([
      [U1, { content_length: 1200, daily_repo_id: null, source_identifier: 's', metadata: null }],
      [U2, { content_length: null, daily_repo_id: null, source_identifier: 's', metadata: null }],
      [U3, { content_length: NaN, daily_repo_id: null, source_identifier: 's', metadata: null }],
      [HAND_OLD, { content_length: 3000, daily_repo_id: null, source_identifier: 's', metadata: null }],
    ])
    // NIGHT hat keine news_queue-Zeile → fällt weg
    expect(publishedContentLengthsOf(new Set([HAND_OLD, U1, U2, U3, NIGHT]), itemRows)).toEqual([3000, 1200])
    expect(publishedContentLengthsOf([], itemRows)).toEqual([])
  })
})

describe('Messlogik — Embedding-Zuordnung (Entscheidung 6)', () => {
  it('wantedIdsOf: alle Ranking-Listen (null = keine Liste) und alle Member-IDs, dedupliziert in Reihenfolge', () => {
    const units = [unit('A', [U1, U3]), unit('B', []), unit('C', [HAND_OLD])]
    expect(wantedIdsOf([[U1, U2], null, [U2, NIGHT]], units)).toEqual([U1, U2, NIGHT, U3, HAND_OLD])
    expect(wantedIdsOf([], [])).toEqual([])
  })

  it('repoIdsOf / itemEmbeddingsOf: nachgeladener Member außerhalb des Pools bekommt sein Embedding; ohne daily_repo_id oder ohne Vektor fehlt die ID (eigener Cluster)', () => {
    const itemRows = new Map<string, ItemRow>([
      [U1, { content_length: 1000, daily_repo_id: 'repo-1', source_identifier: 's', metadata: null }],                 // Pool-Item
      [HAND_OLD, { content_length: 3000, daily_repo_id: 'repo-old', source_identifier: 's', metadata: null }],         // nachgeladener Member
      [U3, { content_length: 120, daily_repo_id: null, source_identifier: 's', metadata: null }],                      // Techmeme/UI-Handitem
      [NIGHT, { content_length: 700, daily_repo_id: 'repo-ohne-vektor', source_identifier: 's', metadata: null }],
    ])
    const idToRepo = repoIdsOf([U1, HAND_OLD, U3, NIGHT, U2], itemRows)   // U2 hat keine news_queue-Zeile
    expect([...idToRepo.entries()]).toEqual([[U1, 'repo-1'], [HAND_OLD, 'repo-old'], [NIGHT, 'repo-ohne-vektor']])
    const emb = itemEmbeddingsOf(idToRepo, new Map([['repo-1', [1, 0]], ['repo-old', [0, 1]]]))
    expect([...emb.keys()]).toEqual([U1, HAND_OLD])
    expect(emb.get(HAND_OLD)).toEqual([0, 1])
  })
})

describe('Messlogik — Metriken und Aggregation', () => {
  it('rankedMetricsOf: Unit-/ID-Recall, Precision und Treffer je K; unit_hits_covered zählt nur abgedeckte Einheiten', () => {
    const A = unit('A', [U1]); const B = unit('B', [U2]); const C = unit('C', [U3])
    const ids = [U1, NIGHT, U3]
    const m = rankedMetricsOf(ids, [A, B, C], [A, B], new Map(), [1, 3])
    expect(m.unit_recall['1']).toBeCloseTo(1 / 3)
    expect(m.unit_recall['3']).toBeCloseTo(2 / 3)
    expect(m.id_recall['1']).toBeCloseTo(1 / 3)
    expect(m.id_recall['3']).toBeCloseTo(2 / 3)
    expect(m.precision['1']).toBe(1)
    expect(m.precision['3']).toBeCloseTo(2 / 3)
    expect(m.unit_hits).toEqual({ '1': 1, '3': 2 })
    expect(m.unit_hits_covered).toEqual({ '1': 1, '3': 1 })   // C ist nicht abgedeckt → zählt nicht
    // Story-Ebene: NIGHT und U2 sind dieselbe Story → B wird getroffen
    const story = rankedMetricsOf(ids, [A, B, C], [A, B], new Map([[NIGHT, 'k'], [U2, 'k']]), [3])
    expect(story.unit_hits['3']).toBe(3)
    expect(story.unit_hits_covered['3']).toBe(2)
  })

  it('unitCappedMetricsOf: je K die VOLLE Liste (kein ID-Schnitt); fehlende Liste → Recall und Precision 0', () => {
    // a, b, c = drei Quellen derselben Einheit A (Bündel), d = Einheit B, x = Einheit C (nicht in der Liste)
    const A = unit('A', ['a', 'b', 'c']); const B = unit('B', ['d']); const C = unit('C', ['x'])
    const lists = { '1': ['a', 'b', 'c'], '2': ['a', 'b', 'c', 'd'] }
    const m = unitCappedMetricsOf(lists, [A, B, C], [A, B], new Map(), [1, 2, 3])
    expect(m.unit_hits).toEqual({ '1': 1, '2': 2, '3': 0 })
    expect(m.unit_recall['2']).toBeCloseTo(2 / 3)
    expect(m.unit_hits_covered['2']).toBe(2)
    expect(m.id_recall['2']).toBeCloseTo(4 / 5)
    expect(m.precision['2']).toBe(1)   // Nenner = 4 IDs der Liste
    expect(m.unit_recall['3']).toBe(0)
    expect(m.precision['3']).toBe(0)
    // Gegenprobe: der ID-Schnitt bei K = 2 träfe nur A — genau der behobene Fehler.
    expect(rankedMetricsOf(lists['2'], [A, B, C], [A, B], new Map(), [2]).unit_hits['2']).toBe(1)
  })

  it('handMetricsOf: P/R über die volle Liste und Dubletten-Rate; leere Handauswahl → null (keine 0 in der Gate-Referenz)', () => {
    const A = unit('A', [U1]); const B = unit('B', [U2])
    const h = handMetricsOf([U1, U3, NIGHT, HAND_OLD], [A, B], [A, B], new Map([[NIGHT, 'k'], [HAND_OLD, 'k']]), [2]) as HandMetrics
    expect(h.precision_full).toBeCloseTo(1 / 4)
    expect(h.recall_full).toBeCloseTo(1 / 2)
    expect(h.duplicate_rate).toBeCloseTo(1 / 4)
    expect(h.unit_recall['2']).toBeCloseTo(1 / 2)
    expect(handMetricsOf([], [A, B], [A, B], new Map(), [2])).toBeNull()
  })

  it('aggregateRanked: n zählt nur Tage mit Messung (null); unit_recall_covered je K = Treffer auf abgedeckte ÷ abgedeckte, nie > 1', () => {
    const m1: RankedMetrics = { unit_recall: { '10': 0.25, '20': 0.5 }, unit_hits: { '10': 2, '20': 3 }, unit_hits_covered: { '10': 0, '20': 1 }, id_recall: { '10': 0.1, '20': 0.2 }, precision: { '10': 0.3, '20': 0.4 } }
    const m2: RankedMetrics = { unit_recall: { '10': 0, '20': 0.1 }, unit_hits: { '10': 0, '20': 0 }, unit_hits_covered: { '10': 0, '20': 0 }, id_recall: { '10': 0, '20': 0 }, precision: { '10': 0, '20': 0 } }
    const agg = aggregateRanked([{ m: m1, covered: 2 }, { m: m2, covered: 0 }, { m: null, covered: 3 }], [10, 20])
    expect(agg.n).toBe(2)
    expect(agg.unit_recall['20']).toBeCloseTo(0.3)
    expect(agg.unit_recall_covered['20']).toBe(0.5)   // 1 ÷ 2, nicht 3 ÷ 2; Tag mit covered 0 fällt heraus
    expect(agg.unit_recall_covered['10']).toBe(0)     // Setzlisten-Recall@10 normiert (Entscheidung 7)
    expect(agg.id_recall['20']).toBeCloseTo(0.1)
    expect(agg.precision['20']).toBeCloseTo(0.2)
    const empty = aggregateRanked([{ m: null, covered: 1 }], [10, 20])
    expect(empty.n).toBe(0)
    expect(empty.unit_recall['10']).toBeNaN()
    expect(empty.unit_recall_covered['10']).toBeNaN()
    expect(empty.unit_recall_covered['20']).toBeNaN()
  })

  it('aggregateHandExtras und pairedDiffs: nur Tage mit Handauswahl', () => {
    const base: RankedMetrics = { unit_recall: { '20': 0.2 }, unit_hits: {}, unit_hits_covered: {}, id_recall: {}, precision: {} }
    const h1: HandMetrics = { ...base, unit_recall: { '20': 0.7 }, precision_full: 0.6, recall_full: 0.9, duplicate_rate: 0 }
    const h2: HandMetrics = { ...base, unit_recall: { '20': 0.5 }, precision_full: 0.4, recall_full: 0.7, duplicate_rate: 0.1 }
    expect(aggregateHandExtras([h1, null, h2])).toEqual({ precision_full: 0.5, recall_full: 0.8, duplicate_rate_mean: 0.05 })
    const extrasEmpty = aggregateHandExtras([null])
    expect(extrasEmpty.precision_full).toBeNaN()
    const diffs = pairedDiffs([{ hand: h1, total: base }, { hand: null, total: base }, { hand: h2, total: base }], 20)
    expect(diffs).toHaveLength(2)
    expect(diffs[0]).toBeCloseTo(0.5)
    expect(diffs[1]).toBeCloseTo(0.3)
  })

  it('precedentAgreementOf: gleicher Job / anderer Job / keine Präzedenzfälle je Tag (Entscheidung 25)', () => {
    expect(precedentAgreementOf([
      { day: '2026-09-10', job_id: 'j1', precedent_job_id: 'j1' },
      { day: '2026-09-11', job_id: 'j2', precedent_job_id: 'j-alt' },
      { day: '2026-09-12', job_id: 'j3', precedent_job_id: null },
      { day: '2026-09-13', job_id: 'j4', precedent_job_id: 'j4' },
    ])).toEqual({ match: 2, mismatch: 1, missing: 1, mismatch_days: ['2026-09-11'], missing_days: ['2026-09-12'] })
    expect(precedentAgreementOf([])).toEqual({ match: 0, mismatch: 0, missing: 0, mismatch_days: [], missing_days: [] })
  })
})

describe('Messlogik — Techmeme, Kosten, Zeitkette, Durchsatz', () => {
  it('techmemeAdoption: Story global dedupliziert, Rang = erstes Auftreten, published an irgendeinem Tag (Entscheidung 13)', () => {
    const res = techmemeAdoption([
      { items: [{ id: 'T1', story: 's-a', storyIndex: 0 }, { id: 'T2', story: 's-a', storyIndex: 0 }, { id: 'T3', story: 's-b', storyIndex: 1 }], publishedIds: new Set(['T2']) },
      { items: [{ id: 'T4', story: 's-a', storyIndex: 2 }, { id: 'T5', story: 's-c', storyIndex: 0 }], publishedIds: new Set() },
      { items: [{ id: 'T6', story: 's-b', storyIndex: 3 }], publishedIds: new Set(['T6']) },
    ])
    expect(res).toEqual([
      { story_index: 0, stories: 2, published: 1, rate: 0.5 },
      { story_index: 1, stories: 1, published: 1, rate: 1 },
    ])
    expect(techmemeAdoption([])).toEqual([])
  })

  it('techmemeByUtcDay: nur der use_case, je UTC-Tag Kosten/Aufrufe, Läufe mit Lücke ≤ gap zusammen', () => {
    const gap = 10 * 60 * 1000
    const res = techmemeByUtcDay([
      llmRow('2026-09-20T23:50:00.000Z', 'techmeme_relevance', 0.1),
      llmRow('2026-09-21T00:10:00+00:00', 'techmeme_relevance', 0.2),
      llmRow('2026-09-21T00:15:00.000Z', 'techmeme_relevance', null),
      llmRow('2026-09-21T00:20:00.000Z', 'ghostwriter', 9),
      llmRow('2026-09-21T04:10:00.000Z', 'techmeme_relevance', 0.3),
    ], 'techmeme_relevance', gap, '2026-09-20')
    expect(res).toEqual([
      { day: '2026-09-20', cost_usd: 0.1, calls: 1, runs: [{ start: '2026-09-20T23:50:00.000Z', end: '2026-09-20T23:50:00.000Z', calls: 1 }] },
      { day: '2026-09-21', cost_usd: 0.5, calls: 3, runs: [
        { start: '2026-09-21T00:10:00.000Z', end: '2026-09-21T00:15:00.000Z', calls: 2 },
        { start: '2026-09-21T04:10:00.000Z', end: '2026-09-21T04:10:00.000Z', calls: 1 },
      ] },
    ])
  })

  it('techmemeByUtcDay: UTC-Tage vor fromUtcDay fallen weg — kein angeschnittener Vortag aus dem 3-h-Vorfilter', () => {
    const res = techmemeByUtcDay([
      llmRow('2026-08-24T21:10:00.000Z', 'techmeme_relevance', 0.1),   // aus dem Vorfilter rangeStart − 3 h
      llmRow('2026-08-25T00:10:00.000Z', 'techmeme_relevance', 0.2),
    ], 'techmeme_relevance', 10 * 60 * 1000, '2026-08-25')
    expect(res.map((r) => r.day)).toEqual(['2026-08-25'])
    expect(res[0].cost_usd).toBe(0.2)
  })

  it('draftCostOf: nur done; Fenster [started_at, completed_at] inklusiv, nur Draft-use_cases, repriced/unpriced getrennt gezählt, ÷ Write-Units', () => {
    const useCases = new Set(['article_planning', 'ghostwriter', 'ghostwriter_take', 'proofreading'])
    const llm = [
      llmRow('2026-09-10T04:30:59.000Z', 'ghostwriter', 7),          // vor dem Fenster
      llmRow('2026-09-10T04:31:00.000Z', 'ghostwriter', 1),          // Grenze → drin
      llmRow('2026-09-10T04:35:00.000Z', 'article_planning', 2, true),   // nachberechnet (Opus 5.5) → zählt mit
      llmRow('2026-09-10T04:40:00.000Z', 'techmeme_relevance', 5),   // falscher use_case
      llmRow('2026-09-10T05:00:00.000Z', 'proofreading', null),      // Grenze → drin, unpriced
      llmRow('2026-09-10T05:00:01.000Z', 'ghostwriter', 9),          // nach dem Fenster
    ]
    expect(draftCostOf(JOB, 3, llm, useCases)).toEqual({
      job_id: 'job-1', day: '2026-09-10', write_units: 2, published_units: 3,
      calls: 3, repriced_calls: 1, unpriced_calls: 1, cost_usd: 3, cost_per_write_unit_usd: 1.5, minutes: 29,
    })
    expect(draftCostOf(job({ started_at: null }), 3, llm, useCases)).toBeNull()
    expect(draftCostOf(job({ status: 'error' }), 3, llm, useCases)).toBeNull()
    expect(draftCostOf(job({ written_sections: null }), null, llm, useCases)).toMatchObject({ published_units: null, cost_per_write_unit_usd: null })
  })

  it('draftCostOf: ohne Draft-llm_usage-Zeile im Fenster → null statt 0 $ (llm_usage erst ab 2026-09-20, Gemini-Zweig loggt nicht — Entscheidung 10)', () => {
    const useCases = new Set(['article_planning', 'ghostwriter', 'ghostwriter_take', 'proofreading'])
    expect(draftCostOf(JOB, 3, [], useCases)).toBeNull()
    expect(draftCostOf(JOB, 3, [llmRow('2026-09-10T04:40:00.000Z', 'techmeme_relevance', 5)], useCases)).toBeNull()
  })

  it('draftCostsOf: eine Kandidatenregel für Zähler und Kostenzeile — done ohne Usage zählt als withoutUsage; error, ohne started_at und auto sind keine Kandidaten, auch mit Usage im Fenster (Entscheidung 10)', () => {
    const useCases = new Set(['article_planning', 'ghostwriter', 'ghostwriter_take', 'proofreading'])
    const llm = [llmRow('2026-09-10T04:40:00.000Z', 'ghostwriter', 2)]
    const noUsage = job({ id: 'no-usage', created_at: '2026-09-11T04:30:00.000Z', started_at: '2026-09-11T04:31:00.000Z', completed_at: '2026-09-11T05:00:00.000Z' })
    const res = draftCostsOf([
      JOB,
      noUsage,
      job({ id: 'err', status: 'error' }),
      job({ id: 'nostart', started_at: null }),
      job({ id: 'auto', source: 'auto' }),
    ], new Map([['job-1', 13]]), llm, useCases)
    expect(res.candidates).toBe(2)
    expect(res.withoutUsage).toBe(1)
    expect(res.rows).toEqual([{
      job_id: 'job-1', day: '2026-09-10', write_units: 2, published_units: 13,
      calls: 1, repriced_calls: 0, unpriced_calls: 0, cost_usd: 2, cost_per_write_unit_usd: 1, minutes: 29,
    }])
    expect(res.candidates).toBe(res.rows.length + res.withoutUsage)
    expect(draftCostsOf([], new Map(), llm, useCases)).toEqual({ candidates: 0, rows: [], withoutUsage: 0 })
  })

  it('analysisEndByDay: Ende des ersten Laufs ab dailyAnalysis je Berlin-Tag — späte Handergänzungen und Neuläufe zählen nicht (Entscheidung 8)', () => {
    const opts = { notBeforeBerlinMinute: 5 * 60, gapMs: 15 * 60 * 1000, fromBerlinDay: '2026-09-21', beforeBerlinDay: '2026-09-24' }
    const res = analysisEndByDay([
      // 21.09. (Berlin = UTC+2): Handlauf 03:30 Berlin vor dem Slot, Charge ab 05:02 Berlin
      '2026-09-21T01:30:00.000Z',
      '2026-09-21T03:02:00.000Z',
      '2026-09-21T03:12:40+00:00',
      '2026-09-21T03:05:00.000Z',
      '2026-09-21T08:00:00.000Z',   // add-from-repo am Vormittag → later_rows
      '2026-09-21T12:00:00.000Z',   // manueller Synthese-Neulauf → later_rows
      // 22.09.: nur ein Lauf
      '2026-09-22T03:00:00.000Z',
      // 23.09.: nur eine Handergänzung um 02:00 Berlin → kein Lauf ab Startzeit
      '2026-09-23T00:00:00.000Z',
    ], opts)
    expect(res.days).toEqual([
      { day: '2026-09-21', run_start: '2026-09-21T03:02:00.000Z', last_queued_at: '2026-09-21T03:12:40.000Z', utc: '03:12', berlin: '05:12', rows: 3, later_rows: 2 },
      { day: '2026-09-22', run_start: '2026-09-22T03:00:00.000Z', last_queued_at: '2026-09-22T03:00:00.000Z', utc: '03:00', berlin: '05:00', rows: 1, later_rows: 0 },
    ])
    expect(res.daysWithoutScheduledRun).toEqual(['2026-09-23'])
    expect(analysisEndByDay([], opts)).toEqual({ days: [], daysWithoutScheduledRun: [] })
  })

  it('analysisEndByDay: angeschnittener erster Tag und laufender Tag fallen weg — nur volle Berlin-Tage (Entscheidung 8)', () => {
    const res = analysisEndByDay([
      // Vortag, nur die Nachmittags-Handergänzung (14:00 Berlin) im 3-h-Vorlauf-Fenster —
      // ohne Schnitt stünde sie als „Analyse-Ende 14:00" in den Quantilen
      '2026-09-20T12:00:00.000Z',
      '2026-09-21T03:00:00.000Z',   // 05:00 Berlin, voller Tag
      // laufender Tag, 04:00 Berlin, Slot noch nicht erreicht — ohne Schnitt „Tag ohne Lauf"
      '2026-09-22T02:00:00.000Z',
    ], { notBeforeBerlinMinute: 5 * 60, gapMs: 15 * 60 * 1000, fromBerlinDay: '2026-09-21', beforeBerlinDay: '2026-09-22' })
    expect(res.days.map((d) => [d.day, d.berlin])).toEqual([['2026-09-21', '05:00']])
    expect(res.daysWithoutScheduledRun).toEqual([])
  })

  it('throughputOf: nur manual + done, ≥ minUnits Write-Units und beide Zeitstempel (Entscheidung 12)', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `s${i}`)
    const ok = job({ id: 'ok', started_at: '2026-09-10T04:00:00.000Z', completed_at: '2026-09-10T04:30:00.000Z', written_sections: twenty })
    const rows = throughputOf([
      ok,
      job({ id: 'auto', source: 'auto', written_sections: twenty }),
      job({ id: 'err', status: 'error', written_sections: [...twenty, 'x'] }),
      job({ id: 'short', written_sections: twenty.slice(1) }),
      job({ id: 'nostart', started_at: null, written_sections: twenty }),
    ], 20)
    expect(rows).toEqual([{ job_id: 'ok', day: '2026-09-10', source: 'manual', write_units: 20, minutes: 30, write_units_per_minute: 20 / 30 }])
  })

  it('newsletterArrivalOf: Vorlauf vor dem Analyse-Slot (Berlin), kritischste Quelle zuerst; Tageswechsel und Nachmittagsquellen richtig eingeordnet (Entscheidung 9)', () => {
    const slot = 5 * 60   // 05:00 Berlin
    const res = newsletterArrivalOf([
      // 04:30 Berlin = 30 min vor dem Slot; collected_at (08:00 Berlin) darf nicht zählen
      { source_email: 'late@x', email_received_at: '2026-09-21T02:30:00.000Z', collected_at: '2026-09-21T06:00:00.000Z' },
      // US-Quelle am Nachmittag (17:00 / 18:00 Berlin): 11–12 h Vorlauf, darf NICHT oben stehen
      { source_email: 'us@x', email_received_at: '2026-09-21T15:00:00.000Z', collected_at: null },
      { source_email: 'us@x', email_received_at: '2026-09-22T16:00:00.000Z', collected_at: null },
      // streut um 00:00 UTC (01:55 / 02:05 Berlin): p50 02:00, nicht Tagesmitte; zweite Zeile über collected_at
      { source_email: 'mid@x', email_received_at: '2026-09-21T23:55:00.000Z', collected_at: null },
      { source_email: 'mid@x', email_received_at: null, collected_at: '2026-09-23T00:05:00.000Z' },
      { source_email: null, email_received_at: '2026-09-21T01:00:00.000Z', collected_at: null },   // 03:00 Berlin
      { source_email: 'c@x', email_received_at: null, collected_at: null },                         // ohne Zeit → raus
    ], slot)
    expect(res.map((r) => r.source_email)).toEqual(['late@x', '(ohne Absender)', 'mid@x', 'us@x'])
    expect(res[0]).toEqual({ source_email: 'late@x', n: 1, lead_p50_minutes: 30, lead_p10_minutes: 30, arrival_p50_berlin: '04:30', arrival_p90_berlin: '04:30' })
    expect(res[2]).toEqual({ source_email: 'mid@x', n: 2, lead_p50_minutes: 180, lead_p10_minutes: 176, arrival_p50_berlin: '02:00', arrival_p90_berlin: '02:04' })
    expect(res[3]).toEqual({ source_email: 'us@x', n: 2, lead_p50_minutes: 690, lead_p10_minutes: 666, arrival_p50_berlin: '17:30', arrival_p90_berlin: '17:54' })
    // Eingang nach dem Slot (05:10 Berlin) → fast ein Tag Vorlauf: landet ohnehin in der Folgeanalyse
    expect(newsletterArrivalOf([{ source_email: 'after@x', email_received_at: '2026-09-21T03:10:00.000Z', collected_at: null }], slot)[0].lead_p50_minutes).toBe(1430)
  })
})
