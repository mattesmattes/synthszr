import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { getResend, FROM_EMAIL, BASE_URL } from '@/lib/resend/client'
import { NewsletterEmail } from '@/lib/resend/templates/newsletter'
import { render } from '@react-email/components'
import { generateEmailContentWithVotes, ArticleThumbnail } from '@/lib/email/tiptap-to-html'
import type { LanguageCode } from '@/lib/types'

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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    const postUrl = `${BASE_URL}/posts/${post.slug}`
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
    const contentByLocale = new Map<string, string>()
    for (const locale of subscribersByLocale.keys()) {
      const emailContent = await generateEmailContentWithVotes(
        { content: post.content, excerpt: post.excerpt, slug: post.slug },
        BASE_URL,
        articleThumbnails,
        locale
      )
      contentByLocale.set(locale, emailContent)
    }

    // Send emails sequentially with delay to avoid rate limits
    let successCount = 0
    let failCount = 0
    let subscriberIndex = 0
    const totalSubscribers = subscribers.length

    for (const [locale, localeSubscribers] of subscribersByLocale) {
      const emailContent = contentByLocale.get(locale)!
      // Build locale-aware post URL
      const localePrefix = locale !== 'de' ? `/${locale}` : ''
      const localizedPostUrl = `${BASE_URL}${localePrefix}/posts/${post.slug}`

      for (const subscriber of localeSubscribers) {
        const unsubscribeUrl = `${BASE_URL}/api/newsletter/unsubscribe?id=${subscriber.id}`

        // Generate preferences token for this subscriber
        let preferencesUrl: string | undefined
        try {
          const prefResponse = await fetch(`${BASE_URL}/api/newsletter/preferences`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscriberId: subscriber.id }),
          })
          if (prefResponse.ok) {
            const { token } = await prefResponse.json()
            preferencesUrl = `${BASE_URL}/newsletter/preferences?token=${token}`
          }
        } catch (prefError) {
          console.warn(`Failed to generate preferences token for ${subscriber.email}:`, prefError)
        }

        try {
          const html = await render(
            NewsletterEmail({
              subject,
              previewText,
              content: emailContent,
              postUrl: localizedPostUrl,
              unsubscribeUrl,
              preferencesUrl,
              footerText,
              coverImageUrl,
              postDate,
              baseUrl: BASE_URL,
              locale: locale as LanguageCode,
            })
          )

          await getResend().emails.send({
            from: FROM_EMAIL,
            to: subscriber.email,
            subject,
            html,
          })
          successCount++
        } catch (error) {
          console.error(`Failed to send to ${subscriber.email}:`, error)
          failCount++
        }

        // 500ms delay between each email to stay under rate limit
        subscriberIndex++
        if (subscriberIndex < totalSubscribers) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
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
