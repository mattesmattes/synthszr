import { NextResponse } from 'next/server'
import { createAnonClient } from '@/lib/supabase/admin'
import { convertTiptapToMarkdown, parseTiptapContent } from '@/lib/utils/tiptap-to-markdown'
import { getGlossaryTerm } from '@/lib/glossary/detail'
import { getCategoryCappedProductsShared, getActiveCategories } from '@/lib/rankings/leaderboard'
import { toDisplayScore } from '@/lib/rankings/score'
import { PUBLIC_LOCALES } from '@/lib/i18n/config'
import { SITE_URL } from '@/lib/seo/site'
import { getTranslations } from '@/lib/i18n/get-translations'
import type { LanguageCode } from '@/lib/types'

/**
 * Markdown-Gegenstück zu den öffentlichen Seiten (Startseite, Artikel,
 * Glossar-Begriffe, Charts-Übersicht) für Content-Negotiation: middleware.ts
 * rewrite't hierher, wenn ein Request `Accept: text/markdown` vorzieht
 * (is-agentic-Scan 2026-09-16, größter offener Befund). Dieselbe URL liefert
 * je nach Accept-Header HTML oder Markdown — kein separater, zweiter Pfad.
 *
 * Bewusst nur die vier Content-Typen, die der Scan als "höchster Wert für
 * Agenten" markierte; alles andere (inkl. unbekannter Slug) landet im
 * generischen 404-Markdown.
 */

interface RouteParams {
  params: Promise<{ locale: string; rest?: string[] }>
}

function md(body: string, status = 200): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', Vary: 'Accept' },
  })
}

function footer(locale: string, t: Record<string, string>): string {
  return [
    '---',
    `[${t['common.home']}](${SITE_URL}/${locale}) · [Synthszr Charts](${SITE_URL}/${locale}/rankings) · [${t['nav.glossary']}](${SITE_URL}/${locale}/glossary) · [${t['nav.archive']}](${SITE_URL}/${locale}/archive)`,
  ].join('\n')
}

function notFoundMarkdown(locale: string, t: Record<string, string>): NextResponse {
  return md(['# 404 — Seite nicht gefunden', '', 'Diese Seite existiert nicht oder wurde entfernt.', '', footer(locale, t)].join('\n'), 404)
}

async function renderHome(locale: string, t: Record<string, string>): Promise<NextResponse> {
  const supabase = createAnonClient()
  const { data: posts } = await supabase
    .from('generated_posts')
    .select('id, title, slug, excerpt, created_at')
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(20)

  const translationsMap = new Map<string, { title: string; slug: string | null; excerpt: string | null }>()
  if (locale !== 'de' && posts && posts.length > 0) {
    const { data: translations } = await supabase
      .from('content_translations')
      .select('generated_post_id, title, slug, excerpt')
      .eq('language_code', locale)
      .eq('translation_status', 'completed')
      .in('generated_post_id', posts.map((p) => p.id))
    for (const t9n of translations ?? []) {
      if (t9n.generated_post_id) translationsMap.set(t9n.generated_post_id, { title: t9n.title, slug: t9n.slug, excerpt: t9n.excerpt })
    }
  }

  const lines: string[] = [
    '# Synthszr — AI is about Synthesis not Efficiency.',
    '',
    t['meta.description'],
    '',
    `## ${t['home.all_articles']}`,
    '',
  ]

  for (const post of posts ?? []) {
    const t9n = translationsMap.get(post.id)
    const title = t9n?.title || post.title
    const slug = t9n?.slug || post.slug
    const excerpt = t9n?.excerpt ?? post.excerpt
    lines.push(`### [${title}](${SITE_URL}/${locale}/posts/${slug})`)
    if (excerpt) lines.push(excerpt)
    lines.push('')
  }

  lines.push(footer(locale, t))
  return md(lines.join('\n'))
}

async function renderPost(locale: string, slug: string, t: Record<string, string>): Promise<NextResponse> {
  const supabase = createAnonClient()
  let { data: post } = await supabase
    .from('generated_posts')
    .select('id, title, slug, excerpt, content, created_at')
    .eq('slug', slug)
    .eq('status', 'published')
    .single()

  // Nicht per Original-Slug gefunden: gilt nur außerhalb de (dort ist der
  // Original-Slug auch der URL-Slug) — Muster identisch zu
  // app/[lang]/posts/[slug]/page.tsx, nur auf generated_posts beschränkt.
  if (!post && locale !== 'de') {
    const { data: bySlug } = await supabase
      .from('content_translations')
      .select('generated_post_id')
      .eq('slug', slug)
      .eq('language_code', locale)
      .eq('translation_status', 'completed')
      .single()
    if (bySlug?.generated_post_id) {
      const { data: byId } = await supabase
        .from('generated_posts')
        .select('id, title, slug, excerpt, content, created_at')
        .eq('id', bySlug.generated_post_id)
        .eq('status', 'published')
        .single()
      post = byId
    }
  }

  if (!post) return notFoundMarkdown(locale, t)

  let title = post.title
  let excerpt = post.excerpt
  let content: unknown = post.content

  if (locale !== 'de') {
    const { data: translation } = await supabase
      .from('content_translations')
      .select('title, excerpt, content')
      .eq('generated_post_id', post.id)
      .eq('language_code', locale)
      .eq('translation_status', 'completed')
      .single()
    if (translation) {
      title = translation.title || title
      excerpt = translation.excerpt ?? excerpt
      content = translation.content ?? content
    }
  }

  const doc = parseTiptapContent(content)
  const body = doc ? convertTiptapToMarkdown(doc) : ''

  const lines = [`# ${title}`, '', ...(excerpt ? [`*${excerpt}*`, ''] : []), body, '', footer(locale, t)]
  return md(lines.join('\n'))
}

async function renderGlossaryTerm(locale: string, slug: string, t: Record<string, string>): Promise<NextResponse> {
  const term = await getGlossaryTerm(slug, locale)
  if (!term) return notFoundMarkdown(locale, t)

  const doc = parseTiptapContent(term.body)
  const body = doc ? convertTiptapToMarkdown(doc) : ''

  const lines = [`# ${term.canonicalName}`, '', term.summary, '', body]

  if (term.relatedTerms.length > 0) {
    lines.push('', `## ${t['glossary.related_terms']}`, '')
    for (const related of term.relatedTerms) {
      lines.push(`- [${related.canonicalName}](${SITE_URL}/${locale}/glossary/${related.slug})`)
    }
  }

  lines.push('', footer(locale, t))
  return md(lines.join('\n'))
}

async function renderRankings(locale: string, t: Record<string, string>): Promise<NextResponse> {
  const [capped, categories] = await Promise.all([getCategoryCappedProductsShared(50, false), getActiveCategories()])
  const nameBySlug = new Map(categories.map((c) => [c.slug, c.name]))

  // Top 40 in globaler Momentum-Reihenfolge (Reihenfolge von
  // getCategoryCappedProducts) — genug für einen Überblick, ohne den ganzen
  // Long-Tail in eine einzelne Markdown-Antwort zu packen.
  const top = capped.slice(0, 40)
  const lines = [
    '# Synthszr Charts — AI-Produkt-Momentum-Ranking',
    '',
    'Tägliches Momentum-Ranking von AI-Produkten, berechnet aus tausenden News-Quellen. Score ist kategorie-relativ (0–100, logarithmisch zum Kategorie-Spitzenreiter).',
    '',
    '| Rang | Produkt | Anbieter | Kategorie | Score | Trend |',
    '|---|---|---|---|---|---|',
  ]
  for (const p of top) {
    const score = toDisplayScore(p.momentum, p.categoryMax)
    const category = p.primaryCategory ? nameBySlug.get(p.primaryCategory) ?? p.primaryCategory : '—'
    const trendSymbol = p.trend === 'up' ? '↑' : p.trend === 'down' ? '↓' : '→'
    lines.push(`| ${p.catRank} | [${p.canonicalName}](${SITE_URL}/${locale}/rankings/${p.slug}) | ${p.vendor} | ${category} | ${score} | ${trendSymbol} |`)
  }
  lines.push('', footer(locale, t))
  return md(lines.join('\n'))
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { locale: rawLocale, rest } = await params
  const locale = (PUBLIC_LOCALES as string[]).includes(rawLocale) ? rawLocale : 'de'
  const segments = rest ?? []
  const t = await getTranslations(locale as LanguageCode)

  if (segments.length === 0) return renderHome(locale, t)
  if (segments[0] === 'posts' && segments.length === 2) return renderPost(locale, segments[1], t)
  if (segments[0] === 'glossary' && segments.length === 2) return renderGlossaryTerm(locale, segments[1], t)
  if (segments[0] === 'rankings' && segments.length === 1) return renderRankings(locale, t)

  return notFoundMarkdown(locale, t)
}
