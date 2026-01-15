import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GmailClient } from '@/lib/gmail/client'
import { getSession } from '@/lib/auth/session'

// Sources without emails from the last analysis
const SOURCES_WITHOUT_EMAILS = [
  { email: 'stephanie@theinformation.com', name: 'Stephanie Palazzolo (AI Agenda)' },
  { email: 'aaron@theinformation.com', name: 'Aaron Holmes (Applied AI)' },
  { email: 'hello@digest.producthunt.com', name: 'Product Hunt Weekly' },
  { email: 'noreply@medium.com', name: 'Medium Daily Digest' },
  { email: 'newsletters@medium.com', name: 'The Medium Newsletter' },
  { email: 'newsletters@medium.com', name: 'The UX Collective Newsletter' },
  { email: 'circulationoffers@email.globe.com', name: 'The Boston Globe' },
  { email: 'ben@ben-evans.com', name: "Benedecit's Newsletter" },
  { email: 'getfivethings+running@substack.com', name: 'Five Things' },
  { email: 'profgmarkets@mail.beehiiv.com', name: 'Prof G' },
  { email: 'mattes.schrader@oh-so.com', name: 'Mattes Schrader' },
  { email: 'publishing@email.mckinsey.com', name: 'McKinsey Highlights' },
  { email: 'aisupremacy+siphon@substack.com', name: 'AI Supremacy (Michael Spencer)' },
  { email: 'mlpills@substack.com', name: 'Machine Learning Pills' },
  { email: 'exponentialview@substack.com', name: 'Azeem Azhar, Exponential View' },
  { email: 'techemails@substack.com', name: 'Internal Tech Emails' },
  { email: 'artofsaience@substack.com', name: 'Sairam from The Art of Saience' },
  { email: 'email@stratechery.com', name: 'Ben Thompson' },
  { email: 'exponentialview@substack.com', name: 'Exponential View' },
  { email: 'newcomer@substack.com', name: 'Newcomer' },
  { email: 'gerald.hensel@davaidavai.com', name: 'Davai Davai' },
  { email: 'teng@agents.chainofthought.xyz', name: 'Teng Yan | Chain of Thought' },
  { email: 'aisupremacy+guides@substack.com', name: 'Michael Spencer and Hodman Murad from AI Supremacy' },
  { email: 'scarletink@substack.com', name: 'Scarlet Ink' },
]

export async function GET() {
  // Require admin session
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()

    // Get Gmail refresh token
    const { data: tokenData, error: tokenError } = await supabase
      .from('gmail_tokens')
      .select('refresh_token')
      .limit(1)
      .single()

    if (tokenError || !tokenData?.refresh_token) {
      return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 })
    }

    const gmail = new GmailClient(tokenData.refresh_token)

    // Scan last 30 days
    const recentSenders = await gmail.scanUniqueSenders(30, 1000)

    const results: Array<{
      source: string
      currentEmail: string
      matches: Array<{ email: string; name: string; count: number; reason: string }>
      recommendation: string
    }> = []

    for (const source of SOURCES_WITHOUT_EMAILS) {
      const sourceName = source.name.toLowerCase().replace(/[^a-z0-9]/g, '')
      const sourceEmailUser = source.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '')

      const matches: Array<{ email: string; name: string; count: number; reason: string }> = []

      for (const sender of recentSenders) {
        const senderName = sender.name.toLowerCase().replace(/[^a-z0-9]/g, '')
        const senderEmailUser = sender.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '')
        const senderDomain = sender.email.split('@')[1] || ''

        // Check for various matches
        if (senderName === sourceName && sourceName.length > 5) {
          matches.push({ email: sender.email, name: sender.name, count: sender.count, reason: 'exact name match' })
        } else if (senderName.includes(sourceName) && sourceName.length > 5) {
          matches.push({ email: sender.email, name: sender.name, count: sender.count, reason: 'name contains source' })
        } else if (sourceName.includes(senderName) && senderName.length > 5) {
          matches.push({ email: sender.email, name: sender.name, count: sender.count, reason: 'source contains name' })
        } else if (senderDomain.includes(sourceEmailUser) && sourceEmailUser.length > 4) {
          matches.push({ email: sender.email, name: sender.name, count: sender.count, reason: 'domain contains identifier' })
        } else if (senderEmailUser.includes(sourceEmailUser) && sourceEmailUser.length > 4) {
          matches.push({ email: sender.email, name: sender.name, count: sender.count, reason: 'email user contains identifier' })
        }
      }

      // Sort by count (most emails first) and take top 3
      matches.sort((a, b) => b.count - a.count)
      const topMatches = matches.slice(0, 3)

      let recommendation = 'DISABLE - no matches found'
      if (topMatches.length > 0) {
        if (topMatches[0].reason === 'exact name match' || topMatches[0].count >= 3) {
          recommendation = `UPDATE to: ${topMatches[0].email}`
        } else {
          recommendation = `REVIEW - possible match: ${topMatches[0].email}`
        }
      }

      results.push({
        source: source.name,
        currentEmail: source.email,
        matches: topMatches,
        recommendation
      })
    }

    return NextResponse.json({
      success: true,
      totalSenders: recentSenders.length,
      analysis: results
    })
  } catch (error) {
    console.error('Error analyzing sources:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
