import { NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/gmail/oauth'
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
    const authUrl = getAuthUrl()
    return NextResponse.redirect(authUrl)
  } catch (error) {
    console.error('Error generating auth URL:', error)
    return NextResponse.json(
      { error: 'Failed to generate authorization URL' },
      { status: 500 }
    )
  }
}
