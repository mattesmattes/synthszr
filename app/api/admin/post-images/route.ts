/**
 * Post Images API — Security-Stufe 2 (Welle 1b/1d)
 *
 * GET: Liefert Thumbnail-Zuordnung (id, article_index, article_queue_item_id)
 * für einen Post. Ersetzt den direkten Browser-anon-Zugriff aus
 * app/admin/newsletter-send/page.tsx (checkThumbnailStatus).
 * DELETE: Löscht post_images für einen Post, optional gefiltert auf
 * bestimmte generation_status-Werte ({ postId, statuses? }). Ersetzt den
 * direkten Browser-anon-Zugriff aus app/admin/page.tsx (GenerateImagesButton).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const postId = searchParams.get('postId')
  if (!postId) return NextResponse.json({ error: 'postId erforderlich' }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('post_images')
    .select('id, article_index, article_queue_item_id')
    .eq('post_id', postId)
    .eq('image_type', 'article_thumbnail')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ images: data ?? [] })
}

export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { postId, statuses } = await request.json()
  if (!postId) return NextResponse.json({ error: 'postId erforderlich' }, { status: 400 })

  const supabase = createAdminClient()
  let query = supabase.from('post_images').delete().eq('post_id', postId)
  if (Array.isArray(statuses) && statuses.length > 0) {
    query = query.in('generation_status', statuses)
  }
  const { error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
