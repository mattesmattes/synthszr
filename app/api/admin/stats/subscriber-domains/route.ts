import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const supabase = createAdminClient()

  // Page through all active subscribers — Supabase default limit is 1000
  const PAGE = 1000
  let from = 0
  const emails: string[] = []
  while (true) {
    const { data, error } = await supabase
      .from('subscribers')
      .select('email')
      .eq('status', 'active')
      .range(from, from + PAGE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) break
    emails.push(...data.map(r => r.email).filter(Boolean))
    if (data.length < PAGE) break
    from += PAGE
  }

  const counts = new Map<string, number>()
  for (const email of emails) {
    const at = email.lastIndexOf('@')
    if (at < 0) continue
    const domain = email.slice(at + 1).toLowerCase().trim()
    if (!domain) continue
    counts.set(domain, (counts.get(domain) ?? 0) + 1)
  }

  const top = Array.from(counts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)

  return NextResponse.json({ total: emails.length, domains: top })
}
