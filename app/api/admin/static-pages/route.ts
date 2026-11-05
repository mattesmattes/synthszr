/**
 * Static Pages Write API — Security-Stufe 2
 *
 * Serverseitiger, authentifizierter Upsert für static_pages — ersetzt den
 * direkten Browser-anon-Zugriff aus app/admin/why/page.tsx.
 * Der SELECT bleibt bewusst öffentlich (static_pages wird anon gelesen,
 * RLS bekommt später eine anon-SELECT-Policy) — hier wird nur der Write umgezogen.
 */

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { PUBLIC_LOCALES } from '@/lib/i18n/config'

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { slug, title, content } = await request.json()
  if (!slug) return NextResponse.json({ error: 'slug erforderlich' }, { status: 400 })
  if (!content || Object.keys(content).length === 0) {
    return NextResponse.json({ error: 'Inhalt ist leer' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('static_pages')
    .upsert(
      {
        slug,
        title: title || 'Why',
        content,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'slug' }
    )
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Statische Seiten laufen mit ISR (Impressum: revalidate 1 Tag) — ohne das
  // sähe man eine Änderung erst am nächsten Tag (Befund 2026-11-05).
  for (const locale of PUBLIC_LOCALES) revalidatePath(`/${locale}/${slug}`)
  return NextResponse.json({ page: data?.[0] ?? null })
}
