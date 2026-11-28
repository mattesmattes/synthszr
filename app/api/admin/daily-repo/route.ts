/**
 * Daily Repo API — Security-Stufe 2
 *
 * Serverseitige, authentifizierte CRUD für daily_repo — ersetzt den
 * direkten Browser-anon-Zugriff aus app/admin/daily-repo/page.tsx
 * (Tabelle ist admin-only, RLS folgt).
 *
 * GET:
 * - ohne ?date: Summary über alle Einträge (newsletter_date, source_type, content)
 *   für die Datums-Übersicht in der Sidebar
 * - mit ?date=YYYY-MM-DD: Alle Items für dieses Datum (select *)
 * DELETE: Entweder alle Items eines Datums ({ date }) oder einzelne Items ({ ids }) löschen
 * POST: Manuellen Artikel einfügen ({ sourceUrl, title, content, newsletterDate })
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  const sort = searchParams.get('sort') // optional: 'asc' — default bleibt 'desc' (bestehendes Verhalten)
  const supabase = createAdminClient()

  if (date) {
    const { data, error } = await supabase
      .from('daily_repo')
      .select('*')
      .eq('newsletter_date', date)
      .order('collected_at', { ascending: sort === 'asc' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ items: data ?? [] })
  }

  const { data, error } = await supabase
    .from('daily_repo')
    .select('newsletter_date, source_type, content')
    .order('newsletter_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const body = await request.json() as { date?: string; ids?: unknown }
  const supabase = createAdminClient()

  if (Array.isArray(body.ids)) {
    const ids = [...new Set(body.ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
    if (ids.length === 0) {
      return NextResponse.json({ error: 'Keine gültigen ids angegeben' }, { status: 400 })
    }
    const IN_CHUNK = 200
    let deleted = 0
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK)
      const { error } = await supabase.from('daily_repo').delete().in('id', chunk)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      deleted += chunk.length
    }
    return NextResponse.json({ ok: true, deleted })
  }

  if (!body.date) return NextResponse.json({ error: 'date oder ids erforderlich' }, { status: 400 })

  const { error } = await supabase.from('daily_repo').delete().eq('newsletter_date', body.date)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { sourceUrl, title, content, newsletterDate } = await request.json()
  if (!content?.trim()) return NextResponse.json({ error: 'content erforderlich' }, { status: 400 })
  if (!newsletterDate) return NextResponse.json({ error: 'newsletterDate erforderlich' }, { status: 400 })

  const supabase = createAdminClient()
  const { error } = await supabase.from('daily_repo').insert({
    source_type: 'article',
    source_url: sourceUrl?.trim() || null,
    title,
    content: content.trim(),
    newsletter_date: newsletterDate,
    source_email: null,
    newsletter_source_id: null,
    source_language: 'de',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
