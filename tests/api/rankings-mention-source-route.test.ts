/**
 * GET /api/rankings/mention-source/[id] — Quellen-Volltext auf Klick.
 * Die Sichtbarkeitsprüfung selbst testet tests/lib/rankings-mention-source.test.ts.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const getMentionSourceText = vi.hoisted(() => vi.fn())
vi.mock('@/lib/rankings/product-detail', () => ({ getMentionSourceText }))

import { GET } from '@/app/api/rankings/mention-source/[id]/route'

const ID = '3f2b8c1e-9a4d-4e2b-8f1a-0c5d6e7f8a9b'
const call = (id: string) => GET(new Request(`http://x/api/rankings/mention-source/${id}`), { params: Promise.resolve({ id }) })

beforeEach(() => getMentionSourceText.mockReset())

describe('GET /api/rankings/mention-source/[id]', () => {
  it('weist eine Nicht-UUID ab, ohne die DB zu fragen', async () => {
    const res = await call('abc')
    expect(res.status).toBe(400)
    expect(getMentionSourceText).not.toHaveBeenCalled()
  })

  it('antwortet 404, wenn es die Erwähnung (sichtbar) nicht gibt', async () => {
    getMentionSourceText.mockResolvedValue(undefined)
    expect((await call(ID)).status).toBe(404)
  })

  it('liefert den Text', async () => {
    getMentionSourceText.mockResolvedValue('Volltext')
    const res = await call(ID)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ content: 'Volltext' })
  })

  it('liefert null für eine Quelle ohne Text (Dialog zeigt "Kein Volltext")', async () => {
    getMentionSourceText.mockResolvedValue(null)
    expect(await (await call(ID)).json()).toEqual({ content: null })
  })
})
