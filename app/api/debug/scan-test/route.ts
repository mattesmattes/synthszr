/**
 * Debug endpoint to test Gmail scan for unfetched emails
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdminRequest } from '@/lib/auth/session'
import { GmailClient } from '@/lib/gmail/client'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const supabase = await createClient()

  try {
    // Get Gmail token
    const { data: tokenData } = await supabase
      .from('gmail_tokens')
      .select('refresh_token')
      .limit(1)
      .single()

    if (!tokenData?.refresh_token) {
      return NextResponse.json({ error: 'No Gmail token found' }, { status: 400 })
    }

    // Get sources
    const { data: sources } = await supabase
      .from('newsletter_sources')
      .select('email')
      .eq('enabled', true)

    const sourceEmails = (sources || []).map(s => s.email.toLowerCase())

    // Get excluded
    const { data: excluded } = await supabase
      .from('excluded_senders')
      .select('email')

    const excludedEmails = (excluded || []).map(s => s.email.toLowerCase())

    // Scan last 2 days
    const twoDaysAgo = new Date()
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)

    const gmailClient = new GmailClient(tokenData.refresh_token)
    // Reduced to 50 messages to avoid timeout
    const allSenders = await gmailClient.scanUniqueSenders(twoDaysAgo, 7, 50)

    // Categorize senders
    const categorized = allSenders.map(sender => {
      const emailLower = sender.email.toLowerCase()
      let status = 'unfetched'
      if (sourceEmails.includes(emailLower)) {
        status = 'source'
      } else if (excludedEmails.includes(emailLower)) {
        status = 'excluded'
      }
      return {
        email: sender.email,
        name: sender.name,
        count: sender.count,
        status
      }
    })

    const unfetched = categorized.filter(s => s.status === 'unfetched')
    const fromSources = categorized.filter(s => s.status === 'source')
    const fromExcluded = categorized.filter(s => s.status === 'excluded')

    return NextResponse.json({
      scanDate: twoDaysAgo.toISOString(),
      totalSenders: allSenders.length,
      registeredSources: sourceEmails.length,
      excludedSenders: excludedEmails.length,
      breakdown: {
        unfetched: unfetched.length,
        alreadySources: fromSources.length,
        excluded: fromExcluded.length
      },
      unfetchedSenders: unfetched.slice(0, 20),
      sampleSources: fromSources.slice(0, 10),
      // Show first few source emails for comparison
      sampleSourceEmails: sourceEmails.slice(0, 10)
    })
  } catch (error) {
    console.error('[Debug Scan] Error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 })
  }
}
