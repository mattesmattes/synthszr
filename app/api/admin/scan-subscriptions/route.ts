import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { scanSubscriptions } from '@/lib/subscriptions/detector'

export const maxDuration = 300

export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  try {
    const supabase = await createClient()

    const { data: tokenData } = await supabase.from('gmail_tokens').select('refresh_token').single()
    if (!tokenData?.refresh_token) {
      return NextResponse.json({ error: 'Gmail nicht verbunden.' }, { status: 400 })
    }

    // Content-Quellen-Domains für is_content_source-Markierung
    const { data: sources } = await supabase.from('newsletter_sources').select('email')
    const contentDomains = new Set(
      (sources || []).map((s) => {
        const e = (s.email as string).toLowerCase()
        const at = e.lastIndexOf('@')
        return at >= 0 ? e.slice(at + 1) : e
      }),
    )

    const detected = await scanSubscriptions(tokenData.refresh_token)

    // Bestehende Overrides bewahren: ignored / manually_added / cancelled NICHT überschreiben.
    const { data: existing } = await supabase
      .from('paid_subscriptions')
      .select('provider_key, status, manually_added')
    const locked = new Set(
      (existing || [])
        .filter((r) => r.manually_added || r.status === 'ignored' || r.status === 'cancelled')
        .map((r) => r.provider_key as string),
    )

    let upserted = 0
    for (const d of detected) {
      if (locked.has(d.providerKey)) continue
      const { error } = await supabase.from('paid_subscriptions').upsert({
        provider_name: d.providerName,
        provider_key: d.providerKey,
        sender_domain: d.senderDomain,
        sender_email: d.senderEmail,
        amount: d.amount,
        currency: d.currency,
        interval: d.interval,
        amount_monthly: d.amountMonthly,
        last_payment_at: d.lastPaymentAt,
        evidence_message_ids: d.evidenceMessageIds,
        unsubscribe_type: d.unsubscribeType,
        unsubscribe_target: d.unsubscribeTarget,
        is_content_source: contentDomains.has(d.senderDomain),
        status: 'active',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'provider_key' })
      if (!error) upserted++
      else console.error('[scan-subscriptions] upsert error:', error.message)
    }

    return NextResponse.json({ scanned: detected.length, upserted, total: detected.length })
  } catch (error) {
    console.error('[scan-subscriptions] error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Scan fehlgeschlagen' }, { status: 500 })
  }
}
