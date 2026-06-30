import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getResend, FROM_EMAIL, BASE_URL } from '@/lib/resend/client'
import { ensureReferralCode } from '@/lib/referrals/service'
import { checkRateLimit, getClientIP, rateLimiters } from '@/lib/rate-limit'
import { requireValidOrigin } from '@/lib/security/origin-check'

const standardLimiter = rateLimiters.standard()

/** Schickt dem Inhaber einer (aktiven) Abo-Adresse einen Link zu seiner persönlichen
 *  Empfehlungs-Übersicht. Antwortet immer mit success (gegen E-Mail-Enumeration). */
export async function POST(request: NextRequest) {
  const originError = requireValidOrigin(request)
  if (originError) return originError

  const clientIP = getClientIP(request)
  const rl = await checkRateLimit(`referral-magic:${clientIP}`, standardLimiter ?? undefined)
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: { email?: string; lang?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const lang = typeof body.lang === 'string' && /^[a-z]{2,4}$/.test(body.lang) ? body.lang : 'de'
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data: sub } = await supabase
    .from('subscribers')
    .select('id, status')
    .eq('email', email)
    .maybeSingle()

  if (sub && sub.status === 'active') {
    await ensureReferralCode(sub.id)
    const url = `${BASE_URL}/${lang}/referral?sid=${sub.id}`
    try {
      await getResend().emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: lang === 'de' ? 'Dein Synthszr-Empfehlungslink' : 'Your Synthszr referral link',
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#111827">
          <p>${lang === 'de' ? 'Hier ist der Link zu deiner persönlichen Empfehlungs-Übersicht:' : 'Here is the link to your personal referral overview:'}</p>
          <p><a href="${url}" style="display:inline-block;background:#111827;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${lang === 'de' ? 'Meine Empfehlungen ansehen' : 'View my referrals'}</a></p>
          <p style="color:#6b7280;font-size:13px">${lang === 'de' ? 'Falls du das nicht angefordert hast, ignoriere diese Mail einfach.' : 'If you did not request this, just ignore this email.'}</p>
        </div>`,
      })
    } catch (err) {
      console.error('[referral magic-link] send failed:', err)
    }
  }

  // Immer success — verrät nicht, ob die Adresse existiert.
  return NextResponse.json({ success: true })
}
