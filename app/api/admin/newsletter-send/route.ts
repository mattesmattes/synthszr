import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { getResend, FROM_EMAIL, BASE_URL } from '@/lib/resend/client'
import { NewsletterEmail } from '@/lib/resend/templates/newsletter'
import { render } from '@react-email/components'
import { generateEmailContentWithVotes, ArticleThumbnail } from '@/lib/email/tiptap-to-html'
import type { LanguageCode } from '@/lib/types'

// Allow up to 2 minutes for large subscriber lists
export const maxDuration = 120

// Check admin auth (via session or cron secret header for Vercel cron jobs)
async function isAuthenticated(request?: NextRequest): Promise<boolean> {
  // Check for cron secret in header (for scheduled tasks on Vercel)
  if (request) {
    const authHeader = request.headers.get('authorization')
    if (authHeader === `Bearer ${process.env.CRON_SECRET}`) {
      return true
    }
  }

  // Check for session
  const session = await getSession()
  return !!session
}

// GET: List newsletter sends
export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('newsletter_sends')
      .select('*, generated_posts(title, slug)')
      .order('sent_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('Fetch newsletter sends error:', error)
      return NextResponse.json({ error: 'Failed to fetch sends' }, { status: 500 })
    }

    return NextResponse.json({ sends: data })
  } catch (error) {
    console.error('Newsletter sends GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST: Send newsletter
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()

    const body = await request.json()
    const { postId, testEmail } = body

    if (!postId) {
      return NextResponse.json({ error: 'Post ID required' }, { status: 400 })
    }

    // Fetch the post with cover image
    const { data: post, error: postError } = await supabase
      .from('generated_posts')
      .select('*, post_images!cover_image_id(image_url)')
      .eq('id', postId)
      .single()

    if (postError || !post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    // Extract cover image URL
    const coverImageUrl = (post.post_images as { image_url?: string } | null)?.image_url || null

    // Fetch article thumbnails for this post
    const { data: thumbnailsData } = await supabase
      .from('post_images')
      .select('article_index, image_url, vote_color')
      .eq('post_id', postId)
      .eq('image_type', 'article_thumbnail')
      .eq('generation_status', 'completed')
      .order('article_index', { ascending: true })

    const articleThumbnails: ArticleThumbnail[] = (thumbnailsData || []).map(t => ({
      article_index: t.article_index,
      image_url: t.image_url,
      vote_color: t.vote_color || undefined,
    }))

    // Fetch email template settings
    const { data: templateSettings } = await supabase
      .from('newsletter_settings')
      .select('value')
      .eq('key', 'email_template')
      .single()

    const templates = templateSettings?.value as { subjectTemplate?: string; footerText?: string } || {}
    const subjectTemplate = templates.subjectTemplate || '{{title}}'
    const footerText = templates.footerText || 'Du erhältst diese E-Mail, weil du den Synthszr Newsletter abonniert hast.'

    // Apply template variables
    const subject = subjectTemplate.replace(/\{\{title\}\}/g, post.title)
    const previewText = post.excerpt || ''
    const postDate = post.created_at

    // If testEmail, send only to that address (default German locale for test)
    if (testEmail) {
      const testLocale = 'de'
      const testPostUrl = `${BASE_URL}/posts/${post.slug}`

      // Generate email content with Synthszr Vote badges, stock tickers, and thumbnails
      const emailContent = await generateEmailContentWithVotes(
        { content: post.content, excerpt: post.excerpt, slug: post.slug },
        BASE_URL,
        articleThumbnails,
        testLocale
      )

      const html = await render(
        NewsletterEmail({
          subject,
          previewText,
          content: emailContent,
          postUrl: testPostUrl,
          unsubscribeUrl: `${BASE_URL}/newsletter/unsubscribe?id=test`,
          preferencesUrl: `${BASE_URL}/newsletter/preferences?token=test`,
          footerText,
          coverImageUrl,
          postDate,
          baseUrl: BASE_URL,
          locale: testLocale,
        })
      )

      await getResend().emails.send({
        from: FROM_EMAIL,
        to: testEmail,
        subject: `[TEST] ${subject}`,
        html,
      })

      return NextResponse.json({
        success: true,
        message: `Test-E-Mail an ${testEmail} gesendet`,
      })
    }

    // Get all active subscribers with their language preferences
    const { data: subscribers, error: subError } = await supabase
      .from('subscribers')
      .select('id, email, preferences')
      .eq('status', 'active')

    if (subError || !subscribers || subscribers.length === 0) {
      return NextResponse.json({
        error: 'Keine aktiven Subscriber gefunden',
      }, { status: 400 })
    }

    // Group subscribers by language for efficient content generation
    const subscribersByLocale = new Map<string, typeof subscribers>()
    for (const subscriber of subscribers) {
      const prefs = subscriber.preferences as { language?: string } | null
      const locale = prefs?.language || 'de'
      if (!subscribersByLocale.has(locale)) {
        subscribersByLocale.set(locale, [])
      }
      subscribersByLocale.get(locale)!.push(subscriber)
    }

    // Pre-generate email content for each language (avoids redundant API calls)
    // For non-German locales, fetch translated content from content_translations
    const contentByLocale = new Map<string, string>()
    const subjectByLocale = new Map<string, string>()
    const previewTextByLocale = new Map<string, string>()

    for (const locale of subscribersByLocale.keys()) {
      let contentToUse = post.content
      let excerptToUse = post.excerpt
      let titleToUse = post.title

      // For non-German locales, try to fetch translated content
      if (locale !== 'de') {
        const { data: translation } = await supabase
          .from('content_translations')
          .select('title, content, excerpt')
          .eq('generated_post_id', postId)
          .eq('language_code', locale)
          .eq('translation_status', 'completed')
          .single()

        if (translation?.content) {
          console.log(`[Newsletter] Using translated content for locale: ${locale}`)
          contentToUse = translation.content
          excerptToUse = translation.excerpt || post.excerpt
          titleToUse = translation.title || post.title
        } else {
          console.warn(`[Newsletter] No translation found for locale ${locale}, falling back to German`)
        }
      }

      // Pass original German content for company detection
      // This ensures {Company} tags are found even if translation didn't preserve them
      const emailContent = await generateEmailContentWithVotes(
        { content: contentToUse, excerpt: excerptToUse, slug: post.slug },
        BASE_URL,
        articleThumbnails,
        locale,
        locale !== 'de' ? post.content : undefined // Pass original content for non-German locales
      )
      contentByLocale.set(locale, emailContent)

      // Apply template variables with localized title
      const localizedSubject = subjectTemplate.replace(/\{\{title\}\}/g, titleToUse)
      subjectByLocale.set(locale, localizedSubject)
      previewTextByLocale.set(locale, excerptToUse || '')
    }

    // Send emails via Resend batch API (supports up to 100 emails per call)
    // Using large batches = fewer API calls = no rate limit issues + no timeouts
    let successCount = 0
    let failCount = 0
    let batchCount = 0
    const BATCH_SIZE = 50 // Resend batch API supports up to 100 per call
    const BATCH_DELAY_MS = 1500 // 1.5s between batches (only matters if >50 subscribers per locale)
    const MAX_RETRIES = 3

    for (const [locale, localeSubscribers] of subscribersByLocale) {
      const emailContent = contentByLocale.get(locale)!
      const localizedSubject = subjectByLocale.get(locale) || subject
      const localizedPreviewText = previewTextByLocale.get(locale) || previewText

      // Build locale-aware post URL
      const localePrefix = locale !== 'de' ? `/${locale}` : ''
      const localizedPostUrl = `${BASE_URL}${localePrefix}/posts/${post.slug}`

      // Pre-render HTML once per locale (same content for all subscribers in this locale)
      // We'll use a placeholder for subscriber-specific URLs and replace them per email
      const baseHtml = await render(
        NewsletterEmail({
          subject: localizedSubject,
          previewText: localizedPreviewText,
          content: emailContent,
          postUrl: localizedPostUrl,
          unsubscribeUrl: '{{UNSUBSCRIBE_URL}}',
          preferencesUrl: '{{PREFERENCES_URL}}',
          footerText,
          coverImageUrl,
          postDate,
          baseUrl: BASE_URL,
          locale: locale as LanguageCode,
        })
      )

      // Process subscribers in batches
      for (let i = 0; i < localeSubscribers.length; i += BATCH_SIZE) {
        const batch = localeSubscribers.slice(i, i + BATCH_SIZE)

        // Build batch email requests
        const batchEmails = batch.map(subscriber => {
          const unsubscribeUrl = `${BASE_URL}/api/newsletter/unsubscribe?id=${subscriber.id}`
          const preferencesUrl = `${BASE_URL}/newsletter/preferences?token=${subscriber.id}`

          // Replace placeholders with subscriber-specific URLs
          const html = baseHtml
            .replace('{{UNSUBSCRIBE_URL}}', unsubscribeUrl)
            .replace('{{PREFERENCES_URL}}', preferencesUrl)

          return {
            from: FROM_EMAIL,
            to: subscriber.email,
            subject: localizedSubject,
            html,
          }
        })

        // Retry loop with exponential backoff for all transient errors
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            // Wait before sending (longer on retries)
            const delay = attempt > 0 ? BATCH_DELAY_MS * Math.pow(2, attempt) : BATCH_DELAY_MS
            await new Promise(resolve => setTimeout(resolve, delay))

            const result = await getResend().batch.send(batchEmails)

            if (result.data) {
              const sentCount = result.data.data?.length ?? batch.length
              successCount += sentCount
              console.log(`[Newsletter] Batch ${batchCount + 1}: Sent ${sentCount}/${batch.length} emails for locale ${locale}`)
            }
            if (result.error) {
              if (attempt < MAX_RETRIES) {
                console.warn(`[Newsletter] Batch ${batchCount + 1} error (retry ${attempt + 1}/${MAX_RETRIES}):`, result.error)
                continue
              }
              console.error(`[Newsletter] Batch ${batchCount + 1} failed after ${MAX_RETRIES} retries:`, result.error)
              failCount += batch.length
            }
            break // success
          } catch (error) {
            if (attempt < MAX_RETRIES) {
              console.warn(`[Newsletter] Batch ${batchCount + 1} exception (retry ${attempt + 1}/${MAX_RETRIES}):`, error instanceof Error ? error.message : error)
              continue
            }
            console.error(`[Newsletter] Batch ${batchCount + 1} failed after ${MAX_RETRIES} retries:`, error)
            failCount += batch.length
            break
          }
        }
        batchCount++
      }
    }

    // Log the send
    await supabase.from('newsletter_sends').insert({
      post_id: postId,
      subject,
      preview_text: previewText,
      recipient_count: successCount,
      status: failCount === 0 ? 'sent' : (successCount === 0 ? 'failed' : 'sent'),
    })

    return NextResponse.json({
      success: true,
      message: `Newsletter an ${successCount} Subscriber gesendet`,
      successCount,
      failCount,
    })
  } catch (error) {
    console.error('Newsletter send error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
