import { verifyBearerToken } from '@/lib/security/cron-auth'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { getResend, FROM_EMAIL, BASE_URL } from '@/lib/resend/client'
import { NewsletterEmail } from '@/lib/resend/templates/newsletter'
import { render } from '@react-email/components'
import { generateEmailContentWithVotes, ArticleThumbnail } from '@/lib/email/tiptap-to-html'
import type { LanguageCode } from '@/lib/types'
import { getActiveAdPromo } from '@/lib/ad-promos/get-active'
import { getActiveTipPromo } from '@/lib/tip-promos/get-active'
import { mintNewsletterLinkTokens } from '@/lib/newsletter/access-tokens'
import { fetchAllActiveSubscribers } from '@/lib/newsletter/active-subscribers'

// Allow up to 2 minutes for large subscriber lists
export const maxDuration = 120

// Check admin auth (via session or cron secret header for Vercel cron jobs)
async function isAuthenticated(request?: NextRequest): Promise<boolean> {
  // Check for cron secret in header (for scheduled tasks on Vercel)
  if (request) {
    const authHeader = request.headers.get('authorization')
    if (verifyBearerToken(authHeader, process.env.CRON_SECRET)) {
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

    // Look up pre-generated email cover (natively dithered at 604px)
    const { data: emailCoverData } = await supabase
      .from('post_images')
      .select('image_url')
      .eq('post_id', postId)
      .eq('image_type', 'cover_email')
      .eq('generation_status', 'completed')
      .single()

    const emailCoverImageUrl = emailCoverData?.image_url || null

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

    // Fetch email template settings and promotion config
    const { data: templateSettings } = await supabase
      .from('newsletter_settings')
      .select('value')
      .eq('key', 'email_template')
      .single()

    const templates = templateSettings?.value as { subjectTemplate?: string; footerText?: string } || {}
    const subjectTemplate = templates.subjectTemplate || '{{title}}'
    // Kein hartkodierter deutscher Default: bleibt der Footer leer, nutzt
    // NewsletterEmail den pro Sprache lokalisierten Standard-Footer
    // (strings.footer[locale]). Nur ein in der Admin-UI gesetzter Custom-Text
    // überschreibt ihn dann global über alle Sprachen.
    const footerText = templates.footerText || undefined

    // Apply template variables
    const subject = subjectTemplate.replace(/\{\{title\}\}/g, post.title)
    const previewText = post.excerpt || ''
    const postDate = post.created_at

    // Fetch active ad promo + tip promo (admin-managed)
    const activePromo = await getActiveAdPromo()
    const activeTipPromo = await getActiveTipPromo({ context: 'newsletter' })

    // If testEmail, send only to that address (default German locale for test)
    if (testEmail) {
      const testLocale = 'de'
      const testPostUrl = `${BASE_URL}/posts/${post.slug}?ct={{COMMENT_TOKEN}}`

      // Generate email content with Synthszr Vote badges, stock tickers, and thumbnails
      const emailContent = await generateEmailContentWithVotes(
        { content: post.content, excerpt: post.excerpt, slug: post.slug },
        BASE_URL,
        articleThumbnails,
        testLocale,
        undefined,
        activeTipPromo,
        '{{REFERRAL_TOKEN}}',
      )

      // If the test address belongs to a subscriber, mint real link tokens
      // exactly like the batch send does. A preview that carries different
      // links than production cannot verify the links - which was the whole
      // point of sending it.
      const { data: testSubscriber } = await supabase
        .from('subscribers')
        .select('id')
        .eq('email', testEmail.toLowerCase())
        .maybeSingle()

      let unsubscribeUrl = `${BASE_URL}/newsletter/unsubscribe?confirm=1&token=test-preview`
      let preferencesUrl = `${BASE_URL}/newsletter/preferences?token=test-preview`
      let referralToken = 'test-preview'
      let commentToken = 'test-preview'

      if (testSubscriber) {
        const { bySubscriber, rows } = mintNewsletterLinkTokens([testSubscriber.id])
        const { error: tokenError } = await supabase
          .from('subscriber_action_tokens')
          .insert(rows)

        if (tokenError) {
          console.error('[Newsletter test] token insert failed:', tokenError)
          return NextResponse.json({ error: 'Token-Erzeugung fehlgeschlagen' }, { status: 500 })
        }

        const tokens = bySubscriber.get(testSubscriber.id)!
        unsubscribeUrl = `${BASE_URL}/newsletter/unsubscribe?confirm=1&token=${tokens.unsubscribe.rawToken}`
        preferencesUrl = `${BASE_URL}/newsletter/preferences?token=${tokens.preferences.rawToken}`
        referralToken = tokens.referral.rawToken
        commentToken = tokens.comment.rawToken
      }

      const baseTestHtml = await render(
        NewsletterEmail({
          subject,
          previewText,
          content: emailContent,
          postUrl: testPostUrl,
          unsubscribeUrl,
          preferencesUrl,
          footerText,
          coverImageUrl,
          emailCoverImageUrl,
          postDate,
          baseUrl: BASE_URL,
          promo: activePromo,
          locale: testLocale,
        })
      )
      const html = baseTestHtml
        .replaceAll('{{REFERRAL_TOKEN}}', referralToken)
        .replaceAll('{{COMMENT_TOKEN}}', commentToken)

      await getResend().emails.send({
        from: FROM_EMAIL,
        to: testEmail,
        subject: `[TEST] ${subject}`,
        html,
      })

      return NextResponse.json({
        success: true,
        message: testSubscriber
          ? `Test-E-Mail an ${testEmail} gesendet (echte Links — der Abmelde-Link meldet wirklich ab)`
          : `Test-E-Mail an ${testEmail} gesendet (Platzhalter-Links: Adresse ist kein Subscriber)`,
      })
    }

    // Get all active subscribers with their language preferences
    const subscribers = await fetchAllActiveSubscribers(supabase)

    if (subscribers.length === 0) {
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
      // Tip-Promo je Locale in der Zielsprache (gleiche Auswahl, übersetzte Felder).
      const localeTipPromo = await getActiveTipPromo({ context: 'newsletter', locale })
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
        locale !== 'de' ? post.content : undefined, // Pass original content for non-German locales
        localeTipPromo,
        '{{REFERRAL_TOKEN}}',
      )
      contentByLocale.set(locale, emailContent)

      // Apply template variables with localized title
      const localizedSubject = subjectTemplate.replace(/\{\{title\}\}/g, titleToUse)
      subjectByLocale.set(locale, localizedSubject)
      previewTextByLocale.set(locale, excerptToUse || '')
    }

    // Create send record BEFORE sending (needed for recipient tracking)
    const { data: sendRecord } = await supabase
      .from('newsletter_sends')
      .insert({
        post_id: postId,
        subject,
        preview_text: previewText,
        recipient_count: 0,
        status: 'sending',
      })
      .select('id')
      .single()

    const sendId = sendRecord?.id

    // Send emails via Resend batch API (supports up to 100 emails per call)
    // Using large batches = fewer API calls = no rate limit issues + no timeouts
    let successCount = 0
    let failCount = 0
    let batchCount = 0
    const BATCH_SIZE = 50 // Resend batch API supports up to 100 per call
    const BATCH_DELAY_MS = 1500 // 1.5s between batches (only matters if >50 subscribers per locale)
    const MAX_RETRIES = 3

    for (const [locale, localeSubscribers] of subscribersByLocale) {
      const localeAdPromo = await getActiveAdPromo({ locale }) // Ad-Promo je Locale in der Zielsprache
      const emailContent = contentByLocale.get(locale)!
      const localizedSubject = subjectByLocale.get(locale) || subject
      const localizedPreviewText = previewTextByLocale.get(locale) || previewText

      // Build locale-aware post URL
      const localePrefix = locale !== 'de' ? `/${locale}` : ''
      const localizedPostUrl = `${BASE_URL}${localePrefix}/posts/${post.slug}?ct={{COMMENT_TOKEN}}`

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
          emailCoverImageUrl,
          postDate,
          baseUrl: BASE_URL,
          promo: localeAdPromo,
          locale: locale as LanguageCode,
        })
      )

      // Process subscribers in batches
      for (let i = 0; i < localeSubscribers.length; i += BATCH_SIZE) {
        const batch = localeSubscribers.slice(i, i + BATCH_SIZE)

        // Build batch email requests
        // One insert for the whole batch (3 rows per recipient). If it fails
        // the batch is skipped rather than sent: mails whose links resolve to
        // nothing are worse than a delayed send, and the retry loop below
        // would otherwise duplicate them.
        const { bySubscriber, rows: tokenRows } = mintNewsletterLinkTokens(batch.map(s => s.id))
        const { error: tokenError } = await supabase
          .from('subscriber_action_tokens')
          .insert(tokenRows)

        if (tokenError) {
          console.error('[Newsletter] token insert failed, skipping batch:', tokenError)
          failCount += batch.length
          continue
        }

        const batchEmails = batch.map(subscriber => {
          const tokens = bySubscriber.get(subscriber.id)!
          const localePath = locale === 'de' ? '' : `/${locale}`
          const unsubscribeUrl = `${BASE_URL}/newsletter/unsubscribe?confirm=1&token=${tokens.unsubscribe.rawToken}`
          const preferencesUrl = `${BASE_URL}${localePath}/newsletter/preferences?token=${tokens.preferences.rawToken}`

          // Replace placeholders with subscriber-specific URLs. No subscriber
          // id appears in any link any more (SEC-001).
          const html = baseHtml
            .replace('{{UNSUBSCRIBE_URL}}', unsubscribeUrl)
            .replace('{{PREFERENCES_URL}}', preferencesUrl)
            .replaceAll('{{REFERRAL_TOKEN}}', tokens.referral.rawToken)
            .replaceAll('{{COMMENT_TOKEN}}', tokens.comment.rawToken)

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

              // Store Resend email IDs for webhook tracking
              if (sendId && result.data.data) {
                const recipients = result.data.data.map((item: { id: string }, idx: number) => ({
                  newsletter_send_id: sendId,
                  subscriber_id: batch[idx].id,
                  resend_email_id: item.id,
                  email: batch[idx].email,
                }))
                await supabase.from('newsletter_send_recipients').insert(recipients)
              }
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

    // Update the send record with final counts
    if (sendId) {
      await supabase
        .from('newsletter_sends')
        .update({
          recipient_count: successCount,
          status: failCount === 0 ? 'sent' : (successCount === 0 ? 'failed' : 'sent'),
        })
        .eq('id', sendId)
    }

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
