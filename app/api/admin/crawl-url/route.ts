/**
 * Crawl URL API
 * POST: Crawl a URL and save the extracted article to daily_repo
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { extractArticleContent } from '@/lib/scraper/article-extractor'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { url, newsletter_date } = body as { url?: string; newsletter_date?: string }

    if (!url || !newsletter_date) {
      return NextResponse.json(
        { error: 'url und newsletter_date sind erforderlich' },
        { status: 400 }
      )
    }

    // Validate URL format
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return NextResponse.json(
        { error: 'URL muss mit http:// oder https:// beginnen' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Check for duplicates (same URL + same date)
    const { data: existing } = await supabase
      .from('daily_repo')
      .select('id')
      .eq('source_url', url)
      .eq('newsletter_date', newsletter_date)
      .limit(1)
      .single()

    if (existing) {
      return NextResponse.json(
        { error: 'Dieser Artikel ist für dieses Datum bereits vorhanden' },
        { status: 409 }
      )
    }

    // Crawl the URL
    console.log(`[CrawlURL] Crawling: ${url}`)
    const article = await extractArticleContent(url)

    if (!article) {
      return NextResponse.json(
        { error: 'URL konnte nicht gecrawlt werden — kein Artikelinhalt gefunden' },
        { status: 422 }
      )
    }

    if (!article.textContent || article.textContent.trim().length < 50) {
      return NextResponse.json(
        { error: 'Extrahierter Inhalt ist zu kurz oder leer' },
        { status: 422 }
      )
    }

    // Save to daily_repo
    const { data: inserted, error: insertError } = await supabase
      .from('daily_repo')
      .insert({
        source_type: 'article',
        source_url: article.finalUrl || url,
        title: article.title || url,
        content: article.textContent,
        raw_html: article.content,
        newsletter_date,
        source_email: null,
        newsletter_source_id: null,
        source_language: 'de',
      })
      .select()
      .single()

    if (insertError) {
      console.error('[CrawlURL] Insert error:', insertError)
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      )
    }

    console.log(`[CrawlURL] Saved: "${article.title}" (${article.textContent.length} chars)`)

    return NextResponse.json({ item: inserted })
  } catch (error) {
    console.error('[CrawlURL] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unbekannter Fehler' },
      { status: 500 }
    )
  }
}
