/**
 * Post Podcasts API — Security-Stufe 2 (Welle 1c)
 *
 * Serverseitige, authentifizierte UPSERT für post_podcasts — ersetzt den
 * direkten Browser-anon-Zugriff aus app/admin/generated-articles/edit/[id]/page.tsx
 * (Speichern des generierten Podcast-Scripts).
 *
 * POST: UPSERT auf post_podcasts (onConflict: post_id,locale)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const { post_id, locale, script_content, status, duration_seconds } = await request.json()
  if (!post_id || !locale) {
    return NextResponse.json({ error: 'post_id und locale erforderlich' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('post_podcasts')
    .upsert(
      {
        post_id,
        locale,
        script_content,
        status,
        duration_seconds,
      },
      { onConflict: 'post_id,locale' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
