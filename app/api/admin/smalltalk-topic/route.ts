/**
 * GET /api/admin/smalltalk-topic
 *
 * Fetches the most recent Gmail email with subject "+smalltalk"
 * from the last 36 hours and returns its body as the preloaded
 * smalltalk topic for podcast script generation.
 *
 * Returns: { topic: string | null }
 */

import { NextResponse } from 'next/server'
import { GmailClient } from '@/lib/gmail/client'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/session'
import { NextRequest } from 'next/server'

const MAX_AGE_HOURS = 36

/**
 * Strip HTML tags and decode common entities for plain text fallback
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request)
  if (authError) return authError

  try {
    const supabase = await createClient()

    const { data: tokenData, error: tokenError } = await supabase
      .from('gmail_tokens')
      .select('refresh_token')
      .limit(1)
      .single()

    if (tokenError || !tokenData?.refresh_token) {
      return NextResponse.json({ topic: null, reason: 'gmail_not_connected' })
    }

    const gmail = new GmailClient(tokenData.refresh_token)

    // Search for emails with "+smalltalk" in subject, last 36h
    const emails = await gmail.fetchEmailsBySubject(null, '+smalltalk', 1, MAX_AGE_HOURS)

    if (emails.length === 0) {
      return NextResponse.json({ topic: null, reason: 'no_email_found' })
    }

    const email = emails[0]

    // Verify age (double-check, fetchEmailsBySubject uses hoursBack internally)
    const ageMs = Date.now() - email.date.getTime()
    if (ageMs > MAX_AGE_HOURS * 60 * 60 * 1000) {
      return NextResponse.json({ topic: null, reason: 'email_too_old' })
    }

    // Extract topic text: prefer plain text, fall back to stripped HTML
    const rawText = email.textBody || (email.htmlBody ? stripHtml(email.htmlBody) : null)
    if (!rawText?.trim()) {
      return NextResponse.json({ topic: null, reason: 'empty_body' })
    }

    // Use the body as the topic (trim whitespace, take first 500 chars)
    const topic = rawText.trim().slice(0, 500)

    return NextResponse.json({ topic, emailDate: email.date.toISOString() })
  } catch (error) {
    console.error('[Smalltalk Topic] Error:', error)
    return NextResponse.json({ topic: null, reason: 'error' })
  }
}
