import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { getResend, FROM_EMAIL, BASE_URL } from '@/lib/resend/client'
import { NewsletterEmail } from '@/lib/resend/templates/newsletter'
import { render } from '@react-email/components'
import { generateEmailContentWithVotes } from '@/lib/email/tiptap-to-html'

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

    // Extract cover image URL and create 1:1 cropped version for newsletter
    // Size 704 matches frontend display and prevents font scaling issues
    const originalCoverUrl = (post.post_images as { image_url?: string } | null)?.image_url || null
    const coverImageUrl = originalCoverUrl
      ? `${BASE_URL}/api/newsletter/cover-image?url=${encodeURIComponent(originalCoverUrl)}&size=704`
      : null

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

    // If testEmail, send only to that address
    if (testEmail) {
      // Generate email content with Synthszr Vote badges
      const emailContent = await generateEmailContentWithVotes(
        { content: post.content, excerpt: post.excerpt, slug: post.slug },
        BASE_URL
      )

      const html = await render(
        NewsletterEmail({
          subject,
          previewText,
          content: emailContent,
          postUrl,
          unsubscribeUrl: `${BASE_URL}/newsletter/unsubscribe?id=test`,
          preferencesUrl: `${BASE_URL}/de/newsletter/preferences?token=test`,
          footerText,
          coverImageUrl,
          postDate,
          baseUrl: BASE_URL,
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

    // Get all active subscribers with their language preference
    const { data: subscribers, error: subError } = await supabase
      .from('subscribers')
      .select('id, email, preferences')
      .eq('status', 'active')

    if (subError || !subscribers || subscribers.length === 0) {
      return NextResponse.json({
        error: 'Keine aktiven Subscriber gefunden',
      }, { status: 400 })
    }

    // Group subscribers by language
    const subscribersByLanguage: Record<string, typeof subscribers> = {}
    for (const subscriber of subscribers) {
      const lang = (subscriber.preferences as { language?: string } | null)?.language || 'de'
      if (!subscribersByLanguage[lang]) {
        subscribersByLanguage[lang] = []
      }
      subscribersByLanguage[lang].push(subscriber)
    }

    // Fetch translations for non-German languages
    const translations: Record<string, { title: string; excerpt: string | null; content: unknown } | null> = { de: null }
    const languages = Object.keys(subscribersByLanguage).filter(l => l !== 'de')

    if (languages.length > 0) {
      const { data: translationData } = await supabase
        .from('content_translations')
        .select('language_code, title, excerpt, content')
        .eq('generated_post_id', postId)
        .eq('translation_status', 'completed')
        .in('language_code', languages)

      for (const t of translationData || []) {
        translations[t.language_code] = {
          title: t.title || post.title,
          excerpt: t.excerpt || post.excerpt,
          content: t.content || post.content,
        }
      }
    }

    let successCount = 0
    let failCount = 0

    // Send to each language group
    for (const [lang, langSubscribers] of Object.entries(subscribersByLanguage)) {
      // Get translated content or fall back to German
      const translatedContent = translations[lang]
      const contentToUse = translatedContent?.content || post.content
      const excerptToUse = translatedContent?.excerpt || post.excerpt
      const titleToUse = translatedContent?.title || post.title
      const subjectToUse = subjectTemplate.replace(/\{\{title\}\}/g, titleToUse)

      // Generate email content with Synthszr Vote badges (once per language)
      const emailContent = await generateEmailContentWithVotes(
        { content: contentToUse, excerpt: excerptToUse, slug: post.slug },
        BASE_URL
      )

      for (let i = 0; i < langSubscribers.length; i++) {
        const subscriber = langSubscribers[i]
        const unsubscribeUrl = `${BASE_URL}/api/newsletter/unsubscribe?id=${subscriber.id}`

        try {
          // Generate preference token for this subscriber
          const prefToken = crypto.randomUUID()
          const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

          // Clean up old tokens and create new one
          await supabase
            .from('subscriber_preference_tokens')
            .delete()
            .eq('subscriber_id', subscriber.id)

          await supabase
            .from('subscriber_preference_tokens')
            .insert({
              subscriber_id: subscriber.id,
              token: prefToken,
              expires_at: expiresAt.toISOString(),
            })

          const preferencesUrl = `${BASE_URL}/${lang}/newsletter/preferences?token=${prefToken}`

          const html = await render(
            NewsletterEmail({
              subject: subjectToUse,
              previewText: excerptToUse || '',
              content: emailContent,
              postUrl,
              unsubscribeUrl,
              preferencesUrl,
              footerText,
              coverImageUrl,
              postDate,
              baseUrl: BASE_URL,
            })
          )

          await getResend().emails.send({
            from: FROM_EMAIL,
            to: subscriber.email,
            subject: subjectToUse,
            html,
          })
          successCount++
        } catch (error) {
          console.error(`Failed to send to ${subscriber.email}:`, error)
          failCount++
        }

        // 500ms delay between each email to stay under rate limit
        if (i < langSubscribers.length - 1) {
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
