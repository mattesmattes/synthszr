import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('ad_promos')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ promos: data })
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const body = await request.json()
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('ad_promos')
    .insert({
      name: body.name ?? 'Neue Promo',
      layout: body.layout ?? 'grid',
      title: body.title ?? '',
      body: body.body ?? '',
      cta_label: body.cta_label ?? '',
      link_url: body.link_url ?? '',
      eyebrow: body.eyebrow ?? null,
      image_left_url: body.image_left_url ?? null,
      image_left_bg: body.image_left_bg ?? '#00FFFF',
      image_left_blend: body.image_left_blend ?? 'normal',
      image_right_url: body.image_right_url ?? null,
      image_right_bg: body.image_right_bg ?? '#D4D4D4',
      image_right_blend: body.image_right_blend ?? 'normal',
      text_bg: body.text_bg ?? '#DDD0BC',
      text_color: body.text_color ?? '#000000',
      active: body.active ?? false,
      sort_order: body.sort_order ?? 0,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ promo: data })
}
