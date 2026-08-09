/**
 * Admin-Moderation /api/admin/comments (Review-Befunde 10 + Hausmuster-Low).
 *
 * Zwei geprüfte Eigenschaften:
 *  - DELETE ist ein ECHTER Hard-Delete (DSGVO Art. 17): der Route-Kommentar
 *    rahmt delete als Löschbegehren — dann darf nicht bloß status='deleted'
 *    gesetzt werden, während Klarname + Text + subscriber_id liegen bleiben.
 *  - PATCH verlangt eine gültige Origin (CSRF), wie das Hausmuster es für
 *    Schreib-Endpunkte vorschreibt.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  requireValidOrigin: vi.fn(),
  del: vi.fn(),
  update: vi.fn(),
  revalidate: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/security/origin-check', () => ({ requireValidOrigin: mocks.requireValidOrigin }))
vi.mock('@/lib/comments/service', () => ({ revalidatePostPaths: mocks.revalidate }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from() {
      const chain: any = {
        delete: (...a: unknown[]) => { mocks.del(...a); return chain },
        update: (p: unknown) => { mocks.update(p); return chain },
        eq: () => chain,
        select: () => chain,
        maybeSingle: () => Promise.resolve({ data: { post_source: 'generated_posts', post_id: 'p1' }, error: null }),
      }
      return chain
    },
  }),
}))

function patch(body: unknown) {
  return new Request('https://synthszr.com/api/admin/comments', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ email: 'admin@x' })
  mocks.requireValidOrigin.mockReturnValue(null)
})

describe('PATCH /api/admin/comments', () => {
  it('lehnt ohne Session mit 401 ab', async () => {
    mocks.getSession.mockResolvedValue(null)
    const { PATCH } = await import('@/app/api/admin/comments/route')
    expect((await PATCH(patch({ id: '11111111-1111-1111-1111-111111111111', action: 'approve' }))).status).toBe(401)
  })

  it('lehnt fremde Origin ab (CSRF)', async () => {
    mocks.requireValidOrigin.mockReturnValue(new Response('forbidden', { status: 403 }))
    const { PATCH } = await import('@/app/api/admin/comments/route')
    const res = await PATCH(patch({ id: '11111111-1111-1111-1111-111111111111', action: 'delete' }))
    expect(res.status).toBe(403)
    expect(mocks.del).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('DELETE entfernt die Zeile wirklich — kein Soft-Delete', async () => {
    const { PATCH } = await import('@/app/api/admin/comments/route')
    const res = await PATCH(patch({ id: '11111111-1111-1111-1111-111111111111', action: 'delete' }))
    expect(res.status).toBe(200)
    expect(mocks.del).toHaveBeenCalled()
    // Kein Update, das die PII bloß auf status='deleted' umschreibt.
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('approve bleibt ein Status-Update (kein Delete)', async () => {
    const { PATCH } = await import('@/app/api/admin/comments/route')
    await PATCH(patch({ id: '11111111-1111-1111-1111-111111111111', action: 'approve' }))
    expect(mocks.update).toHaveBeenCalled()
    expect(mocks.del).not.toHaveBeenCalled()
  })
})
