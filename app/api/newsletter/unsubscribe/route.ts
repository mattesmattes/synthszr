import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { BASE_URL } from '@/lib/resend/client'

// Lazy initialization to avoid build-time errors
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.redirect(`${BASE_URL}/newsletter/unsubscribe?error=missing_id`)
  }

  try {
    const supabase = getSupabase()

    // Find subscriber by ID
    const { data: subscriber, error: findError } = await supabase
      .from('subscribers')
      .select('id, status')
      .eq('id', id)
      .single()

    if (findError || !subscriber) {
      return NextResponse.redirect(`${BASE_URL}/newsletter/unsubscribe?error=not_found`)
    }

    if (subscriber.status === 'unsubscribed') {
      return NextResponse.redirect(`${BASE_URL}/newsletter/unsubscribe?status=already_unsubscribed`)
    }

    // Unsubscribe
    const { error: updateError } = await supabase
      .from('subscribers')
      .update({
        status: 'unsubscribed',
        unsubscribed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscriber.id)

    if (updateError) {
      console.error('Unsubscribe update error:', updateError)
      return NextResponse.redirect(`${BASE_URL}/newsletter/unsubscribe?error=update_failed`)
    }

    return NextResponse.redirect(`${BASE_URL}/newsletter/unsubscribe?status=success`)
  } catch (error) {
    console.error('Unsubscribe error:', error)
    return NextResponse.redirect(`${BASE_URL}/newsletter/unsubscribe?error=server_error`)
  }
}
