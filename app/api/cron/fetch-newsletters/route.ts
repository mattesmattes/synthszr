import { NextRequest, NextResponse } from 'next/server'
import { processNewsletters } from '@/lib/newsletter/processor'
import { isAdminRequest } from '@/lib/auth/session'

// Node.js runtime for jsdom compatibility
export const runtime = 'nodejs'

// Vercel Cron protection
const CRON_SECRET = process.env.CRON_SECRET

// GET for Vercel Cron (automatic scheduling)
export async function GET(request: NextRequest) {
  // Verify cron secret in production (for Vercel Cron)
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const result = await processNewsletters()

    if ('status' in result && result.status) {
      return NextResponse.json(result, { status: result.status })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Cron fetch-newsletters error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}

// POST for manual triggers from admin panel (requires admin session)
export async function POST(request: NextRequest) {
  // Check if user is authenticated as admin
  if (process.env.NODE_ENV === 'production') {
    const isAdmin = await isAdminRequest(request)
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const result = await processNewsletters()

    if ('status' in result && result.status) {
      return NextResponse.json(result, { status: result.status })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Manual fetch-newsletters error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}
