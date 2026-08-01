/**
 * Edit History API — Security-Stufe 2 (Welle 1c)
 *
 * Serverseitige, authentifizierte SELECT/INSERT für edit_history — ersetzt
 * den direkten Browser-anon-Zugriff aus lib/edit-learning/history.ts
 * (ensureInitialEditHistory, recordEditVersion), aufgerufen von
 * app/admin/create-article/page.tsx und
 * app/admin/generated-articles/edit/[id]/page.tsx.
 *
 * Server-seitige Nutzung von edit_history (lib/edit-learning/retrieval.ts,
 * analyze-edits) läuft weiterhin unverändert über eigene service_role-Zugriffe.
 *
 * GET: Neueste edit_history-Zeile für einen Post (?postId=&select=)
 * POST: Neue edit_history-Version anlegen
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const postId = searchParams.get('postId')
  const select = searchParams.get('select') || 'version'
  if (!postId) {
    return NextResponse.json({ error: 'postId erforderlich' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('edit_history')
    .select(select)
    .eq('post_id', postId)
    .order('version', { ascending: false })
    .limit(1)
    .single()

  // PGRST116 = keine Zeile gefunden (erwartet für neue Posts) — kein Fehlerfall
  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data ?? null })
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const { post_id, version, content_before, content_after, ai_model, word_count_before, word_count_after } =
    await request.json()

  if (!post_id || version === undefined) {
    return NextResponse.json({ error: 'post_id und version erforderlich' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('edit_history').insert({
    post_id,
    version,
    content_before,
    content_after,
    ai_model,
    word_count_before,
    word_count_after,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
