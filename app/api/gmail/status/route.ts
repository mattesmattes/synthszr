import { NextResponse } from 'next/server'
import { GmailClient } from '@/lib/gmail/client'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

export async function GET() {
  // Verify admin is logged in
  const session = await getSession()

  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  try {
    const supabase = await createClient()

    // Get stored tokens (single-user setup, so we just get the first one)
    const { data: tokenData, error: tokenError } = await supabase
      .from('gmail_tokens')
      .select('*')
      .limit(1)
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
