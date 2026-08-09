import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { requireValidOrigin } from '@/lib/security/origin-check'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePostPaths, type PostSource } from '@/lib/comments/service'

/**
 * Moderations-Queue für „Eure Takes".
 *
 * GET  ?status=pending|published|rejected|pending_verify|recent  &q=Suchbegriff
 *   - status = ein echter Status ODER 'recent' (alle Takes der letzten 3 Tage,
 *     statusübergreifend).
 *   - q = Volltextsuche über Kommentartext UND Anzeigename (optional, kombinierbar).
 * PATCH { id, action: approve|hide|reject|delete|edit, body? }
 *   - approve → published (sichtbar), hide/reject → rejected (unsichtbar),
 *     delete → Hard-Delete (DSGVO Art. 17, entfernt die Zeile wirklich),
 *     edit → Kommentartext ändern (body).
 */
const SELECT_COLS =
  'id, post_source, post_id, display_name, body, section_headline, status, moderation_verdict, moderation_reason, created_at, published_at'

const RECENT_DAYS = 3

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const params = new URL(request.url).searchParams
  const status = params.get('status') ?? 'pending'
  const rawQ = params.get('q') ?? ''
  // In der PostgREST-.or()-Filtersyntax haben , ( ) und der Backslash Bedeutung;
  // aus dem Suchbegriff entfernen, damit er den Filter nicht sprengt. % ist mein
  // Wildcard-Rahmen und wird ebenfalls entfernt.
  const q = rawQ.replace(/[,()\\%*]/g, ' ').trim().slice(0, 100)

  if (!['pending', 'published', 'rejected', 'pending_verify', 'recent'].includes(status)) {
    return NextResponse.json({ error: 'Ungültiger Status' }, { status: 400 })
  }

  const supabase = createAdminClient()
  let query = supabase
    .from('post_comments')
    .select(SELECT_COLS)
    .order('created_at', { ascending: false })
    .limit(200)

  if (status === 'recent') {
    const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString()
    query = query.gte('created_at', since)
  } else {
    query = query.eq('status', status)
  }
  if (q) query = query.or(`body.ilike.%${q}%,display_name.ilike.%${q}%`)

  const { data, error } = await query
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
  action: z.enum(['approve', 'hide', 'reject', 'delete', 'edit']),
  body: z.string().min(1).max(4000).optional(),
}).strict()

export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  // CSRF: auch die Admin-Schreibroute folgt dem Hausmuster (Origin-Check vor
  // jeder Zustandsänderung), obwohl sie hinter der Session sitzt.
  const originError = requireValidOrigin(request)
  if (originError) return originError

  const raw = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Ungültige Eingabe' }, { status: 400 })
  const { id, action, body } = parsed.data

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

  // Text bearbeiten: nur der Kommentartext ändert sich, der Status bleibt.
  if (action === 'edit') {
    if (!body || !body.trim()) {
      return NextResponse.json({ error: 'Leerer Text' }, { status: 400 })
    }
    const { data: updated, error } = await supabase
      .from('post_comments')
      .update({ body: body.trim() })
      .eq('id', id)
      .select('post_source, post_id, status')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!updated) return NextResponse.json({ error: 'Kommentar nicht gefunden' }, { status: 404 })
    const row = updated as { post_source: PostSource; post_id: string; status: string }
    // Nur wenn der Kommentar öffentlich sichtbar ist, ändert sich die Seite.
    if (row.status === 'published') await revalidatePostPaths(supabase, row.post_source, row.post_id)
    return NextResponse.json({ ok: true, status: row.status })
  }

  // Sichtbarkeit: approve → published (sichtbar), hide/reject → rejected (unsichtbar).
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
  // Sichtbar-Machen UND Ausblenden ändern die öffentliche Seite — beide revalidieren.
  await revalidatePostPaths(supabase, row.post_source, row.post_id)
  return NextResponse.json({ ok: true, status: nextStatus })
}
