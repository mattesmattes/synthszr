import { NextRequest, NextResponse } from 'next/server'
import { getTokensFromCode } from '@/lib/gmail/oauth'
import { GmailClient } from '@/lib/gmail/client'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  // Handle error from Google
  if (error) {
    console.error('OAuth error:', error)
    return NextResponse.redirect(
      new URL('/admin/settings?error=oauth_denied', request.url)
    )
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/admin/settings?error=no_code', request.url)
    )
  }

  try {
    // Exchange code for tokens
    const tokens = await getTokensFromCode(code)

    if (!tokens.refresh_token) {
      console.error('No refresh token received')
      return NextResponse.redirect(
        new URL('/admin/settings?error=no_refresh_token', request.url)
      )
    }

    // Test the connection by getting user profile
    const gmailClient = new GmailClient(tokens.refresh_token)
    const profile = await gmailClient.getProfile()

    // Store tokens in database
    const supabase = await createClient()

    // Upsert gmail tokens
    const { error: dbError } = await supabase
      .from('gmail_tokens')
      .upsert({
        id: 'primary', // Single-user setup, so we use a fixed ID
        email: profile.email,
        access_token: tokens.access_token || '',
        refresh_token: tokens.refresh_token,
        token_type: tokens.token_type || 'Bearer',
        expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'id'
      })

    if (dbError) {
      console.error('Error storing tokens:', dbError)
      return NextResponse.redirect(
        new URL('/admin/settings?error=db_error', request.url)
      )
    }

    // Success - redirect to settings page
    return NextResponse.redirect(
      new URL('/admin/settings?success=gmail_connected', request.url)
    )
  } catch (error) {
    console.error('Error in OAuth callback:', error)
    return NextResponse.redirect(
      new URL('/admin/settings?error=token_exchange_failed', request.url)
    )
  }
}
