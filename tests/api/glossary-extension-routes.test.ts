import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetMatcherTermsShared = vi.fn()
const mockGetPublishedTermListShared = vi.fn()
const mockGetGlossaryTerm = vi.fn()
const mockCheckRateLimit = vi.fn()

vi.mock('@/lib/glossary/terms', () => ({
  getMatcherTermsShared: (...args: unknown[]) => mockGetMatcherTermsShared(...args),
  getPublishedTermListShared: (...args: unknown[]) => mockGetPublishedTermListShared(...args),
}))

vi.mock('@/lib/glossary/detail', () => ({
  getGlossaryTerm: (...args: unknown[]) => mockGetGlossaryTerm(...args),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  getClientIP: () => '127.0.0.1',
  rateLimiters: {
    relaxed: () => null,
    standard: () => null,
  },
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }),
}))

import { GET as getExtensionIndex } from '@/app/api/glossary/extension-index/route'
import { GET as getTermDetail } from '@/app/api/glossary/term/[slug]/route'

describe('Glossary Extension API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({ success: true, remaining: 99, reset: 0, limit: 100 })
  })

  it('GET /api/glossary/extension-index returns ETag & compact items, and supports 304 Not Modified', async () => {
    mockGetMatcherTermsShared.mockResolvedValue([
      { slug: 'vibe-coding', canonicalName: 'Vibe Coding', aliases: ['Prompt Coding', 'AI'] },
      { slug: 'agent', canonicalName: 'Agent', aliases: ['Agent'] },
    ])
    mockGetPublishedTermListShared.mockResolvedValue([
      { slug: 'vibe-coding', canonicalName: 'Vibe Coding', summary: 'Prompt-based **coding**.' },
      { slug: 'agent', canonicalName: 'Agent', summary: 'Autonomous software entity.' },
    ])

    const req1 = new NextRequest('https://www.synthszr.com/api/glossary/extension-index?lang=en')
    const res1 = await getExtensionIndex(req1)

    expect(res1.status).toBe(200)
    expect(res1.headers.get('Access-Control-Allow-Origin')).toBe('*')
    const etag = res1.headers.get('ETag')
    expect(etag).toMatch(/^"[a-f0-9]{16}"$/)

    const body = await res1.json()
    expect(body.lang).toBe('en')
    expect(body.count).toBe(2)
    expect(body.items).toEqual([
      { s: 'agent', n: 'Agent', d: 'Autonomous software entity.', amb: 1 },
      { s: 'vibe-coding', n: 'Vibe Coding', a: ['Prompt Coding'], d: 'Prompt-based coding.' },
    ])

    // Matching If-None-Match (even with W/ prefix) -> 304 Not Modified
    const req2 = new NextRequest('https://www.synthszr.com/api/glossary/extension-index?lang=en', {
      headers: { 'if-none-match': `W/${etag}` },
    })
    const res2 = await getExtensionIndex(req2)
    expect(res2.status).toBe(304)
    expect(res2.headers.get('ETag')).toBe(etag)
  })

  it('GET /api/glossary/extension-index returns 503 when upstream loader fails', async () => {
    mockGetMatcherTermsShared.mockResolvedValue(null)
    mockGetPublishedTermListShared.mockResolvedValue([])

    const req = new NextRequest('https://www.synthszr.com/api/glossary/extension-index?lang=de')
    const res = await getExtensionIndex(req)
    expect(res.status).toBe(503)
  })

  it('GET /api/glossary/term/[slug] validates slug, handles 404, and returns sanitized JSON', async () => {
    const badReq = new NextRequest('https://www.synthszr.com/api/glossary/term/Bad_Slug!')
    const badRes = await getTermDetail(badReq, { params: Promise.resolve({ slug: 'Bad_Slug!' }) })
    expect(badRes.status).toBe(400)

    mockGetGlossaryTerm.mockResolvedValueOnce(null)
    const missingReq = new NextRequest('https://www.synthszr.com/api/glossary/term/missing-term?lang=de')
    const missingRes = await getTermDetail(missingReq, { params: Promise.resolve({ slug: 'missing-term' }) })
    expect(missingRes.status).toBe(404)

    mockGetGlossaryTerm.mockResolvedValueOnce({
      id: '1',
      slug: 'vibe-coding',
      canonicalName: 'Vibe Coding',
      aliases: ['Prompt Coding'],
      status: 'published',
      summary: 'Software entsteht über {lex:Prompts}.',
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Begriff geprägt von Andrej Karpathy.' }],
          },
        ],
      },
      illustrationUrl: null,
      illustrationAlt: null,
      animationParams: null,
      updatedAt: '2026-11-20T00:00:00Z',
      relatedTerms: [{ slug: 'prompt', canonicalName: 'Prompt' }],
      products: [{ slug: 'cursor', canonicalName: 'Cursor', relevance: 0.9 }],
      news: [],
    })

    const okReq = new NextRequest('https://www.synthszr.com/api/glossary/term/vibe-coding?lang=de')
    const okRes = await getTermDetail(okReq, { params: Promise.resolve({ slug: 'vibe-coding' }) })
    expect(okRes.status).toBe(200)
    expect(okRes.headers.get('Access-Control-Allow-Origin')).toBe('*')

    const payload = await okRes.json()
    expect(payload).toMatchObject({
      slug: 'vibe-coding',
      lang: 'de',
      canonicalName: 'Vibe Coding',
      summary: 'Software entsteht über Prompts.',
      paragraphs: ['Begriff geprägt von Andrej Karpathy.'],
      relatedTerms: [{ slug: 'prompt', canonicalName: 'Prompt' }],
      products: [{ slug: 'cursor', canonicalName: 'Cursor' }],
      url: 'https://www.synthszr.com/de/glossary/vibe-coding',
    })
  })
})
