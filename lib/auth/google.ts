import { google } from 'googleapis'

const ADMIN_AUTH_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

// Whitelist of allowed admin emails
const ALLOWED_ADMIN_EMAILS = [
  'mattes@gmail.com',
]

export function getAdminOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/google/callback`
  )
}

export function getAdminAuthUrl(): string {
  const oauth2Client = getAdminOAuth2Client()

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ADMIN_AUTH_SCOPES,
    prompt: 'select_account', // Allow account selection
  })
}

export async function getAdminTokensFromCode(code: string) {
  const oauth2Client = getAdminOAuth2Client()
  const { tokens } = await oauth2Client.getToken(code)
  return tokens
}

export async function getGoogleUserInfo(accessToken: string): Promise<{ email: string; name: string; picture: string } | null> {
  try {
    // Add timeout to prevent hanging on unresponsive API
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout

    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      console.error('Failed to get user info:', response.status)
      return null
    }

    const data = await response.json()
    return {
      email: data.email,
      name: data.name || data.email,
      picture: data.picture || '',
    }
  } catch (error) {
    console.error('Error getting Google user info:', error)
    return null
  }
}

export function isAllowedAdmin(email: string): boolean {
  return ALLOWED_ADMIN_EMAILS.includes(email.toLowerCase())
}
