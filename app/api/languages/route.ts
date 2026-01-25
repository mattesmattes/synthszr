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

    const { data, error } = await supabase
      .from('languages')
      .select('*')
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
