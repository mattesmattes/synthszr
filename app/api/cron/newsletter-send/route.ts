import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getResend, FROM_EMAIL, BASE_URL } from '@/lib/resend/client'
import { NewsletterEmail } from '@/lib/resend/templates/newsletter'
import { render } from '@react-email/components'
import { generateEmailContentWithVotes } from '@/lib/email/tiptap-to-html'

// Verify cron secret (Vercel cron jobs send this header)
function verifyCronAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  // Allow if CRON_SECRET matches or if called from Vercel cron (no secret needed)
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true
  }

  // Allow if x-vercel-cron header is present (Vercel cron jobs)
  if (request.headers.get('x-vercel-cron') === '1') {
    return true
  }

  // In development, allow without auth
  if (process.env.NODE_ENV === 'development') {
    return true
  }

  return false
}

export async function GET(request: NextRequest) {
  // Verify authorization
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    const postUrl = `${BASE_URL}/blog/${post.slug}`

    // Get all active subscribers
    const { data: subscribers, error: subError } = await supabase
      .from('subscribers')
      .select('id, email')
      .eq('status', 'active')

    if (subError || !subscribers || subscribers.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active subscribers',
        sent: false,
      })
    }

    // Generate email content with Synthszr Vote badges (once for all subscribers)
    const emailContent = await generateEmailContentWithVotes(
      { content: post.content, excerpt: post.excerpt, slug: post.slug },
      BASE_URL
    )

    // Send to all subscribers (sequentially with preference tokens)
    let successCount = 0
    let failCount = 0

    for (const subscriber of subscribers) {
      try {
        const unsubscribeUrl = `${BASE_URL}/api/newsletter/unsubscribe?id=${subscriber.id}`

        const html = await render(
          NewsletterEmail({
            subject,
            previewText,
            content: emailContent,
            postUrl,
            unsubscribeUrl,
            footerText,
            baseUrl: BASE_URL,
          })
        )

        await getResend().emails.send({
          from: FROM_EMAIL,
          to: subscriber.email,
          subject,
          html,
        })
        successCount++

        // 500ms delay between emails to stay under rate limit
        await new Promise(resolve => setTimeout(resolve, 500))
      } catch (error) {
        console.error(`Failed to send to ${subscriber.email}:`, error)
        failCount++
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
