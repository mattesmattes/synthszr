/**
 * Translation Queue API — Security-Stufe 2 (Welle 1d)
 *
 * GET: Liefert offene (pending/processing) Queue-Items für einen
 * generated_post. Ersetzt den direkten Browser-anon-Zugriff aus
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
    .from('translation_queue')
    .select('target_language, status')
    .eq('content_type', 'generated_post')
    .eq('content_id', postId)
    .in('status', ['pending', 'processing'])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}
