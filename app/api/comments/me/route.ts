import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { openReaderSession, READER_COOKIE_NAME } from '@/lib/comments/reader-session'
import { getSubscriberDisplayName } from '@/lib/comments/service'
import { resolveSubscriberToken } from '@/lib/newsletter/access-tokens'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'

/**
 * Der am Abo hinterlegte Anzeigename — für die Vorbelegung des Take-Formulars.
 *
 * Bisher kam der Name allein aus localStorage und war damit an ein Gerät
 * gebunden: Wer auf dem Telefon las und am Rechner schrieb, tippte ihn neu und
 * erfahrungsgemäß anders — derselbe Mensch erschien unter zwei Namen.
 *
 * Antwortet BEWUSST IMMER MIT 200, auch ohne erkannte Identität. Ein 401 wäre
 * hier ein Enumerations-Signal ("dieser Token gilt/gilt nicht") für eine reine
 * Bequemlichkeitsfunktion. Ohne Identität steht schlicht kein Name drin.
 *
 * Nichts wird gecacht: Die Antwort hängt an Cookie bzw. Token und gehört
 * niemandem sonst.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const ip = getClientIP(request)
  const rl = await checkRateLimit(`comments-me:${ip}`, rateLimiters.relaxed() ?? undefined)
  if (!rl.success) return rateLimitResponse(rl)

  // Reader-Cookie zuerst, dann der ?ct=-Token aus dem Newsletter-Link — dieselbe
  // Reihenfolge wie beim Absenden eines Kommentars.
  const cookieValue = request.cookies.get(READER_COOKIE_NAME)?.value
  let subscriberId = cookieValue ? openReaderSession(cookieValue)?.subscriberId ?? null : null

  if (!subscriberId) {
    const ct = new URL(request.url).searchParams.get('ct')
    if (ct) {
      const resolved = await resolveSubscriberToken(ct, 'comment', { consume: false })
      subscriberId = resolved?.subscriberId ?? null
    }
  }

  if (!subscriberId) {
    return NextResponse.json({ displayName: null }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const displayName = await getSubscriberDisplayName(createAdminClient(), subscriberId)
  return NextResponse.json({ displayName }, { headers: { 'Cache-Control': 'no-store' } })
}
