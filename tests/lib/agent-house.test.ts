/**
 * Hausagenten (Konzept 2026-10-29, Welle 1.1): eigene Agenten mit klarer
 * Haltung, die taeglich den Feed lesen und Takes schreiben. Geprueft wird die
 * Auswahl der geplanten Takes (Anker gueltig, Laenge, ein Take je Abschnitt,
 * Obergrenze) und der Lauf mit injizierten Abhaengigkeiten.
 */
import { describe, expect, it, vi } from 'vitest'
import { selectPlannedTakes, runHouseAgent, HOUSE_SETTINGS_KEY } from '@/lib/agents/house'
import type { FeedArticle } from '@/lib/agents/feed'

const ARTICLE: FeedArticle = {
  postId: '11111111-2222-3333-4444-555555555555', lang: 'de', title: 'T', url: 'u', publishedAt: '2026-10-29T05:00:00Z',
  sections: [
    { sectionAnchor: 'q1', headline: 'A', report: 'a', take: 'ta', agentTakes: 0 },
    { sectionAnchor: 'q2', headline: 'B', report: 'b', take: 'tb', agentTakes: 5 },
    { sectionAnchor: 'q3', headline: 'C', report: 'c', take: 'tc', agentTakes: 1 },
  ],
}
const body = (n: number) => 'x'.repeat(n)

describe('selectPlannedTakes', () => {
  it('nimmt nur gueltige Anker mit Platz, passende Laenge, einen je Abschnitt, hoechstens max', () => {
    const raw = { takes: [
      { sectionAnchor: 'q1', stance: 'disagree', body: body(300), sources: [] },
      { sectionAnchor: 'q1', stance: 'agree', body: body(300) },           // zweiter zu q1 → weg
      { sectionAnchor: 'q2', stance: 'nuance', body: body(300) },          // Abschnitt voll → weg
      { sectionAnchor: 'q9', stance: 'nuance', body: body(300) },          // unbekannt → weg
      { sectionAnchor: 'q3', stance: 'nuance', body: body(100) },          // zu kurz → weg
      { sectionAnchor: 'q3', stance: 'agree', body: body(1500) },          // zu lang → weg
      { sectionAnchor: 'q3', stance: 'invalid', body: body(300) },         // Haltung ungueltig → weg
      { sectionAnchor: 'q3', stance: 'agree', body: body(400), sources: [{ url: 'http://x.de', title: 't' }, { url: 'https://ok.de', title: 'ok' }] },
    ] }
    const out = selectPlannedTakes(raw, ARTICLE, 5)
    expect(out.map((t) => t.sectionAnchor)).toEqual(['q1', 'q3'])
    expect(out[1].sources).toEqual([{ url: 'https://ok.de', title: 'ok' }])
    expect(selectPlannedTakes(raw, ARTICLE, 1)).toHaveLength(1)
  })

  it('liefert leer bei Unsinn', () => {
    expect(selectPlannedTakes(null, ARTICLE, 3)).toEqual([])
    expect(selectPlannedTakes({ takes: 'nein' }, ARTICLE, 3)).toEqual([])
  })
})

describe('runHouseAgent', () => {
  const agent = { handle: 'argus', api_key: 'sk_agent_x', persona: 'Skeptiker', langs: ['de' as const], max_takes_per_day: 2 }
  const account = { id: 'a1', handle: 'argus', display_name: 'Argus', description: 'd', model: 'm', owner_handle: 'synthszr', status: 'active' as const, created_at: '2026-10-01T00:00:00Z' }

  it('plant je Artikel, reicht ein, stoppt an der Tagesgrenze', async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, status: 'published', holdReason: null, id: 'c' })
    const plan = vi.fn().mockResolvedValue([
      { sectionAnchor: 'q1', stance: 'disagree', body: body(300), sources: [] },
      { sectionAnchor: 'q3', stance: 'agree', body: body(300), sources: [] },
    ])
    const r = await runHouseAgent({} as never, agent, {
      now: new Date('2026-10-29T06:30:00Z'),
      authenticate: async () => account,
      feed: async () => [ARTICLE, { ...ARTICLE, postId: '22222222-2222-3333-4444-555555555555' }],
      plan, submit,
      settings: { enabled: true, daily_cap: 50, relevance_min: 0.55, paraphrase_max: 0.92, per_section_max: 5, feed_since: '2026-10-26' },
    })
    expect(submit).toHaveBeenCalledTimes(2)           // max_takes_per_day
    expect(plan).toHaveBeenCalledTimes(1)             // zweiter Artikel nicht mehr geplant
    expect(r).toMatchObject({ handle: 'argus', planned: 2, submitted: 2, published: 2, pending: 0 })
  })

  it('bricht ab, wenn der Schluessel ungueltig ist oder das Konto gesperrt', async () => {
    const submit = vi.fn()
    const r1 = await runHouseAgent({} as never, agent, { now: new Date(), authenticate: async () => null, feed: async () => [ARTICLE], plan: async () => [], submit, settings: { enabled: true, daily_cap: 50, relevance_min: 0.55, paraphrase_max: 0.92, per_section_max: 5, feed_since: '2026-10-26' } })
    expect(r1.error).toBe('unauthorized')
    const r2 = await runHouseAgent({} as never, agent, { now: new Date(), authenticate: async () => ({ ...account, status: 'suspended' }), feed: async () => [ARTICLE], plan: async () => [], submit, settings: { enabled: true, daily_cap: 50, relevance_min: 0.55, paraphrase_max: 0.92, per_section_max: 5, feed_since: '2026-10-26' } })
    expect(r2.error).toBe('suspended')
    expect(submit).not.toHaveBeenCalled()
  })

  it('zaehlt wartende und abgelehnte Takes getrennt und laeuft weiter', async () => {
    const submit = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 'pending', holdReason: 'relevance', id: 'c1' })
      .mockResolvedValueOnce({ ok: false, error: 'duplicate' })
    const r = await runHouseAgent({} as never, agent, {
      now: new Date(), authenticate: async () => account, feed: async () => [ARTICLE],
      plan: async () => [{ sectionAnchor: 'q1', stance: 'disagree', body: body(300), sources: [] }, { sectionAnchor: 'q3', stance: 'agree', body: body(300), sources: [] }],
      submit, settings: { enabled: true, daily_cap: 50, relevance_min: 0.55, paraphrase_max: 0.92, per_section_max: 5, feed_since: '2026-10-26' },
    })
    expect(r).toMatchObject({ submitted: 2, published: 0, pending: 1, rejected: 1 })
  })
})

describe('HOUSE_SETTINGS_KEY', () => {
  it('ist agent_house', () => { expect(HOUSE_SETTINGS_KEY).toBe('agent_house') })
})
