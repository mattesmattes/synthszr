import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const locale = searchParams.get('locale') || 'de'

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('podcast_personality_state')
    .select('*')
    .eq('locale', locale)
    .single()

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Return data or null (no state yet = no episodes generated)
  return NextResponse.json({ personality: data || null })
}
