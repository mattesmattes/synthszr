import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { linkHrefs, rankSources, sourceHost, type SourcePost } from '@/lib/admin/top-sources'

export const maxDuration = 60

const PAGE = 100 // Post-Inhalte sind groß; PostgREST kappt ohnehin bei 1000.
const ALLOWED_DAYS = new Set([30, 90, 365, 0])

/** GET ?days=30|90|365|0 (0 = gesamter Zeitraum) → Top-50-Quellen der veröffentlichten Posts. */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request)
  if (authError) return authError

  const raw = Number(request.nextUrl.searchParams.get('days') ?? 90)
  const days = ALLOWED_DAYS.has(raw) ? raw : 90
  const since = days > 0 ? new Date(Date.now() - days * 86_400_000).toISOString() : null

  const supabase = createAdminClient()
  const posts: SourcePost[] = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('generated_posts')
      .select('id, created_at, content')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1)
    if (since) q = q.gte('created_at', since)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    posts.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }

  let totalLinks = 0
  const hosts = new Set<string>()
  for (const p of posts) {
    const seen = new Set<string>()
    for (const href of linkHrefs(p.content)) {
      const host = sourceHost(href)
      if (!host || seen.has(href.trim())) continue
      seen.add(href.trim())
      hosts.add(host)
      totalLinks += 1
    }
  }

  return NextResponse.json({
    days,
    postCount: posts.length,
    totalLinks,
    distinctSources: hosts.size,
    firstPostAt: posts.at(-1)?.created_at ?? null,
    sources: rankSources(posts, 50),
  })
}
