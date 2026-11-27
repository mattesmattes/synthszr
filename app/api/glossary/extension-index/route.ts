import { NextRequest, NextResponse } from 'next/server'
import {
  buildExtensionGlossaryIndex,
  type SupportedExtensionLang,
} from '@/lib/glossary/extension-index'
import { checkRateLimit, getClientIP, rateLimiters, rateLimitResponse } from '@/lib/rate-limit'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
  'Access-Control-Expose-Headers': 'ETag',
}

const CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'

function normalizeEtagHeader(headerValue: string | null): string[] {
  if (!headerValue) return []
  return headerValue
    .split(',')
    .map((part) => part.trim().replace(/^W\//i, '').replace(/^"|"$/g, ''))
    .filter(Boolean)
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request: NextRequest) {
  const rateResult = await checkRateLimit(
    `glossary-ext-index:${getClientIP(request)}`,
    rateLimiters.relaxed() ?? undefined,
  )
  if (!rateResult.success) {
    const res = rateLimitResponse(rateResult)
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v)
    return res
  }

  const rawLang = request.nextUrl.searchParams.get('lang')
  const lang: SupportedExtensionLang = rawLang === 'en' ? 'en' : 'de'

  try {
    const index = await buildExtensionGlossaryIndex(lang)
    if (!index) {
      return NextResponse.json(
        { error: 'Glossary index temporarily unavailable' },
        { status: 503, headers: CORS_HEADERS },
      )
    }

    const etag = `"${index.version}"`
    const clientTags = normalizeEtagHeader(request.headers.get('if-none-match'))

    if (clientTags.includes(index.version) || clientTags.includes('*')) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ...CORS_HEADERS,
          ETag: etag,
          'Cache-Control': CACHE_CONTROL,
        },
      })
    }

    return NextResponse.json(index, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        ETag: etag,
        'Cache-Control': CACHE_CONTROL,
      },
    })
  } catch (error) {
    console.error('[api/glossary/extension-index] Error:', error)
    return NextResponse.json(
      { error: 'Failed to build glossary index' },
      { status: 500, headers: CORS_HEADERS },
    )
  }
}
