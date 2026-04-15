import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'
import { requireValidOrigin } from '@/lib/security/origin-check'

export const runtime = 'nodejs'

const limiter = rateLimiters.standard()

/**
 * POST /api/newsletter/set-language
 * Body: { sid: string, language: string }
 *
 * Updates the subscriber's preferences.language. Called from the home page
 * language switcher when the user arrived via the newsletter "Sprache ändern"
 * link (which carries ?sid=<subscriber.id>).
 *
 * Same trust model as the unsubscribe link: subscriber.id alone authorizes
 * the change. Anyone with the URL can flip a subscriber's language — same
 * surface area as one-click unsubscribe.
 */
export async function POST(request: NextRequest) {
  // Block cross-origin POSTs (CSRF defense)
  const originError = requireValidOrigin(request)
  if (originError) return originError

  const clientIP = getClientIP(request)
  const rateLimitResult = await checkRateLimit(`set-language:${clientIP}`, limiter ?? undefined)
  if (!rateLimitResult.success) return rateLimitResponse(rateLimitResult)

  try {
    const body = await request.json()
    const sid = (body.sid ?? '').toString().trim()
    const language = (body.language ?? '').toString().trim()

    if (!sid || !language) {
      return NextResponse.json({ error: 'sid und language erforderlich' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Verify language exists and is active
    const { data: lang } = await supabase
      .from('languages')
      .select('code')
      .eq('code', language)
      .eq('is_active', true)
      .maybeSingle()

    if (!lang) {
      return NextResponse.json({ error: 'Sprache nicht aktiv' }, { status: 400 })
    }

    const { data: subscriber } = await supabase
      .from('subscribers')
      .select('preferences')
      .eq('id', sid)
      .maybeSingle()

    if (!subscriber) {
      return NextResponse.json({ error: 'Subscriber nicht gefunden' }, { status: 404 })
    }

    const currentPrefs = (subscriber.preferences as Record<string, unknown>) || {}
    const { error: updateError } = await supabase
      .from('subscribers')
      .update({
        preferences: { ...currentPrefs, language },
        updated_at: new Date().toISOString(),
      })
      .eq('id', sid)

    if (updateError) {
      console.error('[set-language] update error:', updateError)
      return NextResponse.json({ error: 'Speichern fehlgeschlagen' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[set-language] error:', error)
    return NextResponse.json({ error: 'Interner Fehler' }, { status: 500 })
  }
}
