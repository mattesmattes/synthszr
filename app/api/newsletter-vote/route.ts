import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, getClientIP, rateLimiters } from '@/lib/rate-limit'
import { resolveSubscriberToken } from '@/lib/newsletter/access-tokens'
import { sealReaderSession, READER_COOKIE_NAME } from '@/lib/comments/reader-session'
import { type PostSource } from '@/lib/comments/service'
import { SITE_URL } from '@/lib/seo/site'

/**
 * Take-Barometer AUS DEM NEWSLETTER: ein Klick auf 👍/👎 in der Mail.
 *
 * Warum eine eigene GET-Route und nicht /api/take-feedback: Eine E-Mail führt
 * kein JavaScript aus, kann also weder POSTen noch einen Origin-Header setzen —
 * beides verlangt die reguläre Vote-Route zu Recht. Ein Mail-Client kann nur
 * eines: einem Link folgen. Diese Route ist deshalb ein Link, der die Stimme
 * verbucht und danach auf den Artikel weiterleitet.
 *
 * ZWEI LEBENSDAUERN (Betreiber-Entscheidung 2026-08-12, Variante A):
 * - Der `ct`-Token im Artikellink behält seine sieben Tage. Wer die Mail abends
 *   liest und kommentieren will, soll das weiterhin können.
 * - Der Klick auf einen Daumen setzt zusätzlich eine KURZE Lesersitzung von zwei
 *   Stunden. In diesem Fenster darf ohne weiteren Bestätigungs-Mailwechsel ein
 *   Take geschrieben werden — die Abo-Eigenschaft wird also aus der Mail auf die
 *   Website durchgereicht, aber nur für die Dauer des Besuchs.
 *
 * EINE STIMME JE ABONNENT: Der voter_hash kommt hier aus der subscriber_id, nicht
 * aus dem Zufalls-Cookie der Website. Damit zählt derselbe Mensch geräteübergreifend
 * genau einmal je Abschnitt, und ein weitergeleiteter Link kann die Stimme des
 * Absenders höchstens überschreiben — nicht vervielfachen.
 */
export const runtime = 'nodejs'

/** Zwei Stunden, wie vom Betreiber vorgegeben. */
const VOTE_SESSION_TTL_SECONDS = 2 * 60 * 60

/**
 * Der Post kommt über den SLUG, nicht über die id.
 *
 * Der Newsletter-Renderer kennt den Slug ohnehin (er baut die Artikel-URL
 * daraus); die id müsste dagegen durch die ganze Aufrufkette gereicht werden.
 * Slugs sind eindeutig (Unique-Index, s. buildUniqueSlug), die Auflösung hier
 * ist also verlustfrei — und die Links bleiben lesbar.
 */
const paramsSchema = z.object({
  v: z.enum(['agree', 'disagree']),
  s: z.string().min(1).max(200),
  slug: z.string().min(1).max(200),
  l: z.string().regex(/^[a-z]{2,3}$/),
  ct: z.string().min(1).max(200),
})

/**
 * Eigener Namensraum vor dem Hash: Der Website-Vote hasht eine Zufalls-ID, hier
 * ist es eine subscriber_id. Ohne Trennung könnten beide theoretisch auf
 * denselben Wert fallen und sich gegenseitig überschreiben.
 */
function subscriberVoterHash(subscriberId: string): string {
  return createHash('sha256').update(`newsletter-vote:${subscriberId}`).digest('hex')
}

/** Fällt etwas aus, landet der Leser trotzdem beim Artikel — eine Fehlerseite
 *  für einen Mail-Klick wäre die schlechtere Antwort als eine stille Nicht-Stimme. */
function redirectToArticle(lang: string, slug: string, anchor?: string): string {
  const base = `${SITE_URL}/${lang}/posts/${encodeURIComponent(slug)}`
  return anchor ? `${base}#${encodeURIComponent(anchor)}` : base
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const parsed = paramsSchema.safeParse(Object.fromEntries(searchParams))

  // Unbrauchbare Parameter: zur Startseite, nicht als Fehlerseite.
  if (!parsed.success) {
    return NextResponse.redirect(SITE_URL, { status: 303 })
  }
  const { v: vote, s: sectionAnchor, slug, l: lang, ct } = parsed.data
  const ziel = redirectToArticle(lang, slug, sectionAnchor)

  const ip = getClientIP(request)
  const rl = await checkRateLimit(`newsletter-vote:${ip}`, rateLimiters.relaxed() ?? undefined)
  if (!rl.success) return NextResponse.redirect(ziel, { status: 303 })

  // Token NICHT verbrauchen (consume: false): derselbe Token trägt auch den
  // Artikellink und das spätere Kommentieren. Ein Vote darf ihn nicht entwerten.
  const resolved = await resolveSubscriberToken(ct, 'comment', { consume: false })
  if (!resolved?.subscriberId) {
    return NextResponse.redirect(ziel, { status: 303 })
  }

  const supabase = createAdminClient()
  // Der Newsletter verschickt ausschliesslich generated_posts.
  const postSource: PostSource = 'generated_posts'
  const { data: postRow } = await supabase
    .from('generated_posts')
    .select('id')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle()
  const postId = (postRow as { id: string } | null)?.id
  if (!postId) {
    return NextResponse.redirect(ziel, { status: 303 })
  }

  const { error } = await supabase.from('take_feedback').upsert({
    post_source: postSource,
    post_id: postId,
    section_anchor: sectionAnchor,
    vote,
    voter_hash: subscriberVoterHash(resolved.subscriberId),
  }, { onConflict: 'post_source,post_id,section_anchor,voter_hash' })
  if (error) {
    console.error('[NewsletterVote] Upsert fehlgeschlagen:', error.message)
  }

  // Kurze Lesersitzung: ab jetzt zwei Stunden lang ohne Magic Link kommentieren.
  const res = NextResponse.redirect(ziel, { status: 303 })
  const expiresAt = new Date(Date.now() + VOTE_SESSION_TTL_SECONDS * 1000)
  res.cookies.set(READER_COOKIE_NAME, sealReaderSession(resolved.subscriberId, expiresAt), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: VOTE_SESSION_TTL_SECONDS,
    path: '/',
  })
  return res
}
