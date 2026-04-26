import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '@/lib/auth/session'

export const runtime = 'nodejs'

type HourBucket = { hour: number; count: number }
type SourceBucket = { source: string; count: number }
type LastRun = { lastRun: string | null; minutesAgo: number | null }

const TASK_KEYS = ['newsletter_fetch', 'webcrawl_fetch', 'daily_analysis', 'post_generation', 'newsletter_send'] as const

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request)
  if (authError) return authError

  const supabase = createAdminClient()
  const { searchParams } = new URL(request.url)
  const dateParam = searchParams.get('date') ?? new Date().toISOString().slice(0, 10)

  const dayStart = `${dateParam}T00:00:00.000Z`
  const dayEnd = `${dateParam}T23:59:59.999Z`
  const now = Date.now()

  const cron: Record<string, LastRun> = {}
  for (const key of TASK_KEYS) {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', `last_run_${key}`)
      .maybeSingle()
    const ts = (data?.value as { timestamp?: string } | null)?.timestamp ?? null
    cron[key] = {
      lastRun: ts,
      minutesAgo: ts ? Math.round((now - new Date(ts).getTime()) / 60000) : null,
    }
  }

  const { data: digestRow } = await supabase
    .from('daily_digests')
    .select('id, digest_date, word_count, sources_used, created_at, analysis_content')
    .eq('digest_date', dateParam)
    .maybeSingle()

  const digest = digestRow
    ? {
        exists: true,
        id: digestRow.id,
        createdAt: digestRow.created_at,
        wordCount: digestRow.word_count,
        sourcesUsed: Array.isArray(digestRow.sources_used) ? digestRow.sources_used.length : 0,
        analysisCharCount: typeof digestRow.analysis_content === 'string' ? digestRow.analysis_content.length : 0,
      }
    : { exists: false }

  const { count: dailyRepoTotal } = await supabase
    .from('daily_repo')
    .select('id', { count: 'exact', head: true })
    .eq('newsletter_date', dateParam)

  const { data: dailyRepoRows } = await supabase
    .from('daily_repo')
    .select('collected_at, source_email, source_type')
    .eq('newsletter_date', dateParam)
    .limit(5000)

  const dailyRepoByHour = new Map<number, number>()
  const dailyRepoBySource = new Map<string, number>()
  const dailyRepoBySourceType = new Map<string, number>()
  for (const row of dailyRepoRows ?? []) {
    if (row.collected_at) {
      const h = new Date(row.collected_at).getUTCHours()
      dailyRepoByHour.set(h, (dailyRepoByHour.get(h) ?? 0) + 1)
    }
    const src = row.source_email || '(no email)'
    dailyRepoBySource.set(src, (dailyRepoBySource.get(src) ?? 0) + 1)
    const st = row.source_type || '(unknown)'
    dailyRepoBySourceType.set(st, (dailyRepoBySourceType.get(st) ?? 0) + 1)
  }

  const { count: queueTotal } = await supabase
    .from('news_queue')
    .select('id', { count: 'exact', head: true })
    .gte('queued_at', dayStart)
    .lte('queued_at', dayEnd)

  const { count: queueWithRepo } = await supabase
    .from('news_queue')
    .select('id', { count: 'exact', head: true })
    .gte('queued_at', dayStart)
    .lte('queued_at', dayEnd)
    .not('daily_repo_id', 'is', null)

  const { data: queueRows } = await supabase
    .from('news_queue')
    .select('queued_at, daily_repo_id, source_identifier, status')
    .gte('queued_at', dayStart)
    .lte('queued_at', dayEnd)
    .limit(5000)

  const queueByHour = new Map<number, number>()
  const queueBySource = new Map<string, number>()
  const queueByStatus = new Map<string, number>()
  for (const row of queueRows ?? []) {
    if (row.queued_at) {
      const h = new Date(row.queued_at).getUTCHours()
      queueByHour.set(h, (queueByHour.get(h) ?? 0) + 1)
    }
    const src = row.source_identifier || '(unknown)'
    queueBySource.set(src, (queueBySource.get(src) ?? 0) + 1)
    const st = row.status || '(none)'
    queueByStatus.set(st, (queueByStatus.get(st) ?? 0) + 1)
  }

  const toBuckets = (m: Map<number, number>): HourBucket[] =>
    Array.from(m.entries())
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour - b.hour)

  const toSourceBuckets = (m: Map<string, number>, limit = 15): SourceBucket[] =>
    Array.from(m.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)

  return NextResponse.json({
    date: dateParam,
    timezoneNote: 'All hour buckets are UTC. Berlin = UTC+1 (winter) / UTC+2 (summer).',
    cron,
    daily_repo: {
      totalForDate: dailyRepoTotal ?? 0,
      byHourUTC: toBuckets(dailyRepoByHour),
      bySource: toSourceBuckets(dailyRepoBySource),
      bySourceType: Array.from(dailyRepoBySourceType.entries()).map(([type, count]) => ({ type, count })),
    },
    daily_digests: digest,
    news_queue: {
      totalForDate: queueTotal ?? 0,
      withDailyRepoId: queueWithRepo ?? 0,
      orphanWithoutDailyRepoId: (queueTotal ?? 0) - (queueWithRepo ?? 0),
      byHourUTC: toBuckets(queueByHour),
      byStatus: Array.from(queueByStatus.entries()).map(([status, count]) => ({ status, count })),
      bySource: toSourceBuckets(queueBySource),
    },
  })
}
