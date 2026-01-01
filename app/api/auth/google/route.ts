import { NextResponse } from 'next/server'
import { getAdminAuthUrl } from '@/lib/auth/google'

export async function GET() {
  const authUrl = getAdminAuthUrl()
  return NextResponse.redirect(authUrl)
}
