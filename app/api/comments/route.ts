import { NextRequest, NextResponse, after } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { readJsonBody, BoundedBodyError } from '@/lib/security/bounded-body'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'
import { requireValidOrigin } from '@/lib/security/origin-check'
import { openReaderSession, sealReaderSession, READER_COOKIE_NAME, READER_SESSION_TTL_SECONDS } from '@/lib/comments/reader-session'
import {
  listPublishedComments,
  postExists,
  resolveCommentToken,
  submitUnverifiedComment,
  submitVerifiedComment,
  type PostSource,
} from '@/lib/comments/service'
import { getResend, FROM_EMAIL, BASE_URL } from '@/lib/resend/client'

/**
 * „Eure Takes": öffentlicher Kommentar-Endpunkt.
 *
 * Schutz-Reihenfolge nach dem Hausmuster (track/event + newsletter/subscribe):
 * Origin-Check → Rate-Limit → readJsonBody 8KB → Zod strict — erst dann DB.
 * Kommentare sind der zweite öffentlich beschreibbare Pfad des Projekts;
 * hier gilt die volle Kette inkl. CSRF-Schutz.
 */
const MAX_BODY_BYTES = 8 * 1024

// strict-Preset (5/min): ein Mensch schreibt keine sechs Kommentare pro Minute,
// ein Bot schon.
const limiter = rateLimiters.strict()

const commentSchema = z.object({
  postSource: z.enum(['posts', 'generated_posts']),
  postId: z.string().uuid(),
  body: z.string().min(1).max(4000),
  displayName: z.string().min(1).max(80),
  sectionAnchor: z.string().max(200).nullable().optional(),
  sectionHeadline: z.string().max(200).nullable().optional(),
  // Web-Flow ohne Cookie: Abo-Adresse für den Magic-Link.
  email: z.string().email().max(320).optional(),
  // Newsletter-Flow: Token aus dem ?ct=-Link.
  commentToken: z.string().max(200).optional(),
  // Honeypot: unsichtbares Feld. Menschen lassen es leer, Bots füllen es.
  website: z.string().max(200).optional(),
}).strict()

export async function POST(request: NextRequest) {
  const originError = requireValidOrigin(request)
  if (originError) return originError

  const ip = getClientIP(request)
  const rateLimit = await checkRateLimit(`comments:${ip}`, limiter ?? undefined)
  if (!rateLimit.success) return rateLimitResponse(rateLimit)

  let rawBody: unknown
  try {
    rawBody = await readJsonBody(request, MAX_BODY_BYTES)
  } catch (err) {
    if (err instanceof BoundedBodyError && err.code === 'BODY_TOO_LARGE') {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = commentSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Ungültige Eingabe' }, { status: 400 })
  }
  const data = parsed.data

  // Honeypot gefüllt → Bot. Bewusst 200 mit Erfolgs-Form: ein Bot, der einen
  // Fehler sieht, passt sein Skript an; einer, der Erfolg sieht, zieht weiter.
  if (data.website && data.website.trim() !== '') {
    return NextResponse.json({ status: 'pending' })
  }

  const supabase = createAdminClient()
  if (!(await postExists(supabase, data.postSource as PostSource, data.postId))) {
    return NextResponse.json({ error: 'Artikel nicht gefunden' }, { status: 404 })
  }

  const input = {
    postSource: data.postSource as PostSource,
    postId: data.postId,
    body: data.body.trim(),
    displayName: data.displayName.trim(),
    sectionAnchor: data.sectionAnchor ?? null,
    sectionHeadline: data.sectionHeadline ?? null,
  }

  try {
    // Identität, in Prioritätsreihenfolge: Reader-Cookie → Newsletter-Token.
    const cookieValue = request.cookies.get(READER_COOKIE_NAME)?.value
    let subscriberId = cookieValue ? openReaderSession(cookieValue)?.subscriberId ?? null : null
    let refreshCookie = false

    if (!subscriberId && data.commentToken) {
      subscriberId = await resolveCommentToken(data.commentToken)
      // Token war gültig → Cookie setzen, damit der nächste Kommentar ohne
      // Token-Parameter funktioniert (der Link wandert aus der URL).
      refreshCookie = subscriberId !== null
    }

    if (subscriberId) {
      const { status } = await submitVerifiedComment(supabase, subscriberId, input)
      const res = NextResponse.json({ status })
      if (refreshCookie) {
        res.cookies.set(READER_COOKIE_NAME, sealReaderSession(subscriberId, new Date(Date.now() + READER_SESSION_TTL_SECONDS * 1000)), {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: READER_SESSION_TTL_SECONDS,
          path: '/',
        })
      }
      return res
    }

    // Web-Flow: E-Mail nötig.
    if (!data.email) {
      return NextResponse.json({ error: 'email_required' }, { status: 401 })
    }
    // ANTI-ENUMERATION mit gleichem TIMING: die gesamte „ist das ein Abonnent,
    // dann parken + mailen"-Arbeit läuft NACH der Antwort (after). Beide Fälle
    // — Abonnent und Unbekannt — kehren sofort mit derselben Antwort zurück; es
    // gibt keinen await-Pfad mehr, dessen Dauer den Abo-Status verriете
    // (Review-Befund 4). Der Mailversand ist ohnehin fire-and-forget.
    const email = data.email
    after(async () => {
      try {
        const { verifyMail } = await submitUnverifiedComment(supabase, email, input)
        if (!verifyMail) return
        const verifyUrl = `${BASE_URL}/api/comments/verify?token=${encodeURIComponent(verifyMail.rawToken)}`
        await getResend().emails.send({
          from: FROM_EMAIL,
          to: email,
          subject: 'Deinen Take bestätigen',
          html: `<p>Du hast auf synthszr.com einen Take hinterlassen. Ein Klick, und er geht in die Veröffentlichung:</p>
<p><a href="${verifyUrl}">Take bestätigen</a></p>
<p style="color:#666;font-size:13px">Der Link gilt 7 Tage. Danach kannst du 90 Tage lang ohne erneute Bestätigung kommentieren.<br>
Falls du das nicht warst, ignoriere diese Mail — ohne Bestätigung erscheint nichts.</p>`,
        })
      } catch (err) {
        console.error('[Comments] Hintergrund-Verifizierung fehlgeschlagen:', err)
      }
    })
    return NextResponse.json({ status: 'verify_sent' })
  } catch (err) {
    console.error('[Comments] POST fehlgeschlagen:', err)
    return NextResponse.json({ error: 'Kommentar konnte nicht gespeichert werden' }, { status: 500 })
  }
}

/** Veröffentlichte Kommentare — Client-Auffrischung nach der Hydration.
 *  Dieselbe Auswahl wie das SSR, damit beide dasselbe zeigen. */
export async function GET(request: NextRequest) {
  // Rate-Limit trotz CDN-Cache: ein Cache-Buster-Query (?_=random) umginge den
  // Edge-Cache und träfe die DB direkt. Der Lesepfad soll nicht als
  // Last-Verstärker missbraucht werden können.
  const ip = getClientIP(request)
  const rl = await checkRateLimit(`comments-get:${ip}`, rateLimiters.relaxed() ?? undefined)
  if (!rl.success) return rateLimitResponse(rl)

  const { searchParams } = new URL(request.url)
  const source = searchParams.get('source')
  const postId = searchParams.get('postId')
  if ((source !== 'posts' && source !== 'generated_posts') || !postId || !z.string().uuid().safeParse(postId).success) {
    return NextResponse.json({ error: 'Ungültige Parameter' }, { status: 400 })
  }
  const comments = await listPublishedComments(createAdminClient(), source, postId)
  return NextResponse.json(
    { comments },
    // Kurzer CDN-Cache: nimmt Lastspitzen, ohne die Frische spürbar zu kosten.
    { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' } },
  )
}
