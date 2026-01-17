/**
 * Manage Newsletter Sources API
 * POST: Add sources and/or exclude senders, then fetch new sources
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAdminRequest } from '@/lib/auth/session'
import { GmailClient } from '@/lib/gmail/client'
import { parseNewsletterHtml } from '@/lib/email/parser'

export const runtime = 'nodejs'

interface ManageSourcesRequest {
  addSources: Array<{ email: string; name: string }>
  excludeSenders: Array<{ email: string; name: string }>
}

export async function POST(request: NextRequest) {
  // Check admin session
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body: ManageSourcesRequest = await request.json()
    const { addSources = [], excludeSenders = [] } = body

    const supabase = createAdminClient()
    const results = {
      sourcesAdded: 0,
      sendersExcluded: 0,
      newslettersFetched: 0,
      errors: [] as string[]
    }

    // 1. Add new sources to newsletter_sources
    if (addSources.length > 0) {
      for (const source of addSources) {
        const { error } = await supabase
          .from('newsletter_sources')
          .upsert({
            email: source.email.toLowerCase(),
            name: source.name || null,
            enabled: true
          }, { onConflict: 'email' })

        if (error) {
          results.errors.push(`Failed to add source ${source.email}: ${error.message}`)
        } else {
          results.sourcesAdded++
        }
      }
    }

    // 2. Add to excluded_senders
    if (excludeSenders.length > 0) {
      for (const sender of excludeSenders) {
        const { error } = await supabase
          .from('excluded_senders')
          .upsert({
            email: sender.email.toLowerCase(),
            name: sender.name || null,
            reason: 'user_excluded'
          }, { onConflict: 'email' })

        if (error) {
          results.errors.push(`Failed to exclude ${sender.email}: ${error.message}`)
        } else {
          results.sendersExcluded++
        }
      }
    }

    // 3. If sources were added, fetch their newsletters immediately
    if (results.sourcesAdded > 0) {
      try {
        // Get Gmail token
        const { data: tokenData } = await supabase
          .from('gmail_tokens')
          .select('refresh_token')
          .limit(1)
          .single()

        if (tokenData?.refresh_token) {
          const gmailClient = new GmailClient(tokenData.refresh_token)
          const newSourceEmails = addSources.map(s => s.email.toLowerCase())

          // Fetch last 7 days of emails from new sources
          const afterDate = new Date()
          afterDate.setDate(afterDate.getDate() - 7)

          const emails = await gmailClient.fetchEmailsFromSenders(newSourceEmails, 30, afterDate)
          console.log(`[ManageSources] Fetched ${emails.length} emails from ${newSourceEmails.length} new sources`)

          // Process and store each email
          for (const email of emails) {
            try {
              // Check if already exists
              const newsletterDate = email.date.toISOString().split('T')[0]
              const { data: existing } = await supabase
                .from('daily_repo')
                .select('id')
                .eq('source_email', email.from)
                .eq('title', email.subject)
                .eq('newsletter_date', newsletterDate)
                .single()

              if (existing) continue

              const htmlContent = email.htmlBody || email.textBody || ''
              const parsed = parseNewsletterHtml(htmlContent, email.subject, email.from, email.date)

              // Store newsletter
              const { error: insertError } = await supabase
                .from('daily_repo')
                .insert({
                  source_type: 'newsletter',
                  source_email: email.from,
                  title: email.subject,
                  content: parsed.plainText,
                  raw_html: htmlContent,
                  newsletter_date: newsletterDate,
                })

              if (!insertError) {
                results.newslettersFetched++
              }
            } catch (err) {
              console.error(`[ManageSources] Error processing email:`, err)
            }
          }
        }
      } catch (err) {
        console.error('[ManageSources] Error fetching from new sources:', err)
        results.errors.push('Failed to fetch from new sources: ' + (err instanceof Error ? err.message : 'Unknown error'))
      }
    }

    return NextResponse.json(results)
  } catch (error) {
    console.error('[ManageSources] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
