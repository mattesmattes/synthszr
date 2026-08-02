import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'
import { resolveSubscriberToken } from '@/lib/newsletter/access-tokens'

// Standard rate limiter: 30 requests per minute per IP
const standardLimiter = rateLimiters.standard()

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * Preferences are addressed by a purpose-scoped token (SEC-001), never by
 * subscriber id. There is deliberately no POST handler any more: the previous
 * one accepted `{ subscriberId }` and returned a working preference token, so
 * anyone holding a leaked UUID - and until the signup fix, that was anyone
 * who could guess an email address - could mint themselves access. Tokens are
 * now only ever minted server-side while sending mail.
 */

/**
 * GET /api/newsletter/preferences?token=xxx
 */
export async function GET(request: NextRequest) {
  const clientIP = getClientIP(request)
  const rateLimitResult = await checkRateLimit(`preferences:${clientIP}`, standardLimiter ?? undefined)
  if (!rateLimitResult.success) return rateLimitResponse(rateLimitResult)

  try {
    const token = new URL(request.url).searchParams.get('token')
    if (!token) {
      return NextResponse.json({ error: 'Token erforderlich' }, { status: 400, headers: NO_STORE })
    }

    const resolved = await resolveSubscriberToken(token, 'preferences')
    if (!resolved) {
      // One answer for unknown, expired and wrong-purpose alike.
      return NextResponse.json({ error: 'Ungültiger Token' }, { status: 404, headers: NO_STORE })
    }

    const supabase = createAdminClient()
    const { data: subscriber, error: subError } = await supabase
      .from('subscribers')
      .select('email, preferences')
      .eq('id', resolved.subscriberId)
      .single()

    if (subError || !subscriber) {
      return NextResponse.json({ error: 'Ungültiger Token' }, { status: 404, headers: NO_STORE })
    }

    const preferences = subscriber.preferences as { language?: string } | null

    return NextResponse.json(
      { email: subscriber.email, language: preferences?.language || 'de' },
      { headers: NO_STORE },
    )
  } catch (error) {
    console.error('Preferences GET error:', error)
    return NextResponse.json({ error: 'Interner Fehler' }, { status: 500, headers: NO_STORE })
  }
}

/**
 * PUT /api/newsletter/preferences
 * Body: { token: string, language: string }
 */
export async function PUT(request: NextRequest) {
  const clientIP = getClientIP(request)
  const rateLimitResult = await checkRateLimit(`preferences:${clientIP}`, standardLimiter ?? undefined)
  if (!rateLimitResult.success) return rateLimitResponse(rateLimitResult)

  try {
    const body = await request.json().catch(() => ({}))
    const token = typeof body.token === 'string' ? body.token : ''
    const language = typeof body.language === 'string' ? body.language : ''

    if (!token) {
      return NextResponse.json({ error: 'Token erforderlich' }, { status: 400, headers: NO_STORE })
    }

    const supabase = createAdminClient()

    // Validate against the locales that actually exist, so the stored value
    // cannot be arbitrary caller-controlled text.
    const { data: locale } = await supabase
      .from('languages')
      .select('code')
      .eq('code', language)
      .eq('is_active', true)
      .maybeSingle()

    if (!locale) {
      return NextResponse.json({ error: 'Ungültige Sprache' }, { status: 400, headers: NO_STORE })
    }

    const resolved = await resolveSubscriberToken(token, 'preferences')
    if (!resolved) {
      return NextResponse.json({ error: 'Ungültiger Token' }, { status: 404, headers: NO_STORE })
    }

    const { data: subscriber } = await supabase
      .from('subscribers')
      .select('preferences, email')
      .eq('id', resolved.subscriberId)
      .single()

    const currentPrefs = (subscriber?.preferences as Record<string, unknown>) || {}
    const oldLanguage = (currentPrefs.language as string) || 'de'

    const { error: updateError } = await supabase
      .from('subscribers')
      .update({
        preferences: { ...currentPrefs, language },
        updated_at: new Date().toISOString(),
      })
      .eq('id', resolved.subscriberId)

    if (updateError) {
      console.error('Preferences update error:', updateError)
      return NextResponse.json({ error: 'Fehler beim Speichern' }, { status: 500, headers: NO_STORE })
    }

    if (oldLanguage !== language) {
      await supabase.from('subscriber_language_changes').insert({
        subscriber_id: resolved.subscriberId,
        email: subscriber?.email ?? null,
        old_language: oldLanguage,
        new_language: language,
      })
    }

    return NextResponse.json({ success: true }, { headers: NO_STORE })
  } catch (error) {
    console.error('Preferences PUT error:', error)
    return NextResponse.json({ error: 'Interner Fehler' }, { status: 500, headers: NO_STORE })
  }
}
