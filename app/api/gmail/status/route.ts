import { NextResponse } from 'next/server'
import { GmailClient } from '@/lib/gmail/client'
import { createClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/session'
import { cookies } from 'next/headers'

export async function GET() {
  // Verify admin is logged in
  const cookieStore = await cookies()
  const session = await verifySession(cookieStore)

  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  try {
    const supabase = await createClient()

    // Get stored tokens
    const { data: tokenData, error: tokenError } = await supabase
      .from('gmail_tokens')
      .select('*')
      .eq('id', 'primary')
      .single()

    if (tokenError || !tokenData) {
      return NextResponse.json({
        connected: false,
        email: null,
      })
    }

    // Test connection by getting profile
    try {
      const gmailClient = new GmailClient(tokenData.refresh_token)
      const profile = await gmailClient.getProfile()

      return NextResponse.json({
        connected: true,
        email: profile.email,
        messagesTotal: profile.messagesTotal,
      })
    } catch {
      // Token might be invalid
      return NextResponse.json({
        connected: false,
        email: tokenData.email,
        error: 'Token expired or invalid',
      })
    }
  } catch (error) {
    console.error('Error checking Gmail status:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
