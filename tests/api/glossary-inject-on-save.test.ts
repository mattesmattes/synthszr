/**
 * PATCH /api/admin/generated-posts mit confirmedGlossarySlugs (Task 11):
 * Wiring-Test — prüft, dass die Route die Freigabe-Entscheidung erkennt, das
 * Ergebnis in den DB-Update übernimmt und pending_glossary_terms leert.
 *
 * Die eigentliche Injektions-/Freigabe-Logik (hidden-Ausschluss, Content-
 * Fallback, Parse-/Publish-Fehler, reservierte Namen) ist ausführlicher und
 * lesbarer in tests/lib/glossary-confirm.test.ts abgedeckt — hier reicht der
 * Nachweis, dass die Route sie korrekt verdrahtet.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(() => Promise.resolve({ email: 'admin@test' })),
  getMatcherTerms: vi.fn(() => Promise.resolve([
    { slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] },
  ])),
  getChartProductNames: vi.fn(() => Promise.resolve([] as string[])),
  generateAndInsertDraft: vi.fn(),
  createOrGetJob: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }))
// Die teure Begriffs-Erzeugung wird gemockt, ensure-terms läuft ECHT — der Test
// prüft damit die tatsächliche Verdrahtung der Route (Erzeugen VOR Freigeben),
// nicht das Verhalten eines Mocks.
vi.mock('@/lib/glossary/draft-writer', () => ({
  generateAndInsertDraft: mocks.generateAndInsertDraft,
}))
// Seit 2026-08-06 erzeugt die Route selbst keine Begriffe mehr synchron —
// sie legt nur noch einen 'pending'-Job an. createOrGetJob als Blackbox
// gemockt (kein .insert()/.single() im Fake-Client unten, s. makeChain).
vi.mock('@/lib/glossary/jobs/service', () => ({
  createOrGetJob: mocks.createOrGetJob,
}))
// buildReservedNames bleibt die ECHTE Implementierung (importOriginal) — pur,
// seit Fix-Runde 1 (Task 16) mit reinjectGlossaryMarksForTranslation geteilt
// statt in confirm.ts dupliziert.
vi.mock('@/lib/glossary/terms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/glossary/terms')>()
  return {
    ...actual,
    getMatcherTerms: mocks.getMatcherTerms,
    getChartProductNames: mocks.getChartProductNames,
  }
})

// Tabellen-bewusster PostgREST-Stub: jede Tabelle bekommt ihre eigene FIFO-
// Antwortqueue, jeder Filter bleibt ein vi.fn() für Aufruf-Assertions (Muster
// aus tests/lib/glossary-terms.test.ts / tests/lib/newsletter-access-tokens.test.ts,
// hier um Tabellen-Trennung erweitert, weil diese Route mehrere Tabellen trifft).
const state = vi.hoisted(() => ({
  queues: {} as Record<string, unknown[]>,
  chains: [] as any[],
}))

function makeChain(table: string) {
  const chain: any = { table }
  for (const m of ['select', 'eq', 'in', 'update']) {
    chain[m] = vi.fn(() => chain)
  }
  const resolve = () => {
    const q = state.queues[table]
    return q && q.length ? q.shift() : { data: null, error: null }
  }
  chain.single = vi.fn(async () => resolve())
  // ensureConfirmedTermsExist lädt die Kandidatenliste mit .maybeSingle().
  chain.maybeSingle = vi.fn(async () => resolve())
  chain.then = (res: (v: unknown) => void) => res(resolve())
  state.chains.push(chain)
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (table: string) => makeChain(table) }),
}))

function patch(body: unknown) {
  return new Request('http://localhost/api/admin/generated-posts', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function doc(text: string) {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })
}

/** Findet die Chain des finalen generated_posts-Updates (nicht den optionalen
 *  Content-Fallback-Fetch, der ebenfalls über from('generated_posts') läuft). */
function finalUpdate() {
  const chain = state.chains.find(
    (c) => c.table === 'generated_posts' && c.update.mock.calls.length > 0,
  )
  return chain.update.mock.calls[0][0] as Record<string, unknown>
}

beforeEach(() => {
  state.queues = {}
  state.chains.length = 0
  mocks.getMatcherTerms.mockClear()
  mocks.getChartProductNames.mockClear()
  mocks.generateAndInsertDraft.mockReset()
  mocks.generateAndInsertDraft.mockImplementation(async (_sb: unknown, name: string, slug: string) => ({
    slug, canonicalName: name, aliases: [], summary: `Kurzfassung von ${name}.`,
  }))
  mocks.createOrGetJob.mockReset()
  mocks.createOrGetJob.mockResolvedValue({ id: 'job1', kind: 'pending', status: 'pending' })
})

describe('PATCH /api/admin/generated-posts mit Glossar-Slugs', () => {
  it('schreibt eine glossaryLink-Mark in den gespeicherten Content', async () => {
    state.queues = {
      glossary_terms: [
        { error: null }, // publish-Update
        { data: [{ slug: 'inferenz' }], error: null }, // Status-Check
      ],
    }
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    await PATCH(patch({
      id: 'p1',
      content: doc('Die Inferenz ist teuer.'),
      confirmedGlossarySlugs: ['inferenz'],
    }) as never)

    const saved = finalUpdate()
    expect(saved.content).toContain('glossaryLink')
    expect(saved.content).toContain('inferenz')
  })

  it('speichert unverändert, wenn keine Slugs übergeben werden', async () => {
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    await PATCH(patch({ id: 'p1', title: 'Neu' }) as never)

    const saved = finalUpdate()
    expect(saved.content ?? '').not.toContain('glossaryLink')
    expect(saved.pending_glossary_terms).toBeUndefined()
    expect(mocks.getMatcherTerms).not.toHaveBeenCalled()
  })

  it('leert pending_glossary_terms nach der Freigabe', async () => {
    state.queues = {
      glossary_terms: [
        { error: null },
        { data: [{ slug: 'inferenz' }], error: null },
      ],
    }
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    await PATCH(patch({
      id: 'p1',
      content: doc('Die Inferenz ist teuer.'),
      confirmedGlossarySlugs: ['inferenz'],
    }) as never)

    expect(finalUpdate().pending_glossary_terms).toBeNull()
  })

  it('ruft beim Speichern keine synchrone Begriffs-Erzeugung mehr auf, veröffentlicht aber bereits existierende bestätigte Begriffe', async () => {
    // Umbau 2026-08-06: die Erzeugung fehlender Begriffe lief bis heute
    // SYNCHRON im Speicherpfad (bis zu MAX_GENERATE_PER_SAVE=3 Begriffe à
    // 45-90s, macht bis zu 270s direkt am 300s-Limit der Function — haengender
    // Speichern-Knopf, im schlechten Fall ein 504). generateAndInsertDraft darf
    // von dieser Route ab jetzt UNTER KEINEN UMSTÄNDEN mehr direkt aufgerufen
    // werden — das ist jetzt Aufgabe des servergetriebenen 'pending'-Jobs.
    state.queues = {
      // Meine neue Pruefung "braucht irgendein bestaetigter Slug noch eine
      // Erzeugung?" liest die Vormerkliste — hier leer: 'inferenz' existiert
      // schon als Draft, es gibt nichts zu erzeugen.
      generated_posts: [{ data: { pending_glossary_terms: null }, error: null }],
      glossary_terms: [
        { error: null },                                    // publish-Update
        { data: [{ slug: 'inferenz' }], error: null },       // Status-Check
      ],
    }
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    await PATCH(patch({
      id: 'p1',
      content: doc('Die Inferenz ist teuer.'),
      confirmedGlossarySlugs: ['inferenz'],
    }) as never)

    expect(mocks.generateAndInsertDraft).not.toHaveBeenCalled()
    // Nichts musste erzeugt werden → auch kein Job noetig (gleiche Regel wie
    // openCount im Freigabe-Panel, glossary-approval-panel.tsx:74).
    expect(mocks.createOrGetJob).not.toHaveBeenCalled()
    // Trotzdem weiterhin veroeffentlicht und verlinkt — genau das verspricht
    // der Panel-Text: "Bestätigte Begriffe werden beim Speichern
    // veröffentlicht und im Artikeltext verlinkt."
    const saved = finalUpdate()
    expect(saved.content).toContain('glossaryLink')
    expect(saved.pending_glossary_terms).toBeNull()
  })

  it('legt bei einem bestätigten, noch nicht existierenden Begriff einen pending-Job an, statt ihn synchron zu erzeugen', async () => {
    state.queues = {
      generated_posts: [{
        data: { pending_glossary_terms: [{
          slug: 'speculative-decoding', name: 'Speculative Decoding', origin: 'new',
          matchedText: null, isNewlyGenerated: false, needsGeneration: true,
        }] },
        error: null,
      }],
    }
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    await PATCH(patch({
      id: 'p1',
      content: doc('Speculative Decoding beschleunigt die Ausgabe.'),
      confirmedGlossarySlugs: ['speculative-decoding'],
    }) as never)

    expect(mocks.generateAndInsertDraft).not.toHaveBeenCalled()
    expect(mocks.createOrGetJob).toHaveBeenCalledWith(
      expect.anything(), 'pending', { postId: 'p1', confirmedSlugs: ['speculative-decoding'] },
    )
    // Der Begriff existiert noch nicht → applyGlossaryConfirmation kann nichts
    // veröffentlichen, der Content bleibt ohne Mark.
    const saved = finalUpdate()
    expect(saved.content ?? '').not.toContain('glossaryLink')
  })

  it('lässt pending_glossary_terms unangetastet, wenn EIN bestätigter Begriff schon veröffentlicht wird, ein ANDERER aber noch erzeugt werden muss', async () => {
    // Der Kern des Auftrags: die Vormerkliste darf NICHT verfrüht geleert
    // werden — sonst verschwindet der Kandidat, ohne je erzeugt worden zu
    // sein. Nur runPendingUnit darf sie leeren, und nur wenn AUSNAHMSLOS ALLE
    // bestätigten Slugs tatsächlich veröffentlicht sind (pending-run.ts).
    //
    // Gemischtes Szenario mit Absicht: 'inferenz' existiert schon und WIRD
    // hier erfolgreich veröffentlicht (publishedSlugs.length > 0) —
    // trotzdem darf die Liste nicht geleert werden, weil 'speculative-
    // decoding' noch offen ist. Ein Test mit nur einem offenen Kandidaten
    // würde nicht zeigen, dass die Entscheidung an "irgendein bestätigter
    // Slug braucht noch Erzeugung" hängt und NICHT an "publishedSlugs leer".
    state.queues = {
      generated_posts: [{
        data: { pending_glossary_terms: [{
          slug: 'speculative-decoding', name: 'Speculative Decoding', origin: 'new',
          matchedText: null, isNewlyGenerated: false, needsGeneration: true,
        }] },
        error: null,
      }],
      glossary_terms: [
        { error: null },                                // publish-Update (nur inferenz existiert als Draft)
        { data: [{ slug: 'inferenz' }], error: null },   // Status-Check: nur inferenz wirklich published
      ],
    }
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    await PATCH(patch({
      id: 'p1',
      content: doc('Die Inferenz und Speculative Decoding.'),
      confirmedGlossarySlugs: ['inferenz', 'speculative-decoding'],
    }) as never)

    const saved = finalUpdate()
    // inferenz wurde tatsaechlich veroeffentlicht+verlinkt ...
    expect(saved.content).toContain('glossaryLink')
    // ... trotzdem bleibt die Vormerkliste unangetastet. undefined, nicht
    // null: der Schlüssel darf im Update-Payload gar nicht erst auftauchen.
    expect(saved.pending_glossary_terms).toBeUndefined()
  })

  it('lässt pending_glossary_terms unangetastet, wenn die Freigabe komplett fehlschlägt', async () => {
    // Review-Fix: schlägt das Publish-Update fehl (z.B. DB kurz nicht
    // erreichbar), bleibt der Begriff draft — die Kandidatenliste darf dann
    // NICHT verschwinden, sonst hat der Admin keinen Weg mehr, die Freigabe
    // erneut anzustoßen, und der Begriff bleibt unauffindbar unveröffentlicht.
    state.queues = {
      glossary_terms: [
        { error: { message: 'db down' } }, // Publish-Update schlägt fehl
        { data: [], error: null }, // Status-Check: nichts wurde published
      ],
    }
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    await PATCH(patch({
      id: 'p1',
      content: doc('Die Inferenz ist teuer.'),
      confirmedGlossarySlugs: ['inferenz'],
    }) as never)

    const saved = finalUpdate()
    expect(saved.pending_glossary_terms).toBeUndefined()
    expect(saved.content).not.toContain('glossaryLink')
  })

  it('lädt den Content aus der DB nach, wenn der Body keinen mitschickt (Übersetzungs-/Backfill-Pfad)', async () => {
    state.queues = {
      glossary_terms: [
        { error: null },
        { data: [{ slug: 'inferenz' }], error: null },
      ],
      generated_posts: [
        // Reihenfolge seit dem Umbau 2026-08-06: applyGlossaryConfirmation
        // läuft ZUERST und lädt den Content selbst nach (kein content im
        // Body) — erst DANACH liest die Route pending_glossary_terms für die
        // needsGeneration-Prüfung. Ohne diesen Fallback-Eintrag zuerst griffe
        // sich die needsGeneration-Prüfung die falsche Antwort (FIFO pro
        // Tabelle).
        { data: { content: doc('Die Inferenz ist teuer.') }, error: null }, // Fallback-Fetch
        { data: { pending_glossary_terms: null }, error: null },
      ],
    }
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    await PATCH(patch({ id: 'p1', confirmedGlossarySlugs: ['inferenz'] }) as never)

    expect(finalUpdate().content).toContain('glossaryLink')
  })
})
