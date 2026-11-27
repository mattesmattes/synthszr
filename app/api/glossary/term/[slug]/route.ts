import { NextRequest, NextResponse } from 'next/server'
import { getGlossaryTerm } from '@/lib/glossary/detail'
import {
  extractTipTapPlainParagraphs,
  stripPlainText,
  type SupportedExtensionLang,
} from '@/lib/glossary/extension-index'
import { checkRateLimit, getClientIP, rateLimiters, rateLimitResponse } from '@/lib/rate-limit'
import { SITE_URL } from '@/lib/seo/site'

const SLUG_RE = /^[a-z0-9-]{1,120}$/

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const rateResult = await checkRateLimit(
    `glossary-ext-term:${getClientIP(request)}`,
    rateLimiters.standard() ?? undefined,
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

  const rawLang = request.nextUrl.searchParams.get('lang')
  const lang: SupportedExtensionLang = rawLang === 'en' ? 'en' : 'de'

  try {
    const detail = await getGlossaryTerm(slug, lang)
    if (!detail) {
      return NextResponse.json(
        { error: 'Glossary term not found' },
        { status: 404, headers: CORS_HEADERS },
      )
    }

    const baseUrl = SITE_URL.replace(/\/$/, '')
    const canonicalUrl = `${baseUrl}/${lang}/glossary/${detail.slug}`

    return NextResponse.json(
      {
        slug: detail.slug,
        lang,
        canonicalName: detail.canonicalName,
        aliases: detail.aliases ?? [],
        summary: stripPlainText(detail.summary ?? '', 360),
        paragraphs: extractTipTapPlainParagraphs(detail.body, 5, 1400),
        relatedTerms: (detail.relatedTerms ?? []).slice(0, 6).map((t) => ({
          slug: t.slug,
          canonicalName: t.canonicalName,
        })),
        products: (detail.products ?? []).slice(0, 5).map((p) => ({
          slug: p.slug,
          canonicalName: p.canonicalName,
        })),
        url: canonicalUrl,
        updatedAt: detail.updatedAt,
      },
      {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Cache-Control': CACHE_CONTROL,
        },
      },
    )
  } catch (error) {
    console.error('[api/glossary/term] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load glossary term' },
      { status: 500, headers: CORS_HEADERS },
    )
  }
}
