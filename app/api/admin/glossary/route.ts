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
import { translateTerm, SUPPORTED_GLOSSARY_LANGS } from '@/lib/glossary/translate'

// Task 18 (Review Important 2): die 'translate'-Action führt seit dem neuen
// Admin-Button einen echten LLM-Call aus (translateTerm, max_tokens: 4096) —
// ohne deklarierte Laufzeit killt Vercel die Function beim Default-Timeout
// mitten im Aufruf, der upsert läuft nicht, und der Operator sieht ein 504
// ohne Hinweis, ob geschrieben wurde. Gleiches Muster wie die einzige andere
// LLM-Route dieser Größenordnung im Repo, process-queue/route.ts:10, und
// beide Glossar-Crons.
export const maxDuration = 300

const PATCH_ACTIONS = ['accept_revision', 'discard_revision', 'hide', 'publish', 'translate'] as const
type PatchAction = (typeof PATCH_ACTIONS)[number]

/** Begriffe sind bilingual (de/en, s. app/[lang]/glossary/[slug]/page.tsx) —
 *  eine Aktion, die den servierten Inhalt ändert, muss beide Locale-Pfade
 *  revalidieren, sonst zeigt die ISR-Seite (revalidate=900) bis zu 15 Minuten
 *  den alten Stand. Gleiches Muster wie app/api/stock-synthszr/route.ts, das
 *  aus demselben Grund /de/rankings/[slug] und /en/rankings/[slug] revalidiert.
 *
 *  Review-Fund Important 4: die A-Z-Indexseite (app/[lang]/glossary/page.tsx,
 *  revalidate=3600) listet denselben Begriff und muss aus demselben Grund
 *  mitrevalidiert werden — sonst verlinkt sie nach `delete` bis zu eine Stunde
 *  weiter auf einen 404, bleibt nach `hide` sichtbar oder fehlt nach `publish`. */
function revalidateGlossaryDetail(slug: string) {
  revalidatePath(`/de/glossary/${slug}`)
  revalidatePath(`/en/glossary/${slug}`)
  revalidatePath('/de/glossary')
  revalidatePath('/en/glossary')
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const slug = searchParams.get('slug')
  const supabase = createAdminClient()

  if (slug) {
    // illustration_url zusätzlich zu body/pending_body (Draft-Preview-Fix):
    // die Admin-Vorschau zeigt das Begriffsbild neben dem Text, damit vor
    // dem Veröffentlichen der komplette Eintrag sichtbar ist, nicht nur Text.
    const { data, error } = await supabase
      .from('glossary_terms')
      .select('id, slug, canonical_name, status, review_state, last_reviewed_at, summary, body, pending_body, illustration_url')
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

  const { slug, action, targetLang } = await request.json() as { slug?: string; action?: PatchAction; targetLang?: string }
  if (!slug) return NextResponse.json({ error: 'slug erforderlich' }, { status: 400 })
  if (!action || !PATCH_ACTIONS.includes(action)) {
    return NextResponse.json({ error: `action muss eine von ${PATCH_ACTIONS.join(', ')} sein` }, { status: 400 })
  }

  const supabase = createAdminClient()

  if (action === 'translate') {
    if (!targetLang) return NextResponse.json({ error: 'targetLang erforderlich' }, { status: 400 })
    // Review-Fund Minor 2+3 (Fix-Runde 1): ohne diese Whitelist-Prüfung lief
    // ein ungültiges/unsinniges targetLang (z. B. 'fr', oder 'de' — die
    // Quellsprache, nie gerendert) erst bis in translateTerm hinein und kam
    // von dort als 500 mit LLM-Modul-Fehlertext zurück, statt als
    // erkennbarer 400 — dasselbe Whitelist-Muster wie PATCH_ACTIONS oben.
    if (!(SUPPORTED_GLOSSARY_LANGS as readonly string[]).includes(targetLang)) {
      return NextResponse.json(
        { error: `targetLang muss eine von ${SUPPORTED_GLOSSARY_LANGS.join(', ')} sein` },
        { status: 400 },
      )
    }
    const { data: term, error: termError } = await supabase
      .from('glossary_terms')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()
    if (termError) return NextResponse.json({ error: termError.message }, { status: 500 })
    if (!term) return NextResponse.json({ error: 'Begriff nicht gefunden' }, { status: 404 })

    try {
      await translateTerm(term.id, targetLang)
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Übersetzung fehlgeschlagen' }, { status: 500 })
    }

    // Eine neue Übersetzung ändert, was getGlossaryTerm() für lang=targetLang
    // serviert (applyTermTranslation liest dieselbe Zeile) — dieselbe
    // Revalidierungspflicht wie bei accept_revision/hide/publish/DELETE oben,
    // deshalb dasselbe revalidateGlossaryDetail() statt einer sprachscharfen
    // Variante: einfacher, konsistent mit jeder anderen Aktion in dieser
    // Route, und das Revalidieren der unveränderten Sprache ist harmlos
    // (gleicher Inhalt wird neu gecacht).
    revalidateGlossaryDetail(slug)
    return NextResponse.json({ ok: true })
  }

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

    // last_reviewed_at MUSS in beiden Zweigen fortgeschrieben werden (Review-
    // Fund Important 1): sonst bleibt der Begriff unverändert an der Spitze
    // der Cron-Sortierung (review.ts:203) und der nächste Lauf sieht denselben
    // body/dieselben News wieder — bei discard_revision würde das denselben
    // abgelehnten Vorschlag täglich erneut erzeugen und der Redaktion erneut
    // vorlegen, statt die Ablehnung dauerhaft zu machen.
    const now = new Date().toISOString()
    const update = action === 'accept_revision'
      ? { body: row.pending_body, pending_body: null, review_state: 'ok', last_reviewed_at: now, updated_at: now }
      : { pending_body: null, review_state: 'ok', last_reviewed_at: now }
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
