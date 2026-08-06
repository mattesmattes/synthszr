/**
 * ensureConfirmedTermsExist — erzeugt beim Speichern die Begriffe, die der
 * Operator bestätigt hat und die noch nicht existieren (Entkopplung 2026-08-04,
 * Befund B).
 *
 * Der Kern der Kostenersparnis steckt in der Auswahl: die lexicon-Phase merkt
 * ALLE erkannten Begriffe vor (in Prod waren das 25 in einem Artikel), erzeugt
 * werden aber nur die bestätigten. Vorher lief es umgekehrt — erst generieren,
 * dann auswählen lassen — was pro Artikel ~25 Minuten LLM- und Bildarbeit in
 * einer Phase mit 300s-Limit bedeutete und deshalb nie fertig wurde.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { GlossaryCandidate } from '@/lib/glossary/types'

const mocks = vi.hoisted(() => ({
  generateAndInsertDraft: vi.fn(),
}))

vi.mock('@/lib/glossary/draft-writer', () => ({
  generateAndInsertDraft: mocks.generateAndInsertDraft,
}))

/** Kandidat, wie ihn buildCandidateList seit der Entkopplung vormerkt. */
function pending(slug: string, name: string): GlossaryCandidate {
  return { slug, name, origin: 'new', matchedText: null, isNewlyGenerated: false, needsGeneration: true }
}

/** Kandidat, dessen Begriff schon existiert (Matcher-Treffer). */
function existing(slug: string, name: string): GlossaryCandidate {
  return { slug, name, origin: 'match', matchedText: name, isNewlyGenerated: false }
}

const state = vi.hoisted(() => ({
  candidates: null as unknown,
  existingSlugs: [] as Array<{ slug: string }>,
}))

function fakeSupabase() {
  return {
    from: (table: string) => {
      const chain: any = { table }
      for (const m of ['select', 'eq', 'in']) chain[m] = vi.fn(() => chain)
      const answer = () =>
        table === 'generated_posts'
          ? { data: { pending_glossary_terms: state.candidates }, error: null }
          : { data: state.existingSlugs, error: null }
      chain.maybeSingle = vi.fn(async () => answer())
      chain.single = vi.fn(async () => answer())
      chain.then = (res: (v: unknown) => void) => res(answer())
      return chain
    },
  }
}

beforeEach(() => {
  mocks.generateAndInsertDraft.mockReset()
  mocks.generateAndInsertDraft.mockImplementation(async (_sb: unknown, name: string, slug: string) => ({
    slug, canonicalName: name, aliases: [], summary: `Kurzfassung von ${name}.`,
  }))
  state.candidates = null
  state.existingSlugs = []
})

describe('ensureConfirmedTermsExist', () => {
  it('erzeugt einen bestätigten Kandidaten, dessen Begriff noch nicht existiert', async () => {
    state.candidates = [pending('speculative-decoding', 'Speculative Decoding')]
    const { ensureConfirmedTermsExist } = await import('@/lib/glossary/ensure-terms')
    const result = await ensureConfirmedTermsExist(fakeSupabase() as never, 'p1', ['speculative-decoding'])
    expect(mocks.generateAndInsertDraft).toHaveBeenCalledTimes(1)
    // Der Kandidaten-Slug wird als forcedSlug durchgereicht — sonst entstünde
    // der Begriff unter einer anderen Adresse als der bestätigte Kandidat.
    expect(mocks.generateAndInsertDraft).toHaveBeenCalledWith(
      expect.anything(), 'Speculative Decoding', 'speculative-decoding',
    )
    expect(result.generatedSlugs).toEqual(['speculative-decoding'])
    expect(result.pendingRemainder).toBeNull()
  })

  it('erzeugt NICHTS für Kandidaten, die der Operator nicht bestätigt hat', async () => {
    state.candidates = [
      pending('speculative-decoding', 'Speculative Decoding'),
      pending('reward-hacking', 'Reward Hacking'),
      pending('slop', 'Slop'),
    ]
    const { ensureConfirmedTermsExist } = await import('@/lib/glossary/ensure-terms')
    const result = await ensureConfirmedTermsExist(fakeSupabase() as never, 'p1', ['slop'])
    expect(mocks.generateAndInsertDraft).toHaveBeenCalledTimes(1)
    expect(mocks.generateAndInsertDraft).toHaveBeenCalledWith(expect.anything(), 'Slop', 'slop')
    expect(result.generatedSlugs).toEqual(['slop'])
  })

  it('erzeugt einen Begriff NICHT erneut, wenn er inzwischen schon existiert', async () => {
    state.candidates = [pending('speculative-decoding', 'Speculative Decoding')]
    state.existingSlugs = [{ slug: 'speculative-decoding' }]
    const { ensureConfirmedTermsExist } = await import('@/lib/glossary/ensure-terms')
    const result = await ensureConfirmedTermsExist(fakeSupabase() as never, 'p1', ['speculative-decoding'])
    expect(mocks.generateAndInsertDraft).not.toHaveBeenCalled()
    expect(result.generatedSlugs).toEqual([])
  })

  it('rührt die DB nicht an, wenn nichts bestätigt wurde', async () => {
    const { ensureConfirmedTermsExist } = await import('@/lib/glossary/ensure-terms')
    const result = await ensureConfirmedTermsExist(fakeSupabase() as never, 'p1', [])
    expect(mocks.generateAndInsertDraft).not.toHaveBeenCalled()
    expect(result).toEqual({ generatedSlugs: [], pendingRemainder: null })
  })

  it('erzeugt für Kandidaten ohne needsGeneration nichts (Begriff existiert bereits)', async () => {
    state.candidates = [existing('inferenz', 'Inferenz')]
    const { ensureConfirmedTermsExist } = await import('@/lib/glossary/ensure-terms')
    await ensureConfirmedTermsExist(fakeSupabase() as never, 'p1', ['inferenz'])
    expect(mocks.generateAndInsertDraft).not.toHaveBeenCalled()
  })

  it('deckelt die Menge pro Speichervorgang und behält den Rest verlustfrei', async () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((s) => pending(s, s.toUpperCase()))
    state.candidates = many
    const { ensureConfirmedTermsExist, MAX_GENERATE_PER_SAVE } = await import('@/lib/glossary/ensure-terms')
    const result = await ensureConfirmedTermsExist(
      fakeSupabase() as never, 'p1', ['a', 'b', 'c', 'd', 'e'],
    )
    expect(MAX_GENERATE_PER_SAVE).toBe(3)
    expect(mocks.generateAndInsertDraft).toHaveBeenCalledTimes(MAX_GENERATE_PER_SAVE)
    expect(result.generatedSlugs).toEqual(['a', 'b', 'c'])
    // Die übrigen dürfen NICHT verloren gehen: die Route leert
    // pending_glossary_terms nur, wenn pendingRemainder null ist. Sonst müsste
    // der Operator sie erneut identifizieren lassen (LLM-Call) — der Deckel wäre
    // dann eine Falle statt einer Bremse.
    expect(result.pendingRemainder?.map((c) => c.slug)).toEqual(['d', 'e'])
  })

  it('wirft NIE — ein unerwarteter Fehler darf das Speichern des Artikels nicht kosten', async () => {
    // Beim Verdrahten der Route aufgefallen: fehlte .maybeSingle() am Client,
    // schlug der PATCH komplett fehl und der Artikel wurde NICHT gespeichert.
    // Die Begriffs-Erzeugung ist eine Zugabe; sie darf den Artikel nie mitnehmen.
    const brokenClient = { from: () => ({ select: () => ({ eq: () => ({}) }) }) }
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ensureConfirmedTermsExist } = await import('@/lib/glossary/ensure-terms')
    const result = await ensureConfirmedTermsExist(brokenClient as never, 'p1', ['irgendwas'])
    expect(result).toEqual({ generatedSlugs: [], pendingRemainder: null })
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('behält einen Kandidaten, dessen Generierung fehlschlägt, statt ihn zu verlieren', async () => {
    state.candidates = [pending('kaputt', 'Kaputt'), pending('geht', 'Geht')]
    mocks.generateAndInsertDraft.mockImplementation(async (_sb: unknown, name: string, slug: string) =>
      slug === 'kaputt' ? null : { slug, canonicalName: name, aliases: [], summary: 's' },
    )
    const { ensureConfirmedTermsExist } = await import('@/lib/glossary/ensure-terms')
    const result = await ensureConfirmedTermsExist(fakeSupabase() as never, 'p1', ['kaputt', 'geht'])
    // Der fehlgeschlagene darf den anderen nicht mitnehmen …
    expect(result.generatedSlugs).toEqual(['geht'])
    // … und bleibt vorgemerkt, damit ein zweiter Versuch möglich ist.
    expect(result.pendingRemainder?.map((c) => c.slug)).toEqual(['kaputt'])
  })
})

describe('findMissingFromGlossary', () => {
  // Betreiber-Befund 2026-08-06: estimateTotal (jobs/service.ts) vertraute
  // bisher blind dem needsGeneration-Flag der Kandidatenliste, ohne gegen den
  // AKTUELLEN Bestand zu prüfen — das Panel zeigte "30 von 37", obwohl zuletzt
  // nur EIN Begriff wirklich fehlte. Diese Funktion ist die frische Prüfung,
  // die generateMissingTerms schon immer machte, jetzt geteilt.
  it('behält nur Kandidaten, die es in glossary_terms noch NICHT gibt', async () => {
    state.existingSlugs = [{ slug: 'b' }]
    const { findMissingFromGlossary } = await import('@/lib/glossary/ensure-terms')
    const result = await findMissingFromGlossary(
      fakeSupabase() as never,
      [pending('a', 'A'), pending('b', 'B'), pending('c', 'C')],
    )
    expect(result?.map((c) => c.slug)).toEqual(['a', 'c'])
  })

  it('liefert eine leere Liste ohne DB-Zugriff, wenn keine Kandidaten übergeben werden', async () => {
    const calls: string[] = []
    const client = { from: (t: string) => { calls.push(t); return { select: () => ({ in: () => ({}) }) } } }
    const { findMissingFromGlossary } = await import('@/lib/glossary/ensure-terms')
    const result = await findMissingFromGlossary(client as never, [])
    expect(result).toEqual([])
    expect(calls).toEqual([])
  })

  it('liefert null bei einem Lesefehler, nicht eine leere Liste (Unterschied ist fürs Aufrufverhalten wichtig)', async () => {
    const client = {
      from: () => ({
        select: () => ({ in: () => ({ then: (res: (v: unknown) => void) => res({ data: null, error: { message: 'kaputt' } }) }) }),
      }),
    }
    const { findMissingFromGlossary } = await import('@/lib/glossary/ensure-terms')
    const result = await findMissingFromGlossary(client as never, [pending('a', 'A')])
    expect(result).toBeNull()
  })
})
