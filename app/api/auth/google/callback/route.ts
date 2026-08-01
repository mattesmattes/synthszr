import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getAdminTokensFromCode, getGoogleUserInfo, isAllowedAdmin, ADMIN_OAUTH_STATE_COOKIE } from '@/lib/auth/google'
import { createSession, setSessionCookie } from '@/lib/auth/session'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  // CSRF-Schutz: state aus der Query gegen das beim Initiieren gesetzte
  // Cookie prüfen. Bei Fehlen/Mismatch keine Token-Verarbeitung.
  const cookieStore = await cookies()
  const storedState = cookieStore.get(ADMIN_OAUTH_STATE_COOKIE)?.value
  cookieStore.delete(ADMIN_OAUTH_STATE_COOKIE)

  if (!state || !storedState || state !== storedState) {
    console.error('Admin OAuth state mismatch')
    return NextResponse.redirect(`${baseUrl}/login?error=invalid_state`)
  }

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
