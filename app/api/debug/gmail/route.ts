import { NextResponse } from 'next/server'
import { GmailClient } from '@/lib/gmail/client'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'

export async function GET() {
  // Verify admin is logged in
  const session = await getSession()

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const debug: Record<string, unknown> = {}

  try {
    const supabase = await createClient()

    // 1. Check gmail_tokens
    const { data: tokenData, error: tokenError } = await supabase
      .from('gmail_tokens')
      .select('*')
      .limit(1)
      .single()

    debug.tokenExists = !!tokenData
    debug.tokenError = tokenError?.message || null
    debug.tokenEmail = tokenData?.email || null
    debug.hasRefreshToken = !!tokenData?.refresh_token

    if (!tokenData?.refresh_token) {
      return NextResponse.json({
        success: false,
        error: 'No refresh token found',
        debug
      })
    }

    // 2. Check newsletter sources
    const { data: sources, error: sourcesError } = await supabase
      .from('newsletter_sources')
      .select('email, name')
      .eq('enabled', true)

    debug.sourcesCount = sources?.length || 0
    debug.sourcesError = sourcesError?.message || null
    debug.sourceEmails = sources?.map(s => s.email) || []

    // 3. Check last_newsletter_fetch setting
    const { data: settings } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'last_newsletter_fetch')
      .single()

    debug.lastFetchSetting = settings?.value || null

    // 4. Test Gmail connection
    try {
      const gmailClient = new GmailClient(tokenData.refresh_token)
      const profile = await gmailClient.getProfile()
      debug.gmailConnected = true
      debug.gmailEmail = profile.email
      debug.gmailMessagesTotal = profile.messagesTotal
    } catch (gmailError) {
      debug.gmailConnected = false
      debug.gmailError = gmailError instanceof Error ? gmailError.message : 'Unknown error'
    }

    // 5. Try a simple Gmail search (last 36 hours, first 5 results)
    if (debug.gmailConnected && sources && sources.length > 0) {
      try {
        const gmailClient = new GmailClient(tokenData.refresh_token)
        const afterDate = new Date(Date.now() - 36 * 60 * 60 * 1000)
        const senderEmails = sources.slice(0, 3).map(s => s.email) // Test with first 3 sources

        debug.testQuery = {
          senders: senderEmails,
          afterDate: afterDate.toISOString()
        }

        const emails = await gmailClient.fetchEmailsFromSenders(senderEmails, 5, afterDate)
        debug.testEmailsFound = emails.length
        debug.testEmailSubjects = emails.map(e => ({ subject: e.subject, from: e.from }))
      } catch (searchError) {
        debug.testSearchError = searchError instanceof Error ? searchError.message : 'Unknown error'
      }
    }

    return NextResponse.json({
      success: true,
      debug
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      debug
    }, { status: 500 })
  }
}
