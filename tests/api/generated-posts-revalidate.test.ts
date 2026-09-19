/**
 * Speichern eines Artikels revalidiert dessen Seiten aktiv (2026-09-19).
 *
 * /[lang]/posts/[slug] cacht seit dem Egress-Befund 10 statt 1 Minute. Ohne
 * aktives revalidatePostPaths stünde eine Korrektur bis zu 10 Minuten nicht
 * online — der Preis der längeren ISR wäre dann für den Redakteur sichtbar.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  revalidatePostPaths: vi.fn(async () => {}),
  updateResult: { data: { id: 'p1', status: 'draft' } as unknown, error: null as unknown },
}))

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn(async () => ({ email: 'admin@test' })) }))
vi.mock('@/lib/comments/service', () => ({ revalidatePostPaths: mocks.revalidatePostPaths }))

function makeChain() {
  const chain: any = {}
  for (const m of ['select', 'eq', 'in', 'update']) chain[m] = vi.fn(() => chain)
  chain.single = vi.fn(async () => mocks.updateResult)
  chain.maybeSingle = vi.fn(async () => mocks.updateResult)
  chain.then = (res: (v: unknown) => void) => res(mocks.updateResult)
  return chain
}
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => makeChain() }) }))

import { PATCH, PUT } from '@/app/api/admin/generated-posts/route'

const req = (method: string, body: unknown) =>
  new Request('http://localhost/api/admin/generated-posts', {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as any

beforeEach(() => {
  mocks.revalidatePostPaths.mockClear()
  mocks.updateResult = { data: { id: 'p1', status: 'draft' }, error: null }
})

describe('generated-posts: Revalidierung beim Speichern', () => {
  it('PATCH revalidiert alle Locale-Kopien des Artikels', async () => {
    const res = await PATCH(req('PATCH', { id: 'p1', title: 'Neu' }))
    expect(res.status).toBe(200)
    expect(mocks.revalidatePostPaths).toHaveBeenCalledWith(expect.anything(), 'generated_posts', 'p1')
  })

  it('PUT revalidiert alle Locale-Kopien des Artikels', async () => {
    const res = await PUT(req('PUT', { id: 'p1', title: 'Neu' }))
    expect(res.status).toBe(200)
    expect(mocks.revalidatePostPaths).toHaveBeenCalledWith(expect.anything(), 'generated_posts', 'p1')
  })

  it('revalidiert nicht, wenn das Speichern fehlschlägt', async () => {
    mocks.updateResult = { data: null, error: { message: 'boom' } }
    const res = await PATCH(req('PATCH', { id: 'p1', title: 'Neu' }))
    expect(res.status).toBe(500)
    expect(mocks.revalidatePostPaths).not.toHaveBeenCalled()
  })
})
