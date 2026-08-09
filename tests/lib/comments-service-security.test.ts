/**
 * Sicherheits-Verhalten des Kommentar-Service (Review 2026-08-09, Befunde 1/5/6).
 *
 * Zwei geschlossene Lücken:
 *  - MAIL-THROTTLE: Der Web-Flow darf nicht bei jedem Request eine
 *    Bestätigungsmail an eine bekannte Abo-Adresse auslösen — sonst wird der
 *    eigene Resend-Absender zum Belästigungswerkzeug gegen jeden Abonnenten.
 *  - TOKEN-BINDUNG: Ein Magic-Link veröffentlicht NUR den Kommentar, für den
 *    er ausgestellt wurde (verify_token_hash), nicht pauschal alle
 *    pending_verify desselben Abonnenten — sonst kann ein Angreifer fremde
 *    Kommentare unter der Identität eines Abonnenten unterschieben.
 *
 * Der Supabase-Client ist ein handgeschriebener Fake mit Query-Recorder — kein
 * echtes Netz. Getestet wird die Service-Logik, nicht PostgREST.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  moderate: vi.fn(),
  resolveToken: vi.fn(),
  hashToken: vi.fn((t: string) => `hash(${t})`),
}))

vi.mock('@/lib/comments/moderation', () => ({ moderateComment: mocks.moderate }))
vi.mock('@/lib/newsletter/access-tokens', () => ({
  resolveSubscriberToken: mocks.resolveToken,
  hashSubscriberToken: mocks.hashToken,
  mintSubscriberToken: (subscriberId: string, purpose: string, expiresAt: Date) => ({
    rawToken: 'RAW',
    row: { subscriber_id: subscriberId, purpose, token_hash: `hash(RAW)`, expires_at: expiresAt.toISOString() },
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => makeFakeClient() }))

// --- Minimaler Supabase-Fake: nur die Kette, die der Service nutzt. ---
let tables: Record<string, any[]>
let inserted: Record<string, any[]>
let updates: any[]

function makeFakeClient() {
  return {
    from(table: string) {
      const state: any = { table, filters: {} as Record<string, unknown>, _order: null, _limit: null }
      const api: any = {
        select() { return api },
        eq(col: string, val: unknown) { state.filters[col] = val; return api },
        order() { return api },
        limit() { return api },
        gt() { return api },
        is(col: string, _v: unknown) { state.filters[col] = '__null__'; return api },
        maybeSingle() {
          const rows = rowsFor(table, state.filters)
          return Promise.resolve({ data: rows[0] ?? null, error: null })
        },
        insert(payload: any) {
          const arr = Array.isArray(payload) ? payload : [payload]
          inserted[table] = (inserted[table] ?? []).concat(arr)
          ;(tables[table] = tables[table] ?? []).push(...arr)
          return Promise.resolve({ error: null })
        },
        update(patch: any) {
          const upd = { table, patch, filters: {} as Record<string, unknown> }
          const chain: any = {
            eq(col: string, val: unknown) { upd.filters[col] = val; return chain },
            then(res: any) { updates.push(upd); return Promise.resolve({ error: null }).then(res) },
          }
          return chain
        },
        then(res: any) {
          // Terminal für Select-ohne-single (Listen).
          return Promise.resolve({ data: rowsFor(table, state.filters), error: null }).then(res)
        },
      }
      return api
    },
  }
}

function rowsFor(table: string, filters: Record<string, unknown>) {
  return (tables[table] ?? []).filter((row) =>
    Object.entries(filters).every(([col, val]) => (val === '__null__' ? row[col] == null : row[col] === val)),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  tables = { subscribers: [], post_comments: [], subscriber_action_tokens: [], generated_posts: [], posts: [] }
  inserted = {}
  updates = []
  mocks.moderate.mockResolvedValue({ verdict: 'publish', reason: 'ok' })
})

describe('submitUnverifiedComment — Mail-Throttle', () => {
  it('parkt Kommentar + liefert verifyMail beim ERSTEN Mal', async () => {
    tables.subscribers = [{ id: 'sub-1', status: 'active', email: 'a@x.de' }]
    const { submitUnverifiedComment } = await import('@/lib/comments/service')
    const client = (await import('@/lib/supabase/admin')).createAdminClient()
    const r = await submitUnverifiedComment(client as any, 'a@x.de', input())
    expect(r.verifyMail).not.toBeNull()
    expect(inserted.post_comments?.[0]?.status).toBe('pending_verify')
    expect(inserted.post_comments?.[0]?.verify_token_hash).toBe('hash(RAW)')
  })

  it('schickt KEINE zweite Mail, wenn ein frischer pending_verify des Abonnenten existiert', async () => {
    tables.subscribers = [{ id: 'sub-1', status: 'active', email: 'a@x.de' }]
    // Ein Kommentar wurde eben geparkt (created_at „jetzt").
    tables.post_comments = [{ id: 'c0', subscriber_id: 'sub-1', status: 'pending_verify', created_at: new Date().toISOString() }]
    const { submitUnverifiedComment } = await import('@/lib/comments/service')
    const client = (await import('@/lib/supabase/admin')).createAdminClient()
    const r = await submitUnverifiedComment(client as any, 'a@x.de', input())
    expect(r.verifyMail).toBeNull()
  })

  it('liefert fuer unbekannte Adresse verifyMail=null und speichert nichts', async () => {
    const { submitUnverifiedComment } = await import('@/lib/comments/service')
    const client = (await import('@/lib/supabase/admin')).createAdminClient()
    const r = await submitUnverifiedComment(client as any, 'fremd@x.de', input())
    expect(r.verifyMail).toBeNull()
    expect(inserted.post_comments).toBeUndefined()
  })
})

describe('verifyAndPublishComments — Token-Bindung', () => {
  it('veroeffentlicht NUR den Kommentar mit passendem verify_token_hash', async () => {
    mocks.resolveToken.mockResolvedValue({ subscriberId: 'sub-1' })
    tables.post_comments = [
      { id: 'mine', subscriber_id: 'sub-1', status: 'pending_verify', verify_token_hash: 'hash(RAW)', post_source: 'generated_posts', post_id: 'p1', body: 'meiner' },
      { id: 'smuggled', subscriber_id: 'sub-1', status: 'pending_verify', verify_token_hash: 'hash(OTHER)', post_source: 'generated_posts', post_id: 'p1', body: 'untergeschoben' },
    ]
    const { verifyAndPublishComments } = await import('@/lib/comments/service')
    const r = await verifyAndPublishComments('RAW')
    expect(r?.published).toBe(1)
    // Nur 'mine' wurde geupdatet, 'smuggled' nie angefasst.
    expect(updates.map((u) => u.filters.id)).toEqual(['mine'])
  })

  it('gibt null bei unbekanntem Token zurueck, ohne etwas zu veroeffentlichen', async () => {
    mocks.resolveToken.mockResolvedValue(null)
    const { verifyAndPublishComments } = await import('@/lib/comments/service')
    expect(await verifyAndPublishComments('böse')).toBeNull()
    expect(updates).toHaveLength(0)
  })
})

function input() {
  return {
    postSource: 'generated_posts' as const,
    postId: 'p1',
    body: 'text',
    displayName: 'Name',
    sectionAnchor: null,
    sectionHeadline: null,
  }
}

describe('guardDisplayName — Autor-Impersonation', () => {
  it('haengt bei Kollision mit dem Autornamen einen Marker an', async () => {
    const { guardDisplayName } = await import('@/lib/comments/service')
    expect(guardDisplayName('Matthias Schrader')).toContain('(Leser:in)')
    expect(guardDisplayName('matthias  schrader')).toContain('(Leser:in)')
    expect(guardDisplayName('Matthias Schrader (Team)')).toContain('(Leser:in)')
  })

  it('laesst normale Namen unangetastet (nur getrimmt)', async () => {
    const { guardDisplayName } = await import('@/lib/comments/service')
    expect(guardDisplayName('  Lena K.  ')).toBe('Lena K.')
  })
})
