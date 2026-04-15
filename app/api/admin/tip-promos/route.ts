import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('tip_promos')
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
    .from('tip_promos')
    .insert({
      name: body.name ?? 'Neuer Tipp',
      headline: body.headline ?? 'TIPP DES TAGES',
      body: body.body ?? '',
      link_url: body.link_url ?? '',
      gradient_from: body.gradient_from ?? '#B4E37A',
      gradient_to: body.gradient_to ?? '#F6E23E',
      gradient_direction: body.gradient_direction ?? 'to bottom',
      text_color: body.text_color ?? '#1a1a0a',
      active: body.active ?? false,
      sort_order: body.sort_order ?? 0,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ promo: data })
}
