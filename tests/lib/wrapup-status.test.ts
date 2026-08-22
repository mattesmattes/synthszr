/**
 * Sichtbarkeit des Sonntags-Rueckblicks.
 *
 * PROD-BEFUND 2026-08-22: Der Cron /api/cron/week-wrapup ist bei Vercel
 * registriert und lief am Sonntag 2026-08-16 — trotzdem gab es KEINEN einzigen
 * Rueckblick in der Datenbank, obwohl die Woche 6 Themen hergab. Warum der Lauf
 * scheiterte, liess sich nicht mehr feststellen: die Route gibt in JEDEM Fall
 * 200 zurueck (damit Vercel eine themenlose Woche nicht als Ausfall fuehrt),
 * und das Log war laengst rotiert. Es gab keinen Ort, an dem "Rueckblick fehlt"
 * sichtbar geworden waere.
 *
 * getWrapupStatus macht genau diesen Zustand pruefbar. Der springende Punkt ist
 * die Unterscheidung zwischen "fehlt, obwohl Material da war" (Stoerung) und
 * "keine Themen" (normaler Betriebsfall, z. B. Urlaubswoche).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn(), collect: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/wrapup/collect', () => ({ collectWeekTopics: mocks.collect }))

/** Fake-PostgREST: liefert fuer die Slug-Suche die uebergebenen Zeilen. */
function fakePosts(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    like: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  }
  mocks.from.mockReturnValue(chain)
}

beforeEach(() => {
  mocks.from.mockReset()
  mocks.collect.mockReset()
})

describe('getWrapupStatus', () => {
  it('meldet "fehlt", wenn kein Rueckblick da ist OBWOHL die Woche Themen hergab', async () => {
    // Genau der Fall vom 2026-08-16: 6 Themen, kein Entwurf, keine Meldung.
    fakePosts([])
    mocks.collect.mockResolvedValue([{ weekday: 'Montag' }, { weekday: 'Dienstag' }])
    const { getWrapupStatus } = await import('@/lib/wrapup/status')
    const s = await getWrapupStatus({ from: mocks.from } as never)
    expect(s.verdict).toBe('fehlt')
    expect(s.topicCount).toBe(2)
    expect(s.post).toBeNull()
  })

  it('meldet "keine_themen" statt eines Alarms, wenn die Woche leer war', async () => {
    fakePosts([])
    mocks.collect.mockResolvedValue([])
    const { getWrapupStatus } = await import('@/lib/wrapup/status')
    expect((await getWrapupStatus({ from: mocks.from } as never)).verdict).toBe('keine_themen')
  })

  it('meldet "vorhanden" samt Entwurfsstatus, wenn der Rueckblick existiert', async () => {
    fakePosts([{ id: 'p1', slug: 'ai-week-wrap-up-2026-08-17', status: 'draft', created_at: '2026-08-23T06:00:00Z' }])
    mocks.collect.mockResolvedValue([{ weekday: 'Montag' }])
    const { getWrapupStatus } = await import('@/lib/wrapup/status')
    const s = await getWrapupStatus({ from: mocks.from } as never)
    expect(s.verdict).toBe('vorhanden')
    expect(s.post?.status).toBe('draft')
  })

  it('nennt die Woche, damit die Anzeige nicht raten muss', async () => {
    fakePosts([])
    mocks.collect.mockResolvedValue([])
    const { getWrapupStatus } = await import('@/lib/wrapup/status')
    const s = await getWrapupStatus({ from: mocks.from } as never)
    expect(s.weekLabel).toMatch(/\d{4}/)
    expect(s.slugBase).toMatch(/^ai-week-wrap-up-\d{4}-\d{2}-\d{2}$/)
  })
})
