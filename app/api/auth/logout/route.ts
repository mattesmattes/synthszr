import { NextResponse } from 'next/server'
import { deleteSessionCookie } from '@/lib/auth/session'

export async function POST() {
  try {
    await deleteSessionCookie()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Logout error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
