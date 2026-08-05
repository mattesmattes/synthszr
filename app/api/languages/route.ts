import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'

// Relaxed rate limiter: 100 requests per minute per IP (public read endpoint)
const relaxedLimiter = rateLimiters.relaxed()

export async function GET(request: NextRequest) {
  // Rate limit check - 100 requests per minute per IP
  const clientIP = getClientIP(request)
  const rateLimitResult = await checkRateLimit(`languages:${clientIP}`, relaxedLimiter ?? undefined)

  if (!rateLimitResult.success) {
    return rateLimitResponse(rateLimitResult)
  }

  try {
    const supabase = await createClient()

    // Gezielte Spalten statt select('*'): llm_model und backfill_from_date
    // gingen sonst an jeden Browser, der diesen öffentlichen Endpunkt aufruft —
    // sie verraten die eingesetzten Modelle und haben im Client keinen Zweck.
    // Verbliebene Konsumentin ist die Newsletter-Präferenzseite (code,
    // native_name, name); die beiden Sprachumschalter laden ihre Liste seit dem
    // Umbau serverseitig über lib/i18n/active-languages.ts.
    const { data, error } = await supabase
      .from('languages')
      .select('code, name, native_name, is_active, is_default')
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('name', { ascending: true })

    if (error) {
      console.error('Error fetching languages:', error)
      return NextResponse.json(
        { error: 'Failed to fetch languages' },
        { status: 500 }
      )
    }

    return NextResponse.json({ languages: data })
  } catch (error) {
    console.error('Error in languages API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
