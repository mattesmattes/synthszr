/**
 * Content Translations API — Security-Stufe 2 (Welle 1d)
 *
 * GET: Liefert language_code/translation_status für einen generated_post.
 * Ersetzt den direkten Browser-anon-Zugriff aus
 * app/admin/newsletter-send/page.tsx (checkTranslationStatus).
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
    .from('content_translations')
    .select('language_code, translation_status')
    .eq('generated_post_id', postId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ translations: data ?? [] })
}
