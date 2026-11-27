import { NextRequest, NextResponse } from 'next/server'
import { getGlossaryTerm } from '@/lib/glossary/detail'
import { checkRateLimit, getClientIP, rateLimiters, rateLimitResponse } from '@/lib/rate-limit'

const SLUG_RE = /^[a-z0-9-]{1,120}$/

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const CACHE_CONTROL = 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800'

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const rateResult = await checkRateLimit(
    `glossary-ext-img:${getClientIP(request)}`,
    rateLimiters.relaxed() ?? undefined,
  )
  if (!rateResult.success) {
    const res = rateLimitResponse(rateResult)
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v)
    return res
  }

  const { slug } = await context.params
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json(
      { error: 'Invalid glossary slug' },
      { status: 400, headers: CORS_HEADERS },
    )
  }

  try {
    const detail = await getGlossaryTerm(slug, 'de')
    if (!detail?.illustrationUrl) {
      return NextResponse.json(
        { error: 'Glossary illustration not found' },
        { status: 404, headers: CORS_HEADERS },
      )
    }

    let parsed: URL
    try {
      parsed = new URL(detail.illustrationUrl)
    } catch {
      return NextResponse.json(
        { error: 'Invalid illustration URL' },
        { status: 403, headers: CORS_HEADERS },
      )
    }

    if (
      parsed.protocol !== 'https:' ||
      !parsed.hostname.endsWith('.public.blob.vercel-storage.com')
    ) {
      return NextResponse.json(
        { error: 'Untrusted illustration host' },
        { status: 403, headers: CORS_HEADERS },
      )
    }

    const upstream = await fetch(detail.illustrationUrl)
    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'Upstream illustration unavailable' },
        { status: 502, headers: CORS_HEADERS },
      )
    }

    const bytes = await upstream.arrayBuffer()
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'image/png',
        'Cache-Control': CACHE_CONTROL,
      },
    })
  } catch (error) {
    console.error('[api/glossary/term/illustration] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load glossary illustration' },
      { status: 500, headers: CORS_HEADERS },
    )
  }
}
