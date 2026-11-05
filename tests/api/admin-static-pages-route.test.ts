/**
 * POST /api/admin/static-pages: Speichern revalidiert die Seite in allen
 * öffentlichen Sprachen (ISR, Befund 2026-11-05 am Impressum).
 */
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ revalidatePath: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/auth/session', () => ({ getSession: async () => ({ isAdmin: true }) }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ upsert: () => ({ select: async () => ({ data: [{ slug: 'impressum' }], error: null }) }) }) }),
}))

describe('POST /api/admin/static-pages', () => {
  it('revalidiert /<locale>/<slug> für alle öffentlichen Sprachen', async () => {
    const { POST } = await import('@/app/api/admin/static-pages/route')
    const res = await POST(new Request('https://x', { method: 'POST', body: JSON.stringify({ slug: 'impressum', title: 'Impressum', content: { type: 'doc' } }) }))
    expect(res.status).toBe(200)
    expect(mocks.revalidatePath.mock.calls.map((c) => c[0]).sort()).toEqual(['/cs/impressum', '/de/impressum', '/en/impressum', '/fr/impressum', '/nds/impressum'])
  })
})
