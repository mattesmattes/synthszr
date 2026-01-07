import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes max

export async function POST(request: NextRequest) {
  // This endpoint is protected by admin middleware
  // It proxies requests to the cron endpoint with proper authentication

  // Use the request's origin to construct the URL (works for both local and production)
  const host = request.headers.get('host') || 'localhost:3000'
  const protocol = host.includes('localhost') ? 'http' : 'https'
  const baseUrl = `${protocol}://${host}`

  try {
    const response = await fetch(`${baseUrl}/api/cron/scheduled-tasks?runAll=true&force=true`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      },
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Cron endpoint failed' },
        { status: response.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error triggering scheduled tasks:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to trigger scheduled tasks' },
      { status: 500 }
    )
  }
}
