import { NextRequest, NextResponse } from 'next/server'
import { processNewsletters } from '@/lib/newsletter/processor'
import { requireCronOrAdmin, requireAdmin } from '@/lib/auth/session'

// Node.js runtime for jsdom compatibility
export const runtime = 'nodejs'

// GET for Vercel Cron (automatic scheduling)
export async function GET(request: NextRequest) {
  // Verify cron secret or admin session
  const authError = await requireCronOrAdmin(request)
  if (authError) return authError

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
// Body: { forceSince?: string } - optional ISO date to force fetch from
export async function POST(request: NextRequest) {
  // Always require admin auth for manual triggers
  const authError = await requireAdmin(request)
  if (authError) return authError

  try {
    // Parse optional forceSince from request body
    let forceSince: string | undefined
    try {
      const body = await request.json()
      forceSince = body?.forceSince
    } catch {
      // No body or invalid JSON - that's fine, use defaults
    }

    const result = await processNewsletters({ forceSince })

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
