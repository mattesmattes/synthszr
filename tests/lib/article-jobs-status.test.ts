/**
 * getArticleJobStatus — der Fortschritt, den der Editor während der Generierung
 * pollt ("Schreibe & lektoriere Abschnitt X von Y").
 *
 * `cursor` zählt WRITE UNITS: buildBundleWriteUnits fasst alle Items mit
 * bundle_type='topic' zu EINER Sektion zusammen und alle 'recap' ebenfalls
 * (Artikel-Bündelung, live seit 2026-07-18). `total` meldete dagegen die Zahl der
 * ITEMS. Bei aktiven Bündeln kann die Anzeige ihr Ziel damit nie erreichen —
 * sie bleibt z.B. bei "7 von 10" stehen, obwohl die Schreibphase vollständig
 * durchgelaufen ist, und sieht wie ein Abbruch aus.
 *
 * Das ist genau die Fehlspur, die bei Befund B (2026-08-04) fast zu einem Fix am
 * falschen Ort geführt hätte: der Ledger nannte "35 von 38 Abschnitten" als
 * Beweis für eine abgebrochene Schreibphase. Bei jenem Job hatten zufällig alle
 * Items bundle_type='normal', dort war die Anzeige also korrekt — aber die
 * Verwechslungsgefahr ist real und kostete eine Diagnoserunde.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ job: null as Record<string, unknown> | null }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) chain[m] = () => chain
      chain.maybeSingle = async () => ({ data: state.job, error: null })
      return chain
    },
  }),
}))

/** Items wie sie in article_jobs.selected_items liegen. */
function items(spec: Array<'normal' | 'topic' | 'recap'>) {
  return spec.map((bundle_type, i) => ({
    id: `item-${i + 1}`,
    title: `Titel ${i + 1}`,
    content: 'x',
    bundle_type: bundle_type === 'normal' ? null : bundle_type,
  }))
}

/** Plan mit 1-basiertem ordering über alle Items. */
function plan(n: number) {
  const headings: Record<string, string> = {}
  for (let i = 1; i <= n; i++) headings[String(i)] = `Heading ${i}`
  return { ordering: Array.from({ length: n }, (_, i) => i + 1), headings }
}

beforeEach(() => { state.job = null })

describe('getArticleJobStatus — total', () => {
  it('meldet bei aktiven Bündeln die Zahl der SEKTIONEN, nicht der Items', async () => {
    // 3 topic + 2 recap + 5 normal = 10 Items, aber 8 Sektionen:
    // 1 topic-Buendel + 1 Einzelfassung dazu + 1 recap-Buendel + 5 normale.
    // Die Einzelfassung kam am 2026-08-14 dazu (Betreiber-Vorgabe): Zu jedem
    // Thema und Deep Dive steht dieselbe Meldung zusaetzlich im gewoehnlichen
    // Format bereit, damit der Autor waehlen kann. Die Nachlese bekommt keine.
    state.job = {
      id: 'j1', status: 'processing', phase: 'writing', cursor: 7,
      selected_items: items(['topic', 'topic', 'topic', 'recap', 'recap', 'normal', 'normal', 'normal', 'normal', 'normal']),
      plan: plan(10),
      generated_post_id: null,
    }
    const { getArticleJobStatus } = await import('@/lib/article-jobs/service')
    const status = await getArticleJobStatus('j1')
    // Ohne den Fix wäre total 10 und der Fortschritt bliebe bei "7 von 10"
    // stehen, obwohl cursor === units.length die Phase abgeschlossen hat.
    expect(status?.total).toBe(8)
    expect(status?.cursor).toBe(7)
  })

  it('meldet ohne Bündel weiterhin die Item-Anzahl', async () => {
    state.job = {
      id: 'j2', status: 'processing', phase: 'writing', cursor: 4,
      selected_items: items(['normal', 'normal', 'normal', 'normal', 'normal']),
      plan: plan(5),
      generated_post_id: null,
    }
    const { getArticleJobStatus } = await import('@/lib/article-jobs/service')
    expect((await getArticleJobStatus('j2'))?.total).toBe(5)
  })

  it('fällt in der planning-Phase (noch kein Plan) auf die Item-Anzahl zurück', async () => {
    // Vor dem Planen sind die Write-Units nicht bestimmbar; die Item-Anzahl ist
    // dort die einzige verfügbare Schätzung und besser als 0.
    state.job = {
      id: 'j3', status: 'pending', phase: 'planning', cursor: 0,
      selected_items: items(['topic', 'topic', 'normal']),
      plan: null,
      generated_post_id: null,
    }
    const { getArticleJobStatus } = await import('@/lib/article-jobs/service')
    expect((await getArticleJobStatus('j3'))?.total).toBe(3)
  })

  it('liefert 0 statt zu werfen, wenn selected_items fehlt', async () => {
    state.job = { id: 'j4', status: 'pending', phase: 'planning', cursor: 0, plan: null, generated_post_id: null }
    const { getArticleJobStatus } = await import('@/lib/article-jobs/service')
    expect((await getArticleJobStatus('j4'))?.total).toBe(0)
  })
})
