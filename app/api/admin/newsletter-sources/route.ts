import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

// Serverseitige, authentifizierte CRUD für newsletter_sources — ersetzt den
// direkten Browser-anon-Zugriff (Security-Stufe 2: Tabelle ist RLS-gesperrt).

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('newsletter_sources')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ sources: data ?? [] })
}

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  const body = await request.json()
  const supabase = createAdminClient()

  // Batch-Import (Gmail-Scan): { sources: [...] }
  if (Array.isArray(body.sources)) {
    const { error } = await supabase.from('newsletter_sources').insert(body.sources)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // Einzel-Insert (manuelles Hinzufügen): { email, name, enabled }
  const { error } = await supabase.from('newsletter_sources').insert(body)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function PATCH(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  const { id, enabled } = await request.json()
  if (!id) return NextResponse.json({ error: 'id erforderlich' }, { status: 400 })
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('newsletter_sources')
    .update({ enabled })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id erforderlich' }, { status: 400 })
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('newsletter_sources')
    .delete()
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
