import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import type { TipPromoConfig } from '@/lib/tip-promos/types'

export const runtime = 'nodejs'

const DEFAULT: TipPromoConfig = { mode: 'rotate', constantId: null }

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'tip_promo_config')
    .maybeSingle()
  return NextResponse.json({ config: (data?.value as TipPromoConfig) ?? DEFAULT })
}

export async function PUT(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const body = await request.json()
  const config: TipPromoConfig = {
    mode: body.mode === 'constant' ? 'constant' : 'rotate',
    constantId: body.constantId ?? null,
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('settings')
    .upsert({ key: 'tip_promo_config', value: config }, { onConflict: 'key' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ config })
}
