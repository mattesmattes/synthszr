import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session?.isAdmin) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  const { id, bundle_type } = await request.json()
  if (!id || (bundle_type !== null && bundle_type !== 'topic' && bundle_type !== 'recap')) {
    return NextResponse.json({ error: 'Ungültige Parameter' }, { status: 400 })
  }
  const { error } = await createAdminClient().from('news_queue').update({ bundle_type }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
