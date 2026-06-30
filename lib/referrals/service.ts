import { createAdminClient } from '@/lib/supabase/admin'
import { getResend, FROM_EMAIL, BASE_URL } from '@/lib/resend/client'

export const REFERRAL_THRESHOLD = 10
const ADMIN_EMAIL = 'mattes.schrader@oh-so.com'
const CODE_CRASH_URL = 'https://codecrash.ai'

/** 10-stelliger, nicht-erratbarer Empfehlungscode (nicht die rohe Subscriber-ID). */
export function generateReferralCode(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10)
}

/** Stellt sicher, dass ein Subscriber einen Empfehlungscode hat (Bestand/Reaktivierung). */
export async function ensureReferralCode(subscriberId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('subscribers').select('referral_code').eq('id', subscriberId).maybeSingle()
  if (data?.referral_code) return data.referral_code as string
  const code = generateReferralCode()
  const { error } = await supabase.from('subscribers').update({ referral_code: code }).eq('id', subscriberId)
  return error ? null : code
}

/** Verbucht eine Empfehlung bei Anmeldung über ?ref=CODE — pending bis zum Opt-In.
 *  Ignoriert unbekannte Codes, Self-Referral und Duplikate (UNIQUE-Constraint). */
export async function trackReferral(refCode: string, referredEmail: string, referredSubscriberId: string): Promise<void> {
  if (!refCode) return
  const supabase = createAdminClient()
  const { data: referrer } = await supabase.from('subscribers').select('id').eq('referral_code', refCode).maybeSingle()
  if (!referrer || referrer.id === referredSubscriberId) return // unbekannt oder Self-Referral
  await supabase.from('referrals').upsert(
    {
      referrer_id: referrer.id,
      referred_email: referredEmail.toLowerCase(),
      referred_subscriber_id: referredSubscriberId,
      referral_code: refCode,
      status: 'pending',
    },
    { onConflict: 'referrer_id,referred_email', ignoreDuplicates: true },
  )
}

/** Bei Opt-In: offene Empfehlung dieses Geworbenen bestätigen, Werber-Zähler neu zählen
 *  (robust statt blindem ++) und ab der Schwelle die Belohnung auslösen. */
export async function confirmReferral(subscriberId: string, email: string): Promise<void> {
  const supabase = createAdminClient()
  const { data: ref } = await supabase
    .from('referrals')
    .select('id, referrer_id')
    .or(`referred_subscriber_id.eq.${subscriberId},referred_email.eq.${email.toLowerCase()}`)
    .eq('status', 'pending')
    .maybeSingle()
  if (!ref) return
  await supabase
    .from('referrals')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), referred_subscriber_id: subscriberId, updated_at: new Date().toISOString() })
    .eq('id', ref.id)
  const { count } = await supabase
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_id', ref.referrer_id)
    .eq('status', 'confirmed')
  const confirmed = count ?? 0
  await supabase.from('subscribers').update({ referral_count: confirmed }).eq('id', ref.referrer_id)
  if (confirmed >= REFERRAL_THRESHOLD) await issueReward(ref.referrer_id, confirmed)
}

/** Belohnung bei Schwelle: Reward-Record (idempotent via UNIQUE) + Mail an Werber + Admin-Notiz. */
async function issueReward(referrerId: string, confirmed: number): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('referral_rewards')
    .insert({ subscriber_id: referrerId, reward_type: 'code_crash', threshold_reached: confirmed })
  if (error) return // bereits vergeben (UNIQUE) → keine Doppel-Mail

  const { data: sub } = await supabase.from('subscribers').select('email, name').eq('id', referrerId).maybeSingle()
  const email = sub?.email as string | undefined
  if (!email) return
  try {
    await getResend().emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: '🎉 Du hast dein Code-Crash-Exemplar freigeschaltet!',
      html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111827">
        <h1 style="font-size:22px">Glückwunsch${sub?.name ? `, ${sub.name}` : ''}!</h1>
        <p>Du hast <strong>${confirmed} bestätigte Empfehlungen</strong> für Synthszr erreicht — danke fürs Teilen!</p>
        <p>Als Dankeschön bekommst du ein Exemplar von <strong>CODE CRASH</strong>. Wir melden uns in Kürze für den Versand. In der Zwischenzeit:</p>
        <p><a href="${CODE_CRASH_URL}" style="display:inline-block;background:#111827;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">codecrash.ai →</a></p>
      </div>`,
    })
    await getResend().emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `[Synthszr] Code-Crash-Belohnung fällig: ${email}`,
      html: `<p><strong>${email}</strong> hat ${confirmed} bestätigte Empfehlungen erreicht und ein Code-Crash-Exemplar freigeschaltet. Bitte Versand anstoßen.</p>`,
    })
  } catch (err) {
    console.error('[referrals] reward email failed:', err)
  }
}

export interface ReferralEntry { emailMasked: string; date: string }
export interface ReferralStats {
  referralCode: string
  referralUrl: string
  confirmedCount: number
  pendingCount: number
  threshold: number
  rewarded: boolean
  confirmed: ReferralEntry[]
  pending: ReferralEntry[]
}

/** DSGVO: fremde E-Mails nie offen zeigen — "ma•••@gmail.com". */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '•••'
  const head = local.slice(0, 2)
  return `${head}${'•'.repeat(Math.max(3, local.length - 2))}@${domain}`
}

/** Statistik für die Empfehlungs-Übersichtsseite. Stellt fehlenden Code sicher. */
export async function getReferralStats(subscriberId: string): Promise<ReferralStats | null> {
  const supabase = createAdminClient()
  const { data: sub } = await supabase
    .from('subscribers')
    .select('id, referral_code, status')
    .eq('id', subscriberId)
    .maybeSingle()
  if (!sub) return null
  const code = (sub.referral_code as string) || (await ensureReferralCode(subscriberId)) || ''

  const { data: refs } = await supabase
    .from('referrals')
    .select('referred_email, status, confirmed_at, created_at')
    .eq('referrer_id', subscriberId)
    .order('created_at', { ascending: false })
  const list = refs ?? []
  const confirmed = list
    .filter((r) => r.status === 'confirmed')
    .map((r) => ({ emailMasked: maskEmail(r.referred_email as string), date: (r.confirmed_at as string) ?? (r.created_at as string) }))
  const pending = list
    .filter((r) => r.status === 'pending')
    .map((r) => ({ emailMasked: maskEmail(r.referred_email as string), date: r.created_at as string }))

  const { data: reward } = await supabase.from('referral_rewards').select('id').eq('subscriber_id', subscriberId).maybeSingle()

  return {
    referralCode: code,
    referralUrl: `${BASE_URL}/?ref=${code}`,
    confirmedCount: confirmed.length,
    pendingCount: pending.length,
    threshold: REFERRAL_THRESHOLD,
    rewarded: !!reward,
    confirmed,
    pending,
  }
}
