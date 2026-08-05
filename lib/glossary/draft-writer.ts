/**
 * Erzeugt einen Lexikon-Begriff (Inhalt + optional Illustration + Produkt-
 * Zuordnung) und legt ihn als `status='draft'` an.
 *
 * Lag bis 2026-08-04 als private `tryGenerateDraft` in candidates.ts und lief
 * dort für JEDEN im Artikel erkannten unbekannten Begriff. Das war der Grund
 * für Befund B: pro Begriff zwei LLM-Calls (generateTermContent +
 * assignProducts), eine Bildgenerierung und ein Blob-Upload — sequenziell, ohne
 * Zeitbudget, in einer Phase mit 300s-Limit. Ein Artikel mit 25 neuen Begriffen
 * brauchte ~25 Minuten und wurde von Vercel gekillt, bevor die Kandidatenliste
 * geschrieben war.
 *
 * Jetzt ruft die Freigabe (lib/glossary/confirm.ts) diese Funktion auf, also nur
 * für Begriffe, die der Operator tatsächlich will. Die Aufrufmenge ist dort
 * gedeckelt — die Funktion selbst kennt kein Budget, sie macht genau einen
 * Begriff.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { generateTermContent } from '@/lib/glossary/generate'
import { generateGlossaryIllustration, uploadGlossaryIllustration } from '@/lib/gemini/image-generator'
import { isRetryableModelError } from '@/lib/glossary/retryable'
import { assignProducts } from '@/lib/glossary/products'
import type { GlossaryMatcherTerm } from '@/lib/glossary/types'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Generiert Inhalt + optional eine Illustration für `name` und legt den Begriff
 * als draft an. Gibt bei Fehlschlag `null` zurück statt zu werfen — ein
 * einzelner missratener LLM-Call darf nicht die gesamte Freigabe kosten.
 *
 * `forcedSlug` überschreibt den aus dem LLM-Namen abgeleiteten Slug. Die
 * Freigabe MUSS ihn setzen: der Kandidat trägt seinen Slug seit der Entkopplung
 * schon in `pending_glossary_terms` (slugify des erkannten Namens), und Panel,
 * Mark-Injektion und Seiten-URL hängen daran. Würde generateTermContent hier
 * einen abweichenden Slug liefern (das Modell normalisiert Namen, „MoE“ →
 * „Mixture of Experts“), entstünde der Begriff unter einer anderen Adresse als
 * der bestätigte Kandidat — die Freigabe fände ihn nicht und der Artikel würde
 * auf eine notFound()-Seite verlinken.
 */
/** Merkt sich, ob der letzte Fehlschlag vorübergehend war (529/429/Netz).
 *  Modul-Zustand, weil die Funktion sequenziell aufgerufen wird — der Crawl
 *  arbeitet die Warteschlange einen Begriff nach dem anderen ab. */
let lastFailureWasRetryable = false

export async function generateAndInsertDraft(
  supabase: AdminClient,
  name: string,
  forcedSlug?: string,
): Promise<(GlossaryMatcherTerm & { summary: string }) | null> {
  try {
    const generated = await generateTermContent(name)
    const slug = forcedSlug ?? generated.slug

    let illustrationUrl: string | null = null
    let illustrationAlt: string | null = null
    // IMMER ein Bild (2026-08-05). Vorher entschied das Modell per
    // needs_illustration, ob eines entsteht — bei 82 veroeffentlichten Begriffen
    // hatten dadurch nur 54 eines. Die Weiche brachte keinen Nutzen: eine
    // Illustration schadet keinem Begriff, und die Luecken mussten hinterher per
    // Hand ueber "Alle fehlenden Illustrationen erzeugen" geschlossen werden.
    // Das Feld bleibt im Schema des Modell-Aufrufs, wird hier aber ignoriert.
    {
      try {
        const img = await generateGlossaryIllustration(generated.canonicalName, generated.summary)
        if (img.success && img.imageBase64) {
          // uploadGlossaryIllustration wirft bei Fehlern statt ein Error-Objekt
          // zurückzugeben — der Begriff bleibt auch ohne Bild nützlich, also
          // fängt der äußere try/catch dieses Blocks den Wurf ab, ohne den
          // Kandidaten selbst zu verwerfen.
          illustrationUrl = await uploadGlossaryIllustration(img.imageBase64, slug)
          illustrationAlt = generated.illustrationAlt
        } else {
          console.error(`[Glossary] Illustration für "${slug}" fehlgeschlagen: ${img.error}`)
        }
      } catch (err) {
        console.error(`[Glossary] Illustration-Upload für "${slug}" fehlgeschlagen:`, err)
      }
    }

    const { data: inserted, error } = await supabase.from('glossary_terms').insert({
      slug,
      canonical_name: generated.canonicalName,
      aliases: generated.aliases,
      status: 'draft',
      summary: generated.summary,
      body: generated.body,
      illustration_url: illustrationUrl,
      illustration_alt: illustrationAlt,
      readability_score: generated.readabilityScore,
    }).select('id').single()
    if (error) throw new Error(`glossary_terms insert failed: ${error.message}`)

    // Produkt-Zuordnung (Task 15) ist reine Zugabe — ein Fehler hier darf den
    // fertig generierten Begriff nicht kosten, deshalb eigener try/catch wie
    // beim Illustrations-Block oben.
    const termId = (inserted as { id: string } | null)?.id
    if (termId) {
      try {
        await assignProducts(termId, generated.canonicalName, generated.summary)
      } catch (err) {
        console.error(`[Glossary] Produkt-Zuordnung für "${slug}" fehlgeschlagen:`, err)
      }
    } else {
      console.error(`[Glossary] glossary_terms insert für "${slug}" lieferte keine id — Produkt-Zuordnung übersprungen`)
    }

    return {
      slug,
      canonicalName: generated.canonicalName,
      aliases: generated.aliases,
      summary: generated.summary,
    }
  } catch (err) {
    // Vorübergehende Fehler MARKIEREN, statt sie wie inhaltliche zu behandeln.
    // Prod-Befund 2026-08-05: ein 529 "Overloaded" (mit x-should-retry: true)
    // liess den Aufrufer den Begriff als erledigt abhaken — er wurde nie wieder
    // versucht. lastFailureWasRetryable ist ein Modul-Zustand statt eines
    // geaenderten Rueckgabetyps: generateAndInsertDraft hat vier Aufrufer, und
    // ein `null` bedeutet fuer alle dasselbe. Nur wer die Unterscheidung braucht,
    // fragt sie ab.
    lastFailureWasRetryable = isRetryableModelError(err)
    console.error(
      `[Glossary] Begriffs-Generierung für "${name}" fehlgeschlagen`
      + (lastFailureWasRetryable ? ' (vorübergehend, bleibt in der Warteschlange)' : '')
      + ':', err,
    )
    return null
  }
}

/**
 * War der letzte Fehlschlag vorübergehend?
 *
 * Wird direkt nach einem `null` von generateAndInsertDraft gelesen. Kein
 * schöner Vertrag, aber der ehrlichste kleine Eingriff: der Rückgabetyp bleibt
 * für alle vier Aufrufer gleich, und die Alternative — ein Ergebnisobjekt — hätte
 * jeden davon anfassen müssen, ohne dass drei davon die Information brauchen.
 */
export function lastGenerationFailureWasRetryable(): boolean {
  return lastFailureWasRetryable
}
