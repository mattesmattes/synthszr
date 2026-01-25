import { NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/gmail/oauth'
import { getSession } from '@/lib/auth/session'

export async function GET() {
  // Verify admin is logged in
  const session = await getSession()

  if (!session) {
    return NextResponse.json(
      { error: 'Nicht autorisiert' },
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
