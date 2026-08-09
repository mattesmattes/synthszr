import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { requireValidOrigin } from '@/lib/security/origin-check'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePostPaths, type PostSource } from '@/lib/comments/service'

/**
 * Moderations-Queue für „Eure Takes".
 *
 * GET  ?status=pending  → Liste (Default: pending, die Freigabe-Queue)
 * PATCH { id, action: approve|reject|delete }
 *
 * approve veröffentlicht und revalidiert die Artikelseite; reject ist eine
 * inhaltliche Ablehnung (Status bleibt zur Rechenschaft erhalten). delete ist
 * der DSGVO-Fall (Art. 17): der Beitrag wird WIRKLICH aus der Tabelle entfernt
 * — Klarname, Text und subscriber_id verschwinden. Ein bloßes status='deleted'
 * wäre kein Löschen, sondern nur ein Ausblenden (Review-Befund 10).
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

  // CSRF: auch die Admin-Schreibroute folgt dem Hausmuster (Origin-Check vor
  // jeder Zustandsänderung), obwohl sie hinter der Session sitzt.
  const originError = requireValidOrigin(request)
  if (originError) return originError

  const body = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Ungültige Eingabe' }, { status: 400 })
  const { id, action } = parsed.data

  const supabase = createAdminClient()

  // DSGVO-Löschung: Zeile wirklich entfernen. Vorher post-Referenz holen, damit
  // danach noch revalidiert werden kann.
  if (action === 'delete') {
    const { data: target } = await supabase
      .from('post_comments').select('post_source, post_id').eq('id', id).maybeSingle()
    const { error: delError } = await supabase.from('post_comments').delete().eq('id', id)
    if (delError) return NextResponse.json({ error: delError.message }, { status: 500 })
    const row = target as { post_source: PostSource; post_id: string } | null
    if (row) await revalidatePostPaths(supabase, row.post_source, row.post_id)
    return NextResponse.json({ ok: true, status: 'deleted' })
  }

  const nextStatus = action === 'approve' ? 'published' : 'rejected'
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
  // Freigabe UND Ablehnung ändern die sichtbare Seite — beide revalidieren.
  await revalidatePostPaths(supabase, row.post_source, row.post_id)
  return NextResponse.json({ ok: true, status: nextStatus })
}
