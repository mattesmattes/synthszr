import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('subscriber_language_changes')
    .select('id, subscriber_id, email, old_language, new_language, changed_at')
    .order('changed_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[language-changes] query error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ changes: data || [] })
}
