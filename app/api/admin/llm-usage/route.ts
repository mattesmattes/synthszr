import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { aggregateUsage, type UsageRow } from '@/lib/ai/usage-report'

/**
 * GET /api/admin/llm-usage?days=7 — Token- und Kostenprotokoll, aggregiert.
 *
 * Seitenweise laden: PostgREST kappt still bei 1000 Zeilen, und ein Tag mit
 * Ghostwriter-Lauf (bis zu 40 Abschnitte) plus Glossar bringt es leicht auf
 * mehrere hundert Aufrufe.
 */
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const raw = parseInt(request.nextUrl.searchParams.get('days') ?? '7', 10)
  const days = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 90) : 7
  const since = new Date(Date.now() - days * 864e5).toISOString()

  const supabase = createAdminClient()
  const rows: UsageRow[] = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase
      .from('llm_usage')
      .select('created_at, use_case, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(off, off + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data?.length) break
    rows.push(...(data as unknown as UsageRow[]))
    if (data.length < 1000) break
  }

  return NextResponse.json({ days, ...aggregateUsage(rows) })
}
