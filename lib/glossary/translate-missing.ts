/**
 * Zieht fehlende Übersetzungen veröffentlichter Lexikonbegriffe nach.
 *
 * BEFUND 2026-08-06 (an Prod gemessen): 559 veröffentlichte Begriffe, 428
 * EN-Übersetzungen — 134 fehlen, `/en/glossary/git-worktree` zeigt deutschen
 * Text. Eine Übersetzung entsteht ausschließlich bei der FREIGABE eines
 * Begriffs (`applyGlossaryConfirmation` → `translatePublishedTerms`). Ein
 * Begriff, bei dem dieser Aufruf einmal gescheitert ist — oder der entstand,
 * bevor die Übersetzung eingebaut war — bleibt dauerhaft deutsch, weil ihn
 * nichts erneut anfasst.
 *
 * Bis zum Vormittag des 2026-08-06 zog ein Fehler in `confirm.ts` das
 * versehentlich mit: dort wurden ALLE bestätigten Slugs übersetzt, nicht nur
 * die frisch veröffentlichten. Das war teuer (106 Modellaufrufe je Durchlauf,
 * Ursache des Timeout-Hängers) — hat aber fehlende Übersetzungen nachgeholt.
 * Nach dem Fix braucht es diesen bewussten Weg, sonst wächst die Lücke mit
 * jedem gescheiterten Freigabe-Aufruf weiter.
 *
 * KOSTET MODELLAUFRUFE: ein Aufruf je Begriff. Deshalb als Job-Art mit
 * Zeitbudget, nicht als Einzelaufruf, und im Panel als kostenpflichtige
 * Handlung gekennzeichnet.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { translateTerm, SUPPORTED_GLOSSARY_LANGS } from '@/lib/glossary/translate'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Begriffe je Arbeitseinheit. Eins, wie bei der Begriffs-Erzeugung: ein
 * Modellaufruf dauert Sekunden, und der Tick soll nach jedem einzelnen sein
 * Zeitbudget prüfen können, statt 134 Aufrufe in einem Rutsch zu versuchen.
 */
export const TERMS_PER_TRANSLATION_UNIT = 1

export interface MissingTranslationResult {
  /** Slugs der in dieser Einheit übersetzten Begriffe. */
  done: string[]
  /** Slugs, deren Übersetzung fehlgeschlagen ist. */
  failed: string[]
  /** Noch offene Begriffe NACH dieser Einheit. */
  remaining: number
}

/**
 * Übersetzt die nächsten `limit` veröffentlichten Begriffe, denen eine
 * Übersetzung fehlt.
 *
 * Die Auswahl läuft über zwei schmale Abfragen (nur `id`/`slug` bzw. `term_id`)
 * und die Differenz in Node: PostgREST kann kein LEFT JOIN mit IS-NULL-Filter
 * über zwei Tabellen, und beide Listen sind klein (hunderte IDs), während ein
 * `select` mit `body` über den ganzen Bestand teuer wäre.
 */
export async function translateMissingTerms(
  supabase: AdminClient,
  limit: number = TERMS_PER_TRANSLATION_UNIT,
): Promise<MissingTranslationResult> {
  // Nur die erste Zielsprache: SUPPORTED_GLOSSARY_LANGS ist derzeit ['en'].
  // Ein Begriff gilt als übersetzt, sobald er für diese Sprache eine Zeile hat.
  const lang = SUPPORTED_GLOSSARY_LANGS[0]

  const { data: termRows, error: termError } = await supabase
    .from('glossary_terms')
    .select('id, slug')
    .eq('status', 'published')
    .order('slug')
  if (termError) throw new Error(`Begriffe nicht ladbar: ${termError.message}`)

  const { data: trRows, error: trError } = await supabase
    .from('glossary_term_translations')
    .select('term_id')
    .eq('language', lang)
  if (trError) throw new Error(`Übersetzungen nicht ladbar: ${trError.message}`)

  const translated = new Set(
    ((trRows ?? []) as Array<{ term_id: string }>).map((r) => r.term_id),
  )
  const missing = ((termRows ?? []) as Array<{ id: string; slug: string }>)
    .filter((t) => !translated.has(t.id))

  const batch = missing.slice(0, limit)
  const done: string[] = []
  const failed: string[] = []

  for (const term of batch) {
    try {
      await translateTerm(term.id, lang)
      done.push(term.slug)
    } catch (err) {
      // Weitermachen statt abbrechen: ein einzelner Begriff mit kaputtem body
      // (oder eine Modell-Überlast) darf den Lauf nicht anhalten. Der nächste
      // Tick versucht ihn erneut; bleibt es dabei, greift die
      // Fortschritt-Null-Erkennung des Jobs und der Lauf eskaliert.
      console.error(`[GlossaryTranslateMissing] ${term.slug} fehlgeschlagen:`, err)
      failed.push(term.slug)
    }
  }

  return { done, failed, remaining: Math.max(0, missing.length - batch.length) }
}
