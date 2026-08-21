/**
 * Statistik der Uebersetzungs-Warteschlange: zaehlt sie ueber das stille
 * 1000er-Cap von PostgREST hinaus?
 *
 * PROD-BEFUND 2026-08-21: translation_queue hatte 1017 Zeilen. Die
 * Statistik-Abfrage lief ohne range(), PostgREST lieferte kommentarlos die
 * ersten 1000 — darin ausschliesslich completed und cancelled. Ergebnis:
 * stats.pending war 0, obwohl 2 Eintraege pending und einer processing war.
 * Weil der Knopf "Queue verarbeiten" als disabled={!stats.pending} haengt, war
 * er ausgegraut: die Warteschlange liess sich von Hand nicht mehr anstossen,
 * waehrend die Liste DARUNTER die pending-Eintraege korrekt anzeigte (sie
 * paginiert mit range()).
 *
 * Dasselbe Cap hat am 2026-08-19 schon den Newsletter-Versand getroffen.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn(), getSession: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }))

/** 1017 Zeilen wie in Produktion: die 2 pending stehen am ENDE, also jenseits
 *  der ersten 1000 — genau die Konstellation, die den Fehler ausloest. */
const ALL = [
  ...Array.from({ length: 843 }, () => ({ status: 'completed', target_language: 'en' })),
  ...Array.from({ length: 172 }, () => ({ status: 'cancelled', target_language: 'fr' })),
  { status: 'pending', target_language: 'cs' },
  { status: 'pending', target_language: 'fr' },
]

beforeEach(() => {
  mocks.getSession.mockResolvedValue({ user: 'admin' })
  mocks.from.mockReset()
  mocks.from.mockImplementation(() => {
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      order: vi.fn(() => chain),
      // Ohne range(): PostgREST kappt still bei 1000 — genau das bildet der Fake nach.
      then: (resolve: (v: unknown) => void) => resolve({ data: ALL.slice(0, 1000), error: null, count: ALL.length }),
      range: vi.fn((from: number, to: number) =>
        Promise.resolve({ data: ALL.slice(from, to + 1), error: null, count: ALL.length })),
    }
    return chain
  })
})

describe('GET /api/admin/translations — Statistik', () => {
  it('zaehlt pending auch jenseits der ersten 1000 Zeilen', async () => {
    const { GET } = await import('@/app/api/admin/translations/route')
    const res = await GET(new Request('https://x/api/admin/translations') as never)
    const body = await res.json()
    expect(body.stats.pending).toBe(2)
  })

  it('zaehlt die uebrigen Status vollstaendig', async () => {
    const { GET } = await import('@/app/api/admin/translations/route')
    const body = await (await GET(new Request('https://x/api/admin/translations') as never)).json()
    expect(body.stats.completed).toBe(843)
    expect(body.stats.cancelled).toBe(172)
  })
})
