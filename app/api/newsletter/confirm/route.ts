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
  const token = searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(`${BASE_URL}/newsletter/confirm?error=missing_token`)
  }

  try {
    const supabase = getSupabase()

    // Find subscriber by token
    const { data: subscriber, error: findError } = await supabase
      .from('subscribers')
      .select('id, status')
      .eq('confirmation_token', token)
      .single()

    if (findError || !subscriber) {
      return NextResponse.redirect(`${BASE_URL}/newsletter/confirm?error=invalid_token`)
    }

    if (subscriber.status === 'active') {
      return NextResponse.redirect(`${BASE_URL}/newsletter/confirm?status=already_confirmed`)
    }

    // Activate subscriber
    const { error: updateError } = await supabase
      .from('subscribers')
      .update({
        status: 'active',
        confirmed_at: new Date().toISOString(),
        confirmation_token: null, // Invalidate token after use
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscriber.id)

    if (updateError) {
      console.error('Confirm update error:', updateError)
      return NextResponse.redirect(`${BASE_URL}/newsletter/confirm?error=update_failed`)
    }

    return NextResponse.redirect(`${BASE_URL}/newsletter/confirm?status=success`)
  } catch (error) {
    console.error('Confirm error:', error)
    return NextResponse.redirect(`${BASE_URL}/newsletter/confirm?error=server_error`)
  }
}
