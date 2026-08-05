/**
 * Nachverlinkung bestehender Artikel gegen den GANZEN Begriffsbestand.
 *
 * WARUM ES DAS BRAUCHT (Befund 2026-08-05, an Prod gemessen): null von 219
 * veröffentlichten Posts hatten glossaryLink-Marks. Die Injektion beim Speichern
 * ist nicht defekt — sie greift nur für Begriffe, die in DIESEM Moment als
 * bestätigter Kandidat vorlagen. Daraus folgen zwangsläufig zwei Lücken:
 *
 *   - Altposts haben nie eine Kandidatenliste gesehen, bekommen also nie Marks.
 *   - Ein Begriff, der SPÄTER entsteht (Artikel-Crawl), erreicht keinen älteren
 *     Artikel mehr — obwohl er dort im Text steht.
 *
 * „Verlinkung beim Speichern" kann deshalb strukturell nicht „immer verlinkt"
 * ergeben. Dieser Lauf schließt die Lücke: er nimmt ALLE veröffentlichten
 * Begriffe und legt sie über ALLE veröffentlichten Artikel.
 *
 * SCHREIBT DIREKT per service_role, nicht über die PATCH-Route. Das ist Absicht:
 * die Route führt edit_history und speist damit das Edit-Learning. Eine
 * maschinelle Mark-Injektion als „menschliche Bearbeitung" zu lernen würde die
 * Mustererkennung mit Rauschen füllen.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { injectGlossaryMarks } from '@/lib/glossary/inject-marks'
import { safeParseJSON } from '@/lib/utils/safe-json'
import type { GlossaryMatcherTerm } from '@/lib/glossary/types'

type AdminClient = ReturnType<typeof createAdminClient>

/** Artikel pro Lauf. Reine Textarbeit ohne Modell-Aufruf, aber jeder Post ist ein
 *  Lese- und ein Schreibvorgang — 25 halten den Request klar unter dem Limit und
 *  ergeben bei 219 Artikeln neun Runden. */
export const POSTS_PER_BACKFILL = 25

/**
 * Legt die Marks über EINEN Artikeltext.
 *
 * `changed` ist der wichtigste Teil der Rückgabe: ohne diese Unterscheidung würde
 * der Lauf alle Artikel neu schreiben, auch die, in denen kein Begriff vorkommt —
 * sinnlose Schreiblast und lauter geänderte Zeitstempel. Verglichen wird das
 * serialisierte JSON, weil injectGlossaryMarks ein neues Objekt zurückgibt und ein
 * Referenzvergleich damit immer „geändert" meldete.
 */
export function linkPostContent(
  content: unknown,
  terms: GlossaryMatcherTerm[],
  reserved: string[],
): { content: unknown; changed: boolean } {
  if (!content || typeof content !== 'object' || terms.length === 0) {
    return { content, changed: false }
  }
  try {
    const before = JSON.stringify(content)
    const injected = injectGlossaryMarks(content, terms.map((t) => t.slug), terms, { reserved })
    return { content: injected, changed: JSON.stringify(injected) !== before }
  } catch (err) {
    // Ein einzelner unlesbarer Artikel darf einen Lauf über 219 nicht abbrechen.
    console.error('[GlossaryBackfill] Injektion fehlgeschlagen:', err)
    return { content, changed: false }
  }
}

export interface BackfillResult {
  /** Slugs der Artikel, die neue Marks bekommen haben. */
  linked: string[]
  /** Geprüft, aber unverändert (kein Begriff im Text oder schon verlinkt). */
  unchanged: number
  /** Noch nicht geprüfte Artikel. */
  remaining: number
  cursor: string | null
}

/**
 * Arbeitet die nächsten Artikel ab. Der Cursor ist `created_at` des letzten
 * geprüften Artikels — derselbe Mechanismus wie im Artikel-Crawl, damit ein
 * abgebrochener Lauf fortsetzen kann statt von vorn zu beginnen.
 *
 * Reihenfolge: neueste zuerst. Ein halber Lauf hat damit die Artikel erledigt,
 * die am meisten gelesen werden.
 */
export async function backfillGlossaryLinks(
  supabase: AdminClient,
  terms: GlossaryMatcherTerm[],
  reserved: string[],
  cursor: string | null,
  limit: number = POSTS_PER_BACKFILL,
): Promise<BackfillResult> {
  let query = supabase
    .from('generated_posts')
    .select('id, slug, content, created_at')
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (cursor) query = query.lt('created_at', cursor)

  const { data, error } = await query
  if (error) throw new Error(`Artikel nicht ladbar: ${error.message}`)

  const rows = (data ?? []) as Array<{ id: string; slug: string; content: unknown; created_at: string }>
  const linked: string[] = []
  let unchanged = 0
  let lastCursor = cursor

  for (const post of rows) {
    lastCursor = post.created_at
    const parsed = typeof post.content === 'string' ? safeParseJSON(post.content) : post.content
    const result = linkPostContent(parsed, terms, reserved)
    if (!result.changed) { unchanged++; continue }

    // Als String schreiben, wie der Speicherpfad: content ist in dieser Tabelle
    // serialisiertes JSON, kein JSONB.
    const { error: upError } = await supabase
      .from('generated_posts')
      .update({ content: JSON.stringify(result.content) })
      .eq('id', post.id)
    if (upError) {
      console.error(`[GlossaryBackfill] ${post.slug} nicht speicherbar:`, upError.message)
      unchanged++
      continue
    }
    linked.push(post.slug)
  }

  const { count } = await supabase
    .from('generated_posts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .lt('created_at', lastCursor ?? '9999-12-31')

  return { linked, unchanged, remaining: count ?? 0, cursor: lastCursor }
}
