import { NextRequest, NextResponse } from 'next/server'
import { getAdminTokensFromCode, getGoogleUserInfo, isAllowedAdmin } from '@/lib/auth/google'
import { createSession, setSessionCookie } from '@/lib/auth/session'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  if (error) {
    console.error('Google OAuth error:', error)
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_error`)
  }

  if (!code) {
    return NextResponse.redirect(`${baseUrl}/login?error=no_code`)
  }

  try {
    // Exchange code for tokens
    const tokens = await getAdminTokensFromCode(code)

    if (!tokens.access_token) {
      return NextResponse.redirect(`${baseUrl}/login?error=no_access_token`)
    }

    // Get user info from Google
    const userInfo = await getGoogleUserInfo(tokens.access_token)

    if (!userInfo || !userInfo.email) {
      return NextResponse.redirect(`${baseUrl}/login?error=no_email`)
    }

    // Check if user is allowed
    if (!isAllowedAdmin(userInfo.email)) {
      console.log('Unauthorized login attempt:', userInfo.email)
      return NextResponse.redirect(`${baseUrl}/login?error=unauthorized`)
    }

    // Create session with user info
    const sessionToken = await createSession(userInfo.email, userInfo.name)
    await setSessionCookie(sessionToken)

    console.log('Admin login successful:', userInfo.email)
    return NextResponse.redirect(`${baseUrl}/admin`)
  } catch (err) {
    console.error('Google OAuth callback error:', err)
    return NextResponse.redirect(`${baseUrl}/login?error=callback_error`)
  }
}
