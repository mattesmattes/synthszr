import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { DEFAULT_COVER_ANIMATION_CONFIG } from '@/lib/types/cover-animation'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'cover_animation_config')
    .single()

  return NextResponse.json(data?.value || DEFAULT_COVER_ANIMATION_CONFIG)
}

export async function PUT(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const config = await request.json()

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('settings')
      .upsert({
        key: 'cover_animation_config',
        value: config,
      }, { onConflict: 'key' })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, config })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
