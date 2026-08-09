import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePostPaths, type PostSource } from '@/lib/comments/service'

/**
 * Moderations-Queue für „Eure Takes".
 *
 * GET  ?status=pending  → Liste (Default: pending, die Freigabe-Queue)
 * PATCH { id, action: approve|reject|delete }
 *
 * approve veröffentlicht und revalidiert die Artikelseite; reject und delete
 * sind endgültige Redaktionsentscheidungen. delete existiert getrennt von
 * reject für den DSGVO-Fall: ein Leser will seinen Beitrag entfernt haben —
 * das ist keine inhaltliche Ablehnung und soll in der Statistik nicht so
 * aussehen.
 */
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const status = new URL(request.url).searchParams.get('status') ?? 'pending'
  if (!['pending', 'published', 'rejected', 'pending_verify'].includes(status)) {
    return NextResponse.json({ error: 'Ungültiger Status' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('post_comments')
    .select('id, post_source, post_id, display_name, body, section_headline, status, moderation_verdict, moderation_reason, created_at')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Artikel-Titel nachschlagen, damit die Queue lesbar ist. Zwei kleine
  // .in()-Abfragen (max 100 IDs — weit unter der 400er-URL-Grenze).
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const byTable: Record<string, string[]> = { posts: [], generated_posts: [] }
  for (const r of rows) byTable[r.post_source as string]?.push(r.post_id as string)
  const titles = new Map<string, string>()
  for (const table of ['posts', 'generated_posts'] as const) {
    const ids = [...new Set(byTable[table])]
    if (ids.length === 0) continue
    const { data: posts } = await supabase.from(table).select('id, title').in('id', ids)
    for (const p of (posts ?? []) as Array<{ id: string; title: string }>) titles.set(`${table}:${p.id}`, p.title)
  }

  return NextResponse.json({
    comments: rows.map((r) => ({
      ...r,
      post_title: titles.get(`${r.post_source}:${r.post_id}`) ?? null,
    })),
  })
}

const patchSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(['approve', 'reject', 'delete']),
}).strict()

export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Ungültige Eingabe' }, { status: 400 })
  const { id, action } = parsed.data

  const supabase = createAdminClient()
  const nextStatus = action === 'approve' ? 'published' : action === 'reject' ? 'rejected' : 'deleted'
  const { data: updated, error } = await supabase
    .from('post_comments')
    .update({
      status: nextStatus,
      published_at: action === 'approve' ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .select('post_source, post_id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated) return NextResponse.json({ error: 'Kommentar nicht gefunden' }, { status: 404 })

  const row = updated as { post_source: PostSource; post_id: string }
  // Freigabe UND Entfernen ändern die sichtbare Seite — beide revalidieren.
  if (action === 'approve' || action === 'delete' || action === 'reject') {
    await revalidatePostPaths(supabase, row.post_source, row.post_id)
  }
  return NextResponse.json({ ok: true, status: nextStatus })
}
