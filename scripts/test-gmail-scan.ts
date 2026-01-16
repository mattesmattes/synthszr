import { createClient } from '@supabase/supabase-js'
import { GmailClient } from '../lib/gmail/client'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function testScan() {
  // Get Gmail token
  const { data: token } = await supabase
    .from('gmail_tokens')
    .select('refresh_token')
    .limit(1)
    .single()

  if (!token) {
    console.log('No Gmail token found')
    return
  }

  const gmail = new GmailClient(token.refresh_token)

  // Scan last 2 days
  const twoDaysAgo = new Date()
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)

  console.log('Scanning emails since:', twoDaysAgo.toISOString().split('T')[0])

  const senders = await gmail.scanUniqueSenders(twoDaysAgo, 7, 500)
  console.log('Total unique senders found:', senders.length)

  if (senders.length > 0) {
    console.log('\nFirst 10 senders:')
    senders.slice(0, 10).forEach(s => console.log(' -', s.email, '(' + s.count + ' emails)'))
  }

  // Get sources
  const { data: sources } = await supabase
    .from('newsletter_sources')
    .select('email')
    .eq('enabled', true)

  const sourceEmails = new Set((sources || []).map(s => s.email.toLowerCase()))

  // Filter
  const unfetched = senders.filter(s => !sourceEmails.has(s.email.toLowerCase()))
  console.log('\nAfter filtering out', sourceEmails.size, 'sources:', unfetched.length, 'remaining')

  if (unfetched.length > 0) {
    console.log('\nUnfetched senders (first 10):')
    unfetched.slice(0, 10).forEach(s => console.log(' -', s.email, '(' + s.count + ' emails)'))
  } else {
    console.log('\nNo unfetched senders found - all are already sources')
  }
}

testScan().catch(console.error)
