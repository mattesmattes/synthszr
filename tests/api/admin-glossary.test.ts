/**
 * Admin-API fürs Fachbegriff-Lexikon (app/api/admin/glossary/route.ts, Task 17).
 * Deckt die beiden Fix-Runde-1-Findings ab, die diese Route betreffen:
 *
 * - Important 1: `accept_revision`/`discard_revision` müssen `last_reviewed_at`
 *   fortschreiben, sonst bleibt der Begriff an der Spitze der Cron-Sortierung
 *   (review.ts) und derselbe (ggf. abgelehnte) Vorschlag wird täglich neu
 *   erzeugt und der Redaktion erneut vorgelegt.
 * - Important 4: jede Aktion, die ändert, was die Detailseite serviert, muss
 *   auch die A-Z-Indexseite revalidieren (app/[lang]/glossary/page.tsx,
 *   revalidate=3600), nicht nur den Detailpfad.
 *
 * Auth (401 ohne Session) und der Grundfluss der übrigen Methoden waren schon
 * im ursprünglichen Review bestätigt — dieser Test fokussiert auf das, was
 * sich in der Fix-Runde geändert hat, plus einer schlanken Auth-Absicherung,
 * damit die Datei für sich lauffähig und lesbar bleibt.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ email: 'admin@test' }) as { email: string } | null),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

// Tabellen-bewusster PostgREST-Stub mit FIFO-Antwortqueue pro Tabelle (Muster
// aus tests/api/glossary-inject-on-save.test.ts) — chain.then() bedient ein
// direktes `await chain`, chain.maybeSingle() den Einzelzeilen-Read.
const state = vi.hoisted(() => ({
  queues: {} as Record<string, unknown[]>,
  chains: [] as any[],
}))

function makeChain(table: string) {
  const chain: any = { table }
  for (const m of ['select', 'eq', 'update', 'delete']) {
    chain[m] = vi.fn(() => chain)
  }
  const resolve = () => {
    const q = state.queues[table]
    return q && q.length ? q.shift() : { data: null, error: null }
  }
  chain.maybeSingle = vi.fn(async () => resolve())
  chain.then = (res: (v: unknown) => void) => res(resolve())
  state.chains.push(chain)
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (table: string) => makeChain(table) }),
}))

/** Findet den ersten update()-Aufruf auf glossary_terms und liefert dessen Payload. */
function lastUpdatePayload(): Record<string, unknown> {
  const chain = state.chains.find((c) => c.table === 'glossary_terms' && c.update.mock.calls.length > 0)
  return chain.update.mock.calls[0][0] as Record<string, unknown>
}

function patchReq(body: unknown) {
  return new Request('http://localhost/api/admin/glossary', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deleteReq(body: unknown) {
  return new Request('http://localhost/api/admin/glossary', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.queues = {}
  state.chains = []
  mocks.getSession.mockReset()
  mocks.getSession.mockResolvedValue({ email: 'admin@test' })
  mocks.revalidatePath.mockReset()
})

describe('Auth', () => {
  it('PATCH ohne Session gibt 401 zurück', async () => {
    mocks.getSession.mockResolvedValue(null)
    const { PATCH } = await import('@/app/api/admin/glossary/route')
    const res = await PATCH(patchReq({ slug: 'inferenz', action: 'hide' }) as any)
    expect(res.status).toBe(401)
  })

  it('DELETE ohne Session gibt 401 zurück', async () => {
    mocks.getSession.mockResolvedValue(null)
    const { DELETE } = await import('@/app/api/admin/glossary/route')
    const res = await DELETE(deleteReq({ slug: 'inferenz' }) as any)
    expect(res.status).toBe(401)
  })
})

describe('PATCH accept_revision / discard_revision — Important 1 (last_reviewed_at)', () => {
  it('accept_revision setzt last_reviewed_at zusätzlich zu body/pending_body/review_state', async () => {
    state.queues['glossary_terms'] = [
      { data: { pending_body: { type: 'doc', content: [] } }, error: null }, // Read
      { error: null }, // Update
    ]
    const { PATCH } = await import('@/app/api/admin/glossary/route')
    const res = await PATCH(patchReq({ slug: 'inferenz', action: 'accept_revision' }) as any)
    expect(res.status).toBe(200)

    const payload = lastUpdatePayload()
    expect(payload.review_state).toBe('ok')
    expect(payload.pending_body).toBeNull()
    expect(typeof payload.last_reviewed_at).toBe('string')
  })

  it('discard_revision setzt last_reviewed_at, obwohl body unverändert bleibt (Regressionstest Important 1)', async () => {
    // Vor dem Fix schrieb discard_revision nur { pending_body: null,
    // review_state: 'ok' } — last_reviewed_at blieb unverändert, der Begriff
    // stand danach unverändert an der Spitze der Cron-Sortierung und hätte
    // denselben abgelehnten Vorschlag am nächsten Tag erneut erzeugt.
    state.queues['glossary_terms'] = [
      { data: { pending_body: { type: 'doc', content: [] } }, error: null }, // Read
      { error: null }, // Update
    ]
    const { PATCH } = await import('@/app/api/admin/glossary/route')
    const res = await PATCH(patchReq({ slug: 'inferenz', action: 'discard_revision' }) as any)
    expect(res.status).toBe(200)

    const payload = lastUpdatePayload()
    expect(payload.review_state).toBe('ok')
    expect(payload.pending_body).toBeNull()
    expect(payload).not.toHaveProperty('body')
    expect(typeof payload.last_reviewed_at).toBe('string')
  })
})

describe('Revalidierung — Important 4 (Index-Seite mitrevalidieren)', () => {
  it('accept_revision revalidiert Detail- UND Index-Pfade in beiden Sprachen', async () => {
    state.queues['glossary_terms'] = [
      { data: { pending_body: { type: 'doc', content: [] } }, error: null },
      { error: null },
    ]
    const { PATCH } = await import('@/app/api/admin/glossary/route')
    await PATCH(patchReq({ slug: 'inferenz', action: 'accept_revision' }) as any)

    const paths = mocks.revalidatePath.mock.calls.map((c) => c[0])
    expect(paths).toEqual(expect.arrayContaining([
      '/de/glossary/inferenz', '/en/glossary/inferenz', '/de/glossary', '/en/glossary',
    ]))
  })

  it('hide revalidiert auch die Index-Seite (nicht nur den Detailpfad)', async () => {
    state.queues['glossary_terms'] = [{ error: null }]
    const { PATCH } = await import('@/app/api/admin/glossary/route')
    await PATCH(patchReq({ slug: 'inferenz', action: 'hide' }) as any)

    const paths = mocks.revalidatePath.mock.calls.map((c) => c[0])
    expect(paths).toEqual(expect.arrayContaining(['/de/glossary', '/en/glossary']))
  })

  it('DELETE revalidiert Detail- und Index-Pfade', async () => {
    state.queues['glossary_terms'] = [{ error: null }]
    const { DELETE } = await import('@/app/api/admin/glossary/route')
    await DELETE(deleteReq({ slug: 'inferenz' }) as any)

    const paths = mocks.revalidatePath.mock.calls.map((c) => c[0])
    expect(paths).toEqual(expect.arrayContaining([
      '/de/glossary/inferenz', '/en/glossary/inferenz', '/de/glossary', '/en/glossary',
    ]))
  })

  it('discard_revision revalidiert NICHT (Live-Text ändert sich nicht)', async () => {
    state.queues['glossary_terms'] = [
      { data: { pending_body: { type: 'doc', content: [] } }, error: null },
      { error: null },
    ]
    const { PATCH } = await import('@/app/api/admin/glossary/route')
    await PATCH(patchReq({ slug: 'inferenz', action: 'discard_revision' }) as any)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
