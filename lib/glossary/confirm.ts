import { createAdminClient } from '@/lib/supabase/admin'
import { getMatcherTerms, getChartProductNames, buildReservedNames } from '@/lib/glossary/terms'
import { injectGlossaryMarks } from '@/lib/glossary/inject-marks'
import { safeParseJSONWithError } from '@/lib/utils/safe-json'

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
 * `publishedSlugs` geht IMMER mit zurück (auch leer), damit der Aufrufer
 * `pending_glossary_terms` nur dann leert, wenn die Freigabe für mindestens
 * einen Slug tatsächlich gegriffen hat — schlägt z.B. das Publish-Update
 * komplett fehl (DB kurz nicht erreichbar), bleibt die Kandidatenliste
 * erhalten, statt einen Begriff dauerhaft unveröffentlicht und unauffindbar
 * zu machen (Review-Fix, Task 11).
 *
 * @returns `content` nur, wenn tatsächlich etwas injiziert wurde — sonst
 * bleibt es undefined, damit der Aufrufer `updateData.content` unangetastet
 * lässt.
 */
export async function applyGlossaryConfirmation(
  supabase: ReturnType<typeof createAdminClient>,
  postId: string,
  confirmedSlugs: string[],
  content: string | undefined,
): Promise<{ content?: string; publishedSlugs: string[] }> {
  if (confirmedSlugs.length === 0) return { publishedSlugs: [] }

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
  if (publishedSlugs.length === 0) return { publishedSlugs }

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
      return { publishedSlugs }
    }
    raw = existing?.content as string | undefined
  }
  if (raw === undefined) return { publishedSlugs }

  const { data: parsed, error: parseError } = safeParseJSONWithError(raw)
  if (parseError) {
    console.error(`[Glossary] Content für Post ${postId} nicht parsebar, Mark-Injektion übersprungen: ${parseError}`)
    return { publishedSlugs }
  }

  // Reihenfolge bewusst NACH dem Freigabe-Versuch: getMatcherTerms filtert
  // intern auf status=published. Ein frisch bestätigter Draft-Begriff wäre
  // vor dem Publish-Update noch nicht published und würde in der
  // Trefferliste fehlen — die Mark bliebe für genau den Regelfall
  // (Draft zum ersten Mal bestätigen) unsichtbar aus.
  const [terms, chartProductNames] = await Promise.all([
    getMatcherTerms('de'),
    getChartProductNames(),
  ])
  // getMatcherTerms('de') nimmt intern den frühen de-Zweig und liefert damit
  // nie null (das passiert nur, wenn die Übersetzungsabfrage für eine
  // Nicht-de-Sprache fehlschlägt, terms.ts) — die Absicherung ist trotzdem
  // nötig, weil der Rückgabetyp seit Task 16/Fix-Runde 1 `| null` ist.
  //
  // Company- und Chart-Produktnamen reservieren: spezifisch vor generisch
  // (Kollisionsregel: Company > Chart-Produkt > Lexikonbegriff) —
  // buildReservedNames statt einer eigenen Kopie (Review-Fund Important 2,
  // Fix-Runde 1: dieselbe Liste wird von reinjectGlossaryMarksForTranslation
  // in lib/glossary/translate.ts gebraucht, eine Policy-Regel darf dort
  // nicht unbemerkt auseinanderlaufen).
  const reserved = buildReservedNames(chartProductNames)
  const injected = injectGlossaryMarks(parsed, publishedSlugs, terms ?? [], { reserved })
  return { publishedSlugs, content: JSON.stringify(injected) }
}
