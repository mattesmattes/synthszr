import { createAdminClient } from '@/lib/supabase/admin'
import { getMatcherTerms, getChartProductNames } from '@/lib/glossary/terms'
import { injectGlossaryMarks } from '@/lib/glossary/inject-marks'
import { safeParseJSONWithError } from '@/lib/utils/safe-json'
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'

/**
 * Verarbeitet eine Freigabe-Entscheidung aus dem Editor (PATCH
 * generated_posts, Task 11): bestätigte Draft-Begriffe werden veröffentlicht,
 * und nur die tatsächlich veröffentlichten Slugs werden als glossaryLink-Mark
 * in den Artikel-Content geschrieben.
 *
 * Serverseitig, nicht im Client: der Browser hat keinen Service-Role-Zugriff,
 * und dieselbe Injektion muss auch Pfade bedienen, die nicht über den Editor
 * laufen (Übersetzung, Backfill-Skript) — deshalb ist `content` optional und
 * wird sonst selbst aus der DB nachgeladen.
 *
 * Ein Kandidat in `pending_glossary_terms` kann auf einen bereits
 * hidden-gesetzten Begriff zeigen (Task 10 schließt hidden nur von der
 * Neugenerierung aus, `GlossaryCandidate` trägt keinen Status). Ohne einen
 * Check NACH dem Freigabe-Versuch würde ein `confirmed`-aber-hidden-Begriff
 * trotzdem verlinkt und landet auf einer notFound()-Seite. Deshalb wird nach
 * dem Update-Versuch der tatsächliche Status abgefragt — das deckt hidden,
 * gelöschte und fehlgeschlagene Freigaben in einem Schritt ab, statt jeden
 * Fall einzeln zu behandeln.
 *
 * @returns `{ content }` nur, wenn tatsächlich etwas injiziert wurde — sonst
 * `{}`, damit der Aufrufer `updateData.content` unangetastet lässt.
 */
export async function applyGlossaryConfirmation(
  supabase: ReturnType<typeof createAdminClient>,
  postId: string,
  confirmedSlugs: string[],
  content: string | undefined,
): Promise<{ content?: string }> {
  if (confirmedSlugs.length === 0) return {}

  // Bestätigte Drafts veröffentlichen — erst damit wird die Lexikonseite
  // erreichbar und landet in der Sitemap.
  const { error: publishError } = await supabase
    .from('glossary_terms')
    .update({ status: 'published', updated_at: new Date().toISOString() })
    .in('slug', confirmedSlugs)
    .eq('status', 'draft')
  if (publishError) {
    console.error(`[Glossary] Freigabe fehlgeschlagen für Post ${postId}:`, publishError.message)
  }

  const { data: statusRows, error: statusError } = await supabase
    .from('glossary_terms')
    .select('slug')
    .in('slug', confirmedSlugs)
    .eq('status', 'published')
  if (statusError) {
    console.error(`[Glossary] Status-Check fehlgeschlagen für Post ${postId}:`, statusError.message)
  }
  const publishedSlugs = (statusRows ?? []).map((r) => r.slug as string)
  if (publishedSlugs.length === 0) return {}

  // Content: vom Aufrufer übernehmen oder selbst nachladen — der Editor
  // schickt ihn immer mit, Übersetzung/Backfill tun das nicht.
  let raw = content
  if (raw === undefined) {
    const { data: existing, error: fetchError } = await supabase
      .from('generated_posts')
      .select('content')
      .eq('id', postId)
      .single()
    if (fetchError) {
      console.error(`[Glossary] Content für Post ${postId} nicht ladbar:`, fetchError.message)
      return {}
    }
    raw = existing?.content as string | undefined
  }
  if (raw === undefined) return {}

  const { data: parsed, error: parseError } = safeParseJSONWithError(raw)
  if (parseError) {
    console.error(`[Glossary] Content für Post ${postId} nicht parsebar, Mark-Injektion übersprungen: ${parseError}`)
    return {}
  }

  const [terms, chartProductNames] = await Promise.all([
    getMatcherTerms('de'),
    getChartProductNames(),
  ])
  // Company- und Chart-Produktnamen reservieren: spezifisch vor generisch
  // (Kollisionsregel: Company > Chart-Produkt > Lexikonbegriff).
  const reserved = [
    ...Object.keys(KNOWN_COMPANIES),
    ...Object.keys(KNOWN_PREMARKET_COMPANIES),
    ...chartProductNames,
  ]
  const injected = injectGlossaryMarks(parsed, publishedSlugs, terms, { reserved })
  return { content: JSON.stringify(injected) }
}
