/**
 * Erzeugt beim Speichern die Lexikon-Begriffe, die der Operator bestätigt hat
 * und die noch nicht existieren — die zweite Hälfte der Entkopplung vom
 * 2026-08-04 (Befund B).
 *
 * Vorher generierte die lexicon-Phase des Artikel-Jobs JEDEN im Text erkannten
 * unbekannten Begriff sofort: pro Begriff zwei LLM-Calls, eine Bildgenerierung
 * und ein Blob-Upload, sequenziell und ohne Zeitbudget. In Prod waren das 25
 * Begriffe für einen Artikel, also ~25 Minuten in einer Phase mit 300s-Limit.
 * Vercel killte sie, `pending_glossary_terms` wurde nie geschrieben, und die
 * bereits erzeugten Drafts blieben ohne Kandidatenliste unerreichbar.
 *
 * Jetzt ist die Reihenfolge umgekehrt: erkennen und vormerken ist billig,
 * erzeugt wird nur, was der Operator bestätigt. Aus 25 erkannten Begriffen
 * werden so typischerweise zwei oder drei bezahlte.
 *
 * Läuft VOR applyGlossaryConfirmation (dort wird draft → published gesetzt und
 * verlinkt). Diese Trennung hält beide Funktionen bei einer Aufgabe: hier
 * „existiert der Begriff überhaupt", dort „veröffentlichen und verlinken".
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { generateAndInsertDraft } from '@/lib/glossary/draft-writer'
import type { GlossaryCandidate } from '@/lib/glossary/types'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Obergrenze neu erzeugter Begriffe pro Speichervorgang.
 *
 * Die Route deklariert maxDuration = 300, ein Begriff kostet in Prod gemessen
 * 45-90s (Content-Call + ggf. Bildgenerierung + Upload + Produkt-Zuordnung).
 * Drei Begriffe liegen mit ~180-270s samt Marge unter dem Limit; bei vier wäre
 * der schlechte Fall schon jenseits davon. Genau diese unbeschränkte Menge in
 * einer zeitbegrenzten Function war der Defekt, den dieser Umbau behebt — ihn
 * eine Ebene höher zu wiederholen wäre der naheliegendste Fehler.
 *
 * Der Deckel verliert nichts: was darüber liegt, bleibt als
 * `pendingRemainder` vorgemerkt und ist beim nächsten Speichern wieder dran.
 */
export const MAX_GENERATE_PER_SAVE = 3

/**
 * @returns `generatedSlugs` — was in diesem Aufruf neu angelegt wurde (die
 *   Begriffe sind danach als `status='draft'` vorhanden, sodass
 *   applyGlossaryConfirmation sie veröffentlichen kann).
 * @returns `pendingRemainder` — `null`, wenn alle bestätigten Kandidaten
 *   abgearbeitet sind (der Aufrufer darf `pending_glossary_terms` dann leeren).
 *   Sonst die Kandidaten, die NICHT verarbeitet wurden: über dem Deckel oder
 *   mit fehlgeschlagener Generierung. Der Aufrufer MUSS diese Liste schreiben
 *   statt zu leeren, sonst müsste der Operator sie neu identifizieren lassen —
 *   der Deckel wäre dann eine Falle statt einer Bremse.
 */
export async function ensureConfirmedTermsExist(
  supabase: AdminClient,
  postId: string,
  confirmedSlugs: string[],
  /**
   * Wie viele Begriffe dieser Aufruf erzeugt. Default MAX_GENERATE_PER_SAVE (3)
   * fuer den Speicherpfad — dort ist die Erzeugung eine Zugabe und darf den
   * Artikel nicht ins Zeitlimit ziehen.
   *
   * Der Freigabe-Lauf im Browser ruft mit 1 auf und wiederholt, bis nichts mehr
   * offen ist: 45-90s je Begriff bleiben so weit unter maxDuration, und der
   * Operator sieht nach jedem Begriff, dass es weitergeht.
   */
  limit: number = MAX_GENERATE_PER_SAVE,
): Promise<{ generatedSlugs: string[]; pendingRemainder: GlossaryCandidate[] | null }> {
  if (confirmedSlugs.length === 0) return { generatedSlugs: [], pendingRemainder: null }
  try {
    return await generateMissingTerms(supabase, postId, confirmedSlugs, Math.max(1, limit))
  } catch (err) {
    // Die Begriffs-Erzeugung ist eine Zugabe zum Speichern des Artikels — sie
    // darf ihn unter keinen Umständen mitnehmen. Beim Verdrahten der Route
    // konkret passiert: ein Client ohne .maybeSingle() ließ den ganzen PATCH
    // scheitern, der Artikel wurde nicht gespeichert. `pendingRemainder: null`
    // ist hier keine Behauptung "alles erledigt": es überlässt die
    // Entscheidung dem Aufrufer, der die Liste nur bei erfolgreicher
    // Veröffentlichung leert — und die kann ohne erzeugten Draft nicht greifen.
    console.error(`[Glossary] Begriffs-Erzeugung für Post ${postId} abgebrochen:`, err)
    return { generatedSlugs: [], pendingRemainder: null }
  }
}

async function generateMissingTerms(
  supabase: AdminClient,
  postId: string,
  confirmedSlugs: string[],
  limit: number,
): Promise<{ generatedSlugs: string[]; pendingRemainder: GlossaryCandidate[] | null }> {

  const { data: postRow, error: postError } = await supabase
    .from('generated_posts')
    .select('pending_glossary_terms')
    .eq('id', postId)
    .maybeSingle()
  if (postError) {
    // Degradiert bewusst: ohne Kandidatenliste kann hier nichts erzeugt werden,
    // aber applyGlossaryConfirmation läuft danach weiter und veröffentlicht die
    // Begriffe, die bereits existieren. Ein Wurf würde das Speichern des
    // ARTIKELS scheitern lassen — unverhältnismäßig für eine Zugabe.
    console.error(`[Glossary] Kandidatenliste für Post ${postId} nicht ladbar:`, postError.message)
    return { generatedSlugs: [], pendingRemainder: null }
  }

  const raw = (postRow as { pending_glossary_terms?: unknown } | null)?.pending_glossary_terms
  if (!Array.isArray(raw) || raw.length === 0) return { generatedSlugs: [], pendingRemainder: null }
  const candidates = raw as GlossaryCandidate[]

  const confirmed = new Set(confirmedSlugs)
  // Nur bestätigte Kandidaten ohne existierenden Begriff. `needsGeneration`
  // fehlt in Listen, die vor dem Umbau geschrieben wurden — dort bedeutet
  // „fehlt" korrekt „Begriff existiert schon", also kein Kandidat für uns.
  const toGenerate = candidates.filter((c) => confirmed.has(c.slug) && c.needsGeneration)
  if (toGenerate.length === 0) return { generatedSlugs: [], pendingRemainder: null }

  // Zwischenzeitlich entstanden? Der Kandidat kann seit dem Vormerken über einen
  // anderen Artikel oder einen früheren Speicherversuch angelegt worden sein.
  // glossary_terms.slug ist unique, ein zweiter Insert würde scheitern — und
  // vorher trotzdem den vollen Content-Call plus Bild bezahlen.
  const { data: existingRows, error: existingError } = await supabase
    .from('glossary_terms')
    .select('slug')
    .in('slug', toGenerate.map((c) => c.slug))
  if (existingError) {
    // Hier NICHT degradieren: ohne diese Liste würden bereits vorhandene
    // Begriffe erneut generiert (teuer) und der Insert stirbt am
    // Unique-Constraint. Nichts tun ist die günstigere Fehlreaktion, und der
    // nächste Speicherversuch kann es heilen.
    console.error(`[Glossary] Existenzprüfung fehlgeschlagen für Post ${postId}:`, existingError.message)
    return { generatedSlugs: [], pendingRemainder: candidates }
  }
  const alreadyThere = new Set(((existingRows ?? []) as Array<{ slug: string }>).map((r) => r.slug))
  const missing = toGenerate.filter((c) => !alreadyThere.has(c.slug))
  if (missing.length === 0) return { generatedSlugs: [], pendingRemainder: null }

  const batch = missing.slice(0, limit)
  const generatedSlugs: string[] = []
  const failed: GlossaryCandidate[] = []
  for (const candidate of batch) {
    const created = await generateAndInsertDraft(supabase, candidate.name, candidate.slug)
    if (created) generatedSlugs.push(created.slug)
    else failed.push(candidate)
  }

  // Übrig bleiben: was der Deckel abgeschnitten hat, plus die Fehlschläge.
  const remainder = [...failed, ...missing.slice(limit)]
  if (remainder.length === 0) return { generatedSlugs, pendingRemainder: null }

  // Die noch nicht bestätigten Kandidaten gehören ebenfalls in die Liste, die
  // erhalten bleibt — sonst verschwinden sie beim ersten Teil-Speichern.
  const remainderSlugs = new Set(remainder.map((c) => c.slug))
  const untouched = candidates.filter((c) => !confirmed.has(c.slug) && !remainderSlugs.has(c.slug))
  return { generatedSlugs, pendingRemainder: [...remainder, ...untouched] }
}
