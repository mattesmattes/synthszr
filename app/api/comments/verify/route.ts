import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'
import { verifyAndPublishComments } from '@/lib/comments/service'
import { sealReaderSession, READER_COOKIE_NAME, READER_SESSION_TTL_SECONDS } from '@/lib/comments/reader-session'

/**
 * Magic-Link aus der Bestätigungs-Mail: geparkte Kommentare durch die
 * Moderation schicken, Reader-Cookie setzen, zurück zur Website.
 *
 * GET, weil es ein Mail-Link ist. Kein Origin-Check (der Klick kommt aus dem
 * Mail-Client) — die Autorisierung IST der Token. Rate-Limit trotzdem: der
 * Endpunkt löst Modellaufrufe aus (Moderation), Token-Raten soll teuer sein.
 *
 * Fehlerfall bewusst wortkarg („Link ungültig oder abgelaufen") — ob der Token
 * nie existierte, abgelaufen oder falsch ist, geht niemanden etwas an
 * (Anti-Enumeration, gleiche Linie wie die Newsletter-Flows).
 */
const limiter = rateLimiters.strict()

export async function GET(request: NextRequest) {
  const ip = getClientIP(request)
  const rateLimit = await checkRateLimit(`comments-verify:${ip}`, limiter ?? undefined)
  if (!rateLimit.success) return rateLimitResponse(rateLimit)

  const token = new URL(request.url).searchParams.get('token') ?? ''
  const result = token ? await verifyAndPublishComments(token) : null

  if (!result) {
    return new NextResponse(
      `<!doctype html><html lang="de"><meta charset="utf-8"><title>Link ungültig</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:1.2rem">Link ungültig oder abgelaufen</h1>
<p>Schreib deinen Take einfach neu — du bekommst dann einen frischen Bestätigungslink.</p>
<p><a href="/de">Zur Startseite</a></p></body></html>`,
      { status: 410, headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  }

  // Erfolg: Cookie setzen und auf die Startseite leiten. Nicht auf den
  // Artikel — es können Kommentare zu MEHREREN Artikeln bestätigt worden sein,
  // und der Statusquerverweis („live" vs. „in Prüfung") steht in der Meldung.
  const message = result.published > 0 && result.pending > 0
    ? `${result.published} Take(s) sind live, ${result.pending} in der Redaktionsprüfung.`
    : result.published > 0
      ? `Dein Take ist live. Danke!`
      : result.pending > 0
        ? `Dein Take ist bestätigt und in der Redaktionsprüfung — er erscheint nach Freigabe.`
        : `Bestätigt. Du kannst jetzt 90 Tage lang direkt kommentieren.`

  const res = new NextResponse(
    `<!doctype html><html lang="de"><meta charset="utf-8"><title>Take bestätigt</title>
<meta http-equiv="refresh" content="4;url=/de">
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:1.2rem">✓ ${message}</h1>
<p>Ab jetzt kannst du 90 Tage lang ohne erneute Bestätigung kommentieren.</p>
<p><a href="/de">Weiter zu Synthszr</a></p></body></html>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
  res.cookies.set(
    READER_COOKIE_NAME,
    sealReaderSession(result.subscriberId, new Date(Date.now() + READER_SESSION_TTL_SECONDS * 1000)),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: READER_SESSION_TTL_SECONDS,
      path: '/',
    },
  )
  return res
}
