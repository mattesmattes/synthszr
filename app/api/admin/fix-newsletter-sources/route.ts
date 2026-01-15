import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GmailClient } from '@/lib/gmail/client'

// Newsletter platform patterns to identify newsletters
const NEWSLETTER_PATTERNS = [
  'substack.com',
  'beehiiv.com',
  'buttondown.email',
  'mailchimp.com',
  'convertkit.com',
  'ghost.io',
  'getrevue.co',
  'medium.com',
  'patreon.com',
  'morningbrew.com',
  'theinformation.com',
  'techmeme.com',
  'therundown.ai',
  'semafor.com',
  'platformer.news',
  'foreignpolicy.com',
  'technologyreview.com',
  'newsletter',
]

interface EmailSender {
  email: string
  name: string
  subjects: string[]
  count: number
  latestDate: Date
}

function isLikelyNewsletter(sender: EmailSender): boolean {
  const emailLower = sender.email.toLowerCase()

  for (const pattern of NEWSLETTER_PATTERNS) {
    if (emailLower.includes(pattern)) return true
  }

  const newsletterKeywords = ['newsletter', 'digest', 'weekly', 'daily', 'edition', '#', 'briefing', 'roundup']
  for (const subject of sender.subjects) {
    const subjectLower = subject.toLowerCase()
    for (const keyword of newsletterKeywords) {
      if (subjectLower.includes(keyword)) return true
    }
  }

  return sender.count >= 3
}

export async function GET() {
  try {
    const supabase = createAdminClient()

    // 1. Get Gmail refresh token
    const { data: tokenData, error: tokenError } = await supabase
      .from('gmail_tokens')
      .select('refresh_token')
      .limit(1)
      .single()

    if (tokenError || !tokenData?.refresh_token) {
      return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 })
    }

    // 2. Fetch recent email senders (last 14 days)
    const gmail = new GmailClient(tokenData.refresh_token)
    const recentSenders = await gmail.scanUniqueSenders(14, 500)

    // 3. Get current newsletter sources
    const { data: currentSources, error: sourcesError } = await supabase
      .from('newsletter_sources')
      .select('id, email, name')
      .eq('enabled', true)

    if (sourcesError) {
      return NextResponse.json({ error: sourcesError.message }, { status: 500 })
    }

    // Create a map of current sources by email (lowercase)
    const sourcesByEmail = new Map<string, typeof currentSources[0]>()
    for (const source of currentSources || []) {
      sourcesByEmail.set(source.email.toLowerCase(), source)
    }

    // 4. Analyze
    const missingNewsletters: EmailSender[] = []
    const matchedSources = new Set<string>()

    for (const sender of recentSenders) {
      const emailLower = sender.email.toLowerCase()

      if (sourcesByEmail.has(emailLower)) {
        matchedSources.add(emailLower)
      } else if (isLikelyNewsletter(sender)) {
        missingNewsletters.push(sender)
      }
    }

    // Find sources without recent emails
    const sourcesWithNoEmails: typeof currentSources = []
    for (const source of currentSources || []) {
      if (!matchedSources.has(source.email.toLowerCase())) {
        sourcesWithNoEmails.push(source)
      }
    }

    // 5. Try to match missing sources with actual senders
    const corrections: Array<{
      sourceId: string
      oldEmail: string
      newEmail: string
      sourceName: string
      senderName: string
      confidence: string
    }> = []

    for (const source of sourcesWithNoEmails) {
      const sourceName = source.name.toLowerCase().replace(/[^a-z0-9]/g, '')
      const sourceEmailUser = source.email.toLowerCase().split('@')[0].replace(/[^a-z0-9]/g, '')

      for (const sender of recentSenders) {
        const senderName = sender.name.toLowerCase().replace(/[^a-z0-9]/g, '')
        const senderEmailUser = sender.email.toLowerCase().split('@')[0].replace(/[^a-z0-9]/g, '')

        if (sourcesByEmail.has(sender.email.toLowerCase())) continue

        let confidence = ''

        if (sourceName === senderName && sourceName.length > 3) {
          confidence = 'HIGH'
        } else if ((sourceName.includes(senderName) || senderName.includes(sourceName)) && Math.min(sourceName.length, senderName.length) > 4) {
          confidence = 'MEDIUM'
        } else if ((sourceEmailUser.includes(senderEmailUser) || senderEmailUser.includes(sourceEmailUser)) && Math.min(sourceEmailUser.length, senderEmailUser.length) > 4) {
          confidence = 'MEDIUM'
        }

        if (confidence) {
          corrections.push({
            sourceId: source.id,
            oldEmail: source.email,
            newEmail: sender.email,
            sourceName: source.name,
            senderName: sender.name,
            confidence
          })
          break
        }
      }
    }

    // 6. Apply HIGH confidence corrections automatically
    const applied: string[] = []
    const highConfidence = corrections.filter(c => c.confidence === 'HIGH')

    for (const c of highConfidence) {
      const { error } = await supabase
        .from('newsletter_sources')
        .update({ email: c.newEmail })
        .eq('id', c.sourceId)

      if (!error) {
        applied.push(`${c.sourceName}: ${c.oldEmail} -> ${c.newEmail}`)
      }
    }

    return NextResponse.json({
      success: true,
      stats: {
        totalSources: currentSources?.length || 0,
        sourcesWithEmails: matchedSources.size,
        sourcesWithoutEmails: sourcesWithNoEmails.length,
        potentialNewsletters: missingNewsletters.length,
      },
      sourcesWithoutEmails: sourcesWithNoEmails.map(s => ({
        email: s.email,
        name: s.name
      })),
      corrections: corrections.map(c => ({
        source: c.sourceName,
        oldEmail: c.oldEmail,
        newEmail: c.newEmail,
        senderName: c.senderName,
        confidence: c.confidence
      })),
      applied,
      suggestedAdditions: missingNewsletters
        .filter(s => s.count >= 2)
        .slice(0, 20)
        .map(s => ({
          email: s.email,
          name: s.name,
          count: s.count,
          subjects: s.subjects.slice(0, 2)
        }))
    })
  } catch (error) {
    console.error('Error analyzing newsletter sources:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

// POST to apply specific corrections
export async function POST(request: Request) {
  try {
    const { corrections } = await request.json()

    if (!corrections || !Array.isArray(corrections)) {
      return NextResponse.json({ error: 'corrections array required' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const results: string[] = []

    for (const c of corrections) {
      if (!c.sourceId || !c.newEmail) continue

      const { error } = await supabase
        .from('newsletter_sources')
        .update({ email: c.newEmail })
        .eq('id', c.sourceId)

      if (error) {
        results.push(`ERROR ${c.sourceId}: ${error.message}`)
      } else {
        results.push(`UPDATED: ${c.sourceId} -> ${c.newEmail}`)
      }
    }

    return NextResponse.json({ success: true, results })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
