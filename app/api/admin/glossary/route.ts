/**
 * Admin-API fürs Fachbegriff-Lexikon (Task 17): Begriffsliste/-detail lesen
 * und Revisionen aus dem Aktualitäts-Cron (lib/glossary/review.ts) freigeben
 * oder verwerfen. Session-authentifiziert wie die übrigen Admin-Routen
 * (getSession(), 401 ohne Session — Muster aus post-images/route.ts).
 *
 * Task 16 (Übersetzung) modifiziert diese Datei zusätzlich (translateTerm-
 * Verdrahtung) — Methoden bleiben deshalb bewusst sauber getrennt.
 */
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

const PATCH_ACTIONS = ['accept_revision', 'discard_revision', 'hide', 'publish'] as const
type PatchAction = (typeof PATCH_ACTIONS)[number]

/** Begriffe sind bilingual (de/en, s. app/[lang]/glossary/[slug]/page.tsx) —
 *  eine Aktion, die den servierten Inhalt ändert, muss beide Locale-Pfade
 *  revalidieren, sonst zeigt die ISR-Seite (revalidate=900) bis zu 15 Minuten
 *  den alten Stand. Gleiches Muster wie app/api/stock-synthszr/route.ts, das
 *  aus demselben Grund /de/rankings/[slug] und /en/rankings/[slug] revalidiert. */
function revalidateGlossaryDetail(slug: string) {
  revalidatePath(`/de/glossary/${slug}`)
  revalidatePath(`/en/glossary/${slug}`)
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const slug = searchParams.get('slug')
  const supabase = createAdminClient()

  if (slug) {
    const { data, error } = await supabase
      .from('glossary_terms')
      .select('id, slug, canonical_name, status, review_state, last_reviewed_at, summary, body, pending_body')
      .eq('slug', slug)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Begriff nicht gefunden' }, { status: 404 })
    return NextResponse.json({ term: data })
  }

  const { data, error } = await supabase
    .from('glossary_terms')
    .select('id, slug, canonical_name, status, review_state, last_reviewed_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ terms: data ?? [] })
}

export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { slug, action } = await request.json() as { slug?: string; action?: PatchAction }
  if (!slug) return NextResponse.json({ error: 'slug erforderlich' }, { status: 400 })
  if (!action || !PATCH_ACTIONS.includes(action)) {
    return NextResponse.json({ error: `action muss eine von ${PATCH_ACTIONS.join(', ')} sein` }, { status: 400 })
  }

  const supabase = createAdminClient()

  if (action === 'accept_revision' || action === 'discard_revision') {
    // pending_body kann nicht per einzelnem update() auf sich selbst
    // referenziert werden (kein serverseitiges "body = pending_body" in
    // PostgREST) — deshalb erst lesen, dann schreiben.
    const { data: row, error: fetchError } = await supabase
      .from('glossary_terms')
      .select('pending_body')
      .eq('slug', slug)
      .maybeSingle()
    if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
    if (!row) return NextResponse.json({ error: 'Begriff nicht gefunden' }, { status: 404 })
    if (row.pending_body === null) {
      return NextResponse.json({ error: 'Keine offene Revision für diesen Begriff' }, { status: 400 })
    }

    const update = action === 'accept_revision'
      ? { body: row.pending_body, pending_body: null, review_state: 'ok', updated_at: new Date().toISOString() }
      : { pending_body: null, review_state: 'ok' }
    const { error } = await supabase.from('glossary_terms').update(update).eq('slug', slug)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Nur die Übernahme ändert den servierten body — Verwerfen lässt den
    // Live-Text unangetastet, dafür braucht es keine Revalidierung.
    if (action === 'accept_revision') revalidateGlossaryDetail(slug)
    return NextResponse.json({ ok: true })
  }

  // 'hide' | 'publish' — ändert status, also ebenfalls, was die Detailseite
  // serviert (getGlossaryTerm filtert auf status='published').
  const status = action === 'hide' ? 'hidden' : 'published'
  const { error } = await supabase
    .from('glossary_terms')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('slug', slug)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateGlossaryDetail(slug)
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { slug } = await request.json() as { slug?: string }
  if (!slug) return NextResponse.json({ error: 'slug erforderlich' }, { status: 400 })

  const supabase = createAdminClient()
  // Übersetzungen, Produkt- und News-Zuordnungen fallen per `on delete
  // cascade` mit (20260803120000_glossary_schema.sql:32,44,55).
  const { error } = await supabase.from('glossary_terms').delete().eq('slug', slug)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateGlossaryDetail(slug)
  return NextResponse.json({ ok: true })
}
