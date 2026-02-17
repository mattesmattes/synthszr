import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { createAdminClient } from '@/lib/supabase/admin'

const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET

// Resend event types we handle
type ResendEventType =
  | 'email.delivered'
  | 'email.opened'
  | 'email.clicked'
  | 'email.bounced'
  | 'email.complained'

interface ResendWebhookPayload {
  type: ResendEventType
  data: {
    email_id: string
    to: string[]
    click?: { url: string }
    [key: string]: unknown
  }
}

export async function POST(request: NextRequest) {
  if (!WEBHOOK_SECRET) {
    console.error('[Resend Webhook] RESEND_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  try {
    const body = await request.text()

    // Verify Svix signature
    const svixId = request.headers.get('svix-id')
    const svixTimestamp = request.headers.get('svix-timestamp')
    const svixSignature = request.headers.get('svix-signature')

    if (!svixId || !svixTimestamp || !svixSignature) {
      return NextResponse.json({ error: 'Missing signature headers' }, { status: 400 })
    }

    const wh = new Webhook(WEBHOOK_SECRET)
    let payload: ResendWebhookPayload

    try {
      payload = wh.verify(body, {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      }) as ResendWebhookPayload
    } catch {
      console.error('[Resend Webhook] Signature verification failed')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const { type, data } = payload
    const resendEmailId = data.email_id
    const recipientEmail = data.to?.[0]

    // Map Resend event type to our simplified type
    const eventTypeMap: Record<string, string> = {
      'email.delivered': 'delivered',
      'email.opened': 'opened',
      'email.clicked': 'clicked',
      'email.bounced': 'bounced',
      'email.complained': 'complained',
    }

    const eventType = eventTypeMap[type]
    if (!eventType) {
      // Unknown event type, acknowledge but don't store
      return NextResponse.json({ received: true })
    }

    const supabase = createAdminClient()

    // Look up the newsletter_send_id from the recipient table
    let newsletterSendId: string | null = null
    if (resendEmailId) {
      const { data: recipient } = await supabase
        .from('newsletter_send_recipients')
        .select('newsletter_send_id')
        .eq('resend_email_id', resendEmailId)
        .single()

      newsletterSendId = recipient?.newsletter_send_id ?? null
    }

    // Store the event
    await supabase.from('email_events').insert({
      resend_email_id: resendEmailId,
      event_type: eventType,
      recipient_email: recipientEmail,
      newsletter_send_id: newsletterSendId,
      click_url: data.click?.url ?? null,
      raw_payload: data,
    })

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[Resend Webhook] Error:', error)
    // Return 200 to prevent Resend from retrying on our errors
    return NextResponse.json({ received: true })
  }
}
