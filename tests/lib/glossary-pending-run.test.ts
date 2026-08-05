/**
 * runPendingUnit — Fachlogik hinter dem 'pending'-Job (Umbau 2026-08-05, der
 * vierte browser-getriebene Lexikonlauf). Verarbeitet GENAU EINEN vorgemerkten
 * Kandidaten (limit=1) und übernimmt die Abschlussbehandlung (Veröffentlichen
 * + Verlinken), sobald nichts mehr offen ist.
 *
 * ensureConfirmedTermsExist und applyGlossaryConfirmation sind eigenständig
 * getestet (glossary-ensure-terms.test.ts, glossary-confirm.test.ts) — hier
 * werden sie gemockt, damit nur die Orchestrierung geprüft wird: Vormerkliste
 * fortschreiben, Protokoll-Namen auflösen, Abschluss NUR bei remaining===0,
 * Vormerkliste NUR bei Erfolg (linked>0) leeren.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { GlossaryCandidate } from '@/lib/glossary/types'

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  confirm: vi.fn(),
}))

vi.mock('@/lib/glossary/ensure-terms', () => ({ ensureConfirmedTermsExist: mocks.ensure }))
vi.mock('@/lib/glossary/confirm', () => ({ applyGlossaryConfirmation: mocks.confirm }))

const state = vi.hoisted(() => ({
  queues: {} as Record<string, unknown[]>,
  fallback: { data: null as unknown, error: null as unknown },
  chains: {} as Record<string, any[]>,
}))

function makeChain(table: string) {
  const chain: any = {}
  for (const m of ['select', 'eq', 'in', 'update']) chain[m] = vi.fn(() => chain)
  const queue = state.queues[table]
  const own = queue && queue.length ? queue.shift() : undefined
  const resolved = () => own ?? state.fallback
  chain.maybeSingle = vi.fn(async () => resolved())
  chain.single = vi.fn(async () => resolved())
  chain.then = (res: (v: unknown) => void) => res(resolved())
  ;(state.chains[table] ??= []).push(chain)
  return chain
}

const client = { from: vi.fn((t: string) => makeChain(t)) } as any

function candidate(slug: string, name: string): GlossaryCandidate {
  return { slug, name, origin: 'new', matchedText: null, isNewlyGenerated: false, needsGeneration: true }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.queues = {}
  state.chains = {}
  state.fallback = { data: null, error: null }
})

describe('runPendingUnit', () => {
  it('erzeugt einen Kandidaten und schreibt die Vormerkliste fort, wenn noch mehr offen sind', async () => {
    const a = candidate('speculative-decoding', 'Speculative Decoding')
    const b = candidate('reward-hacking', 'Reward Hacking')
    state.queues['generated_posts'] = [
      { data: { pending_glossary_terms: [a, b] }, error: null }, // Namen-Lookup vor dem Aufruf
      { data: null, error: null }, // Vormerkliste fortschreiben
    ]
    mocks.ensure.mockResolvedValue({ generatedSlugs: ['speculative-decoding'], pendingRemainder: [b] })

    const { runPendingUnit } = await import('@/lib/glossary/pending-run')
    const result = await runPendingUnit(client, 'p1', ['speculative-decoding', 'reward-hacking'])

    expect(mocks.ensure).toHaveBeenCalledWith(client, 'p1', ['speculative-decoding', 'reward-hacking'], 1)
    expect(result.generated).toEqual(['Speculative Decoding'])
    expect(result.failed).toEqual([])
    expect(result.remaining).toBe(1)
    expect(result.linked).toBe(0)
    // Vormerkliste wird auf den Rest gesetzt — noch nicht geleert.
    const remainderCall = state.chains['generated_posts'][1]
    expect(remainderCall.update).toHaveBeenCalledWith({ pending_glossary_terms: [b] })
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('meldet einen fehlgeschlagenen Kandidaten, wenn nichts erzeugt wurde, aber noch etwas offen ist', async () => {
    const a = candidate('kaputt', 'Kaputt')
    state.queues['generated_posts'] = [
      { data: { pending_glossary_terms: [a] }, error: null },
      { data: null, error: null },
    ]
    // ensure-terms.ts liefert bei einem gescheiterten Versuch denselben
    // Kandidaten unveraendert im Rest zurueck.
    mocks.ensure.mockResolvedValue({ generatedSlugs: [], pendingRemainder: [a] })

    const { runPendingUnit } = await import('@/lib/glossary/pending-run')
    const result = await runPendingUnit(client, 'p1', ['kaputt'])

    expect(result.generated).toEqual([])
    expect(result.failed).toEqual(['Kaputt'])
    expect(result.remaining).toBe(1)
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('veroeffentlicht und verlinkt, wenn nach dieser Einheit nichts mehr offen ist', async () => {
    const a = candidate('slop', 'Slop')
    state.queues['generated_posts'] = [
      { data: { pending_glossary_terms: [a] }, error: null }, // Namen-Lookup
      { data: { content: '{"type":"doc"}' }, error: null }, // Content fuer den Abschluss
      { data: null, error: null }, // Content zurueckschreiben
      { data: null, error: null }, // Vormerkliste leeren
    ]
    // pendingRemainder: null heisst "nichts mehr offen" (ensure-terms.ts).
    mocks.ensure.mockResolvedValue({ generatedSlugs: ['slop'], pendingRemainder: null })
    mocks.confirm.mockResolvedValue({ publishedSlugs: ['slop'], content: '{"type":"doc","injected":true}' })

    const { runPendingUnit } = await import('@/lib/glossary/pending-run')
    const result = await runPendingUnit(client, 'p1', ['slop'])

    expect(result.remaining).toBe(0)
    expect(result.linked).toBe(1)
    expect(mocks.confirm).toHaveBeenCalledWith(client, 'p1', ['slop'], '{"type":"doc"}')
    // Reihenfolge: [0] Namen-Lookup, [1] Content-Lookup, [2] Content-Schreiben, [3] Vormerkliste leeren.
    expect(state.chains['generated_posts'][2].update).toHaveBeenCalledWith({ content: '{"type":"doc","injected":true}' })
    expect(state.chains['generated_posts'][3].update).toHaveBeenCalledWith({ pending_glossary_terms: null })
  })

  it('leert die Vormerkliste NICHT, wenn das Veroeffentlichen nichts verlinkt hat', async () => {
    // Regressionsschutz: ohne diese Bedingung würde ein Begriff, dessen
    // Veröffentlichung scheitert (z. B. hidden-Status), aus der Vormerkliste
    // verschwinden, ohne je sichtbar geworden zu sein — der Operator könnte
    // ihn nicht mehr erneut anstoßen.
    const a = candidate('slop', 'Slop')
    state.queues['generated_posts'] = [
      { data: { pending_glossary_terms: [a] }, error: null },
      { data: { content: '{"type":"doc"}' }, error: null },
      // Kein content-Update-Eintrag noetig: applyGlossaryConfirmation liefert
      // hier kein content zurueck (nichts injiziert).
    ]
    mocks.ensure.mockResolvedValue({ generatedSlugs: ['slop'], pendingRemainder: null })
    mocks.confirm.mockResolvedValue({ publishedSlugs: [] })

    const { runPendingUnit } = await import('@/lib/glossary/pending-run')
    const result = await runPendingUnit(client, 'p1', ['slop'])

    expect(result.linked).toBe(0)
    // Nur zwei Aufrufe insgesamt (Namen-Lookup + Content-Lookup) — keine
    // weiteren Schreibzugriffe auf generated_posts.
    expect(state.chains['generated_posts'].length).toBe(2)
    // Review-Fund: der Job darf hier NICHT stillschweigend als erledigt
    // gelten — publishFailed traegt den Namen des nicht veroeffentlichten
    // Kandidaten, damit advanceJob den Job als 'error' statt 'done' beendet.
    expect(result.publishFailed).toEqual(['Slop'])
  })

  it('meldet publishFailed und leert die Vormerkliste NICHT, wenn nur EIN Teil der bestaetigten Slugs veroeffentlicht wurde', async () => {
    // Review-Fund (Datenverlust): ensureConfirmedTermsExist kann bei einem
    // geschluckten Lesefehler pendingRemainder:null liefern, obwohl gar nicht
    // alles erledigt ist. Landet dieser Zustand hier, darf ein Teilerfolg
    // (ein Slug veroeffentlicht, ein anderer NICHT) die Vormerkliste nicht
    // leeren — sonst waere der nicht veroeffentlichte Kandidat unauffindbar
    // verloren, ohne je erzeugt worden zu sein.
    const a = candidate('slop', 'Slop')
    const b = candidate('reward-hacking', 'Reward Hacking')
    state.queues['generated_posts'] = [
      { data: { pending_glossary_terms: [a, b] }, error: null }, // Namen-Lookup
      { data: { content: '{"type":"doc"}' }, error: null }, // Content-Lookup
      { data: null, error: null }, // Content zurueckschreiben (fuer 'slop' injiziert)
      // KEIN "Vormerkliste leeren"-Eintrag — darf nicht aufgerufen werden.
    ]
    mocks.ensure.mockResolvedValue({ generatedSlugs: ['slop', 'reward-hacking'], pendingRemainder: null })
    // 'reward-hacking' fehlt in publishedSlugs — z. B. weil der Begriff
    // inzwischen hidden gesetzt wurde oder das Publish-Update fehlschlug.
    mocks.confirm.mockResolvedValue({ publishedSlugs: ['slop'], content: '{"type":"doc","injected":true}' })

    const { runPendingUnit } = await import('@/lib/glossary/pending-run')
    const result = await runPendingUnit(client, 'p1', ['slop', 'reward-hacking'])

    expect(result.linked).toBe(1)
    expect(result.publishFailed).toEqual(['Reward Hacking'])
    // Content wird trotzdem geschrieben — der Teilerfolg (slop verlinkt) soll
    // nicht verloren gehen, nur weil reward-hacking nicht durchkam.
    expect(state.chains['generated_posts'][2].update).toHaveBeenCalledWith({ content: '{"type":"doc","injected":true}' })
    // Genau drei Aufrufe — kein vierter fuer "Vormerkliste leeren".
    expect(state.chains['generated_posts'].length).toBe(3)
  })

  it('nennt beim Fehlschlag den TATSAECHLICH versuchten Kandidaten, nicht einen bereits vorhandenen', async () => {
    // Review-Fund: ensure-terms.ts prueft die Existenz ALLER eligiblen
    // Kandidaten VORAB und filtert bereits vorhandene lautlos heraus, bevor
    // es den ersten "missing" Kandidaten versucht. Der erste bestaetigte
    // Kandidat in der Vormerkliste ('a') existiert hier schon und wird daher
    // NICHT in pendingRemainder auftauchen (lautlos aufgeloest) — der
    // tatsaechliche Versuch (und Fehlschlag) betraf 'b'.
    const a = candidate('existiert-schon', 'Existiert Schon')
    const b = candidate('kaputt', 'Kaputt')
    state.queues['generated_posts'] = [
      { data: { pending_glossary_terms: [a, b] }, error: null },
      { data: null, error: null },
    ]
    mocks.ensure.mockResolvedValue({ generatedSlugs: [], pendingRemainder: [b] })

    const { runPendingUnit } = await import('@/lib/glossary/pending-run')
    const result = await runPendingUnit(client, 'p1', ['existiert-schon', 'kaputt'])

    expect(result.failed).toEqual(['Kaputt'])
    expect(result.remaining).toBe(1)
  })

  it('reicht limit=1 an ensureConfirmedTermsExist durch', async () => {
    state.queues['generated_posts'] = [
      { data: { pending_glossary_terms: [] }, error: null },
      { data: null, error: null },
    ]
    mocks.ensure.mockResolvedValue({ generatedSlugs: [], pendingRemainder: null })
    mocks.confirm.mockResolvedValue({ publishedSlugs: [] })

    const { runPendingUnit } = await import('@/lib/glossary/pending-run')
    await runPendingUnit(client, 'p1', ['x'])

    expect(mocks.ensure).toHaveBeenCalledWith(client, 'p1', ['x'], 1)
  })
})
