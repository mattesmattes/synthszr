import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  const sb = createAdminClient()
  const { data: recent } = await sb.from('attribution_qa_flags')
    .select('slug, current_vendor, action, merged_into_slug, suggested_company, confidence, reasoning, created_at')
    .order('created_at', { ascending: false }).limit(50)
  const counts: Record<string, number> = { merged: 0, flagged: 0, kept: 0, aliased: 0 }
  for (const r of recent ?? []) counts[r.action as string] = (counts[r.action as string] ?? 0) + 1
  return NextResponse.json({ counts, recent: recent ?? [] })
}
