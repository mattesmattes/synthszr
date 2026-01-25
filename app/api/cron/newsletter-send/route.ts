import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getResend, FROM_EMAIL, BASE_URL } from '@/lib/resend/client'
import { NewsletterEmail } from '@/lib/resend/templates/newsletter'
import { render } from '@react-email/components'
import { generateEmailContentWithVotes, ArticleThumbnail } from '@/lib/email/tiptap-to-html'
import type { LanguageCode } from '@/lib/types'
import { verifyCronAuth } from '@/lib/security/cron-auth'

export async function GET(request: NextRequest) {
  // Verify cron authentication (secure - no dev bypass by default)
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()

    // Check if cron is enabled
    const { data: cronSettings } = await supabase
      .from('newsletter_settings')
      .select('value')
      .eq('key', 'cron_schedule')
      .single()

    const settings = cronSettings?.value as { enabled?: boolean; hour?: number; minute?: number } || {}

    if (!settings.enabled) {
      return NextResponse.json({
        success: true,
        message: 'Cron is disabled',
        sent: false,
      })
    }

    // Check current hour matches scheduled time (with 15 min tolerance)
    const now = new Date()
    const currentHour = now.getUTCHours()
    const currentMinute = now.getUTCMinutes()
    const scheduledHour = settings.hour ?? 9
    const scheduledMinute = settings.minute ?? 0

    // Only send if we're within 15 minutes of the scheduled time
    const isScheduledTime =
      currentHour === scheduledHour &&
      currentMinute >= scheduledMinute &&
      currentMinute < scheduledMinute + 15

    if (!isScheduledTime) {
      return NextResponse.json({
        success: true,
        message: `Not scheduled time. Current: ${currentHour}:${currentMinute} UTC, Scheduled: ${scheduledHour}:${scheduledMinute} UTC`,
        sent: false,
      })
    }

    // Get today's published posts that haven't been sent yet
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const { data: todaysPosts } = await supabase
      .from('generated_posts')
      .select('id, title, slug, excerpt, content')
      .eq('status', 'published')
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)

    if (!todaysPosts || todaysPosts.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No new posts to send today',
        sent: false,
      })
    }

    const post = todaysPosts[0]

    // Fetch article thumbnails for this post
    const { data: thumbnailsData } = await supabase
      .from('post_images')
      .select('article_index, image_url, vote_color')
      .eq('post_id', post.id)
      .eq('image_type', 'article_thumbnail')
      .eq('generation_status', 'completed')
      .order('article_index', { ascending: true })

    const articleThumbnails: ArticleThumbnail[] = (thumbnailsData || []).map(t => ({
      article_index: t.article_index,
      image_url: t.image_url,
      vote_color: t.vote_color || undefined,
    }))

    // Check if this post was already sent
    const { data: existingSend } = await supabase
      .from('newsletter_sends')
      .select('id')
      .eq('post_id', post.id)
      .single()

    if (existingSend) {
      return NextResponse.json({
        success: true,
        message: 'Post already sent',
        sent: false,
      })
    }

    // Fetch email template settings
    const { data: templateSettings } = await supabase
      .from('newsletter_settings')
      .select('value')
      .eq('key', 'email_template')
      .single()

    const templates = templateSettings?.value as { subjectTemplate?: string; footerText?: string } || {}
    const subjectTemplate = templates.subjectTemplate || '{{title}}'
    const footerText = templates.footerText || 'Du erhältst diese E-Mail, weil du den Synthszr Newsletter abonniert hast.'

    const subject = subjectTemplate.replace(/\{\{title\}\}/g, post.title)
    const previewText = post.excerpt || ''

    // Get all active subscribers with their language preferences
    const { data: subscribers, error: subError } = await supabase
      .from('subscribers')
      .select('id, email, preferences')
      .eq('status', 'active')

    if (subError || !subscribers || subscribers.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active subscribers',
        sent: false,
      })
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
          .eq('generated_post_id', post.id)
          .eq('language_code', locale)
          .eq('translation_status', 'completed')
          .single()

        if (translation?.content) {
          console.log(`[Newsletter Cron] Using translated content for locale: ${locale}`)
          contentToUse = translation.content
          excerptToUse = translation.excerpt || post.excerpt
          titleToUse = translation.title || post.title
        } else {
          console.warn(`[Newsletter Cron] No translation found for locale ${locale}, falling back to German`)
        }
      }

      const emailContent = await generateEmailContentWithVotes(
        { content: contentToUse, excerpt: excerptToUse, slug: post.slug },
        BASE_URL,
        articleThumbnails,
        locale
      )
      contentByLocale.set(locale, emailContent)

      // Apply template variables with localized title
      const localizedSubject = subjectTemplate.replace(/\{\{title\}\}/g, titleToUse)
      subjectByLocale.set(locale, localizedSubject)
      previewTextByLocale.set(locale, excerptToUse || '')
    }

    // Send to all subscribers (sequentially with preference tokens)
    let successCount = 0
    let failCount = 0
    let subscriberIndex = 0
    const totalSubscribers = subscribers.length

    for (const [locale, localeSubscribers] of subscribersByLocale) {
      const emailContent = contentByLocale.get(locale)!
      const localizedSubject = subjectByLocale.get(locale) || subject
      const localizedPreviewText = previewTextByLocale.get(locale) || previewText

      // Build locale-aware post URL
      const localePrefix = locale !== 'de' ? `/${locale}` : ''
      const localizedPostUrl = `${BASE_URL}${localePrefix}/posts/${post.slug}`

      for (const subscriber of localeSubscribers) {
        try {
          const unsubscribeUrl = `${BASE_URL}/api/newsletter/unsubscribe?id=${subscriber.id}`

          // Generate preferences token for this subscriber (with 5s timeout)
          let preferencesUrl: string | undefined
          const prefController = new AbortController()
          const prefTimeoutId = setTimeout(() => prefController.abort(), 5000)
          try {
            const prefResponse = await fetch(`${BASE_URL}/api/newsletter/preferences`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ subscriberId: subscriber.id }),
              signal: prefController.signal,
            })
            clearTimeout(prefTimeoutId)
            if (prefResponse.ok) {
              const { token } = await prefResponse.json()
              preferencesUrl = `${BASE_URL}/newsletter/preferences?token=${token}`
            }
          } catch (prefError) {
            clearTimeout(prefTimeoutId)
            if (prefError instanceof Error && prefError.name === 'AbortError') {
              console.warn(`[Newsletter Cron] Preferences token timeout for ${subscriber.email}`)
            } else {
              console.warn(`Failed to generate preferences token for ${subscriber.email}:`, prefError)
            }
          }

          const html = await render(
            NewsletterEmail({
              subject: localizedSubject,
              previewText: localizedPreviewText,
              content: emailContent,
              postUrl: localizedPostUrl,
              unsubscribeUrl,
              preferencesUrl,
              footerText,
              baseUrl: BASE_URL,
              locale: locale as LanguageCode,
            })
          )

          await getResend().emails.send({
            from: FROM_EMAIL,
            to: subscriber.email,
            subject: localizedSubject,
            html,
          })
          successCount++

          // 500ms delay between emails to stay under rate limit
          subscriberIndex++
          if (subscriberIndex < totalSubscribers) {
            await new Promise(resolve => setTimeout(resolve, 500))
          }
        } catch (error) {
          console.error(`Failed to send to ${subscriber.email}:`, error)
          failCount++
        }
      }
    }

    // Log the send
    await supabase.from('newsletter_sends').insert({
      post_id: post.id,
      subject,
      preview_text: previewText,
      recipient_count: successCount,
      status: failCount === 0 ? 'sent' : (successCount === 0 ? 'failed' : 'sent'),
    })

    return NextResponse.json({
      success: true,
      message: `Newsletter sent to ${successCount} subscribers`,
      sent: true,
      successCount,
      failCount,
    })
  } catch (error) {
    console.error('Cron newsletter send error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
