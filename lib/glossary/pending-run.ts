/**
 * Erzeugt EINEN vorgemerkten Lexikonbegriff eines Artikels — die Fachlogik
 * hinter dem vierten servergetriebenen Lexikonlauf (Umbau 2026-08-05, Job-Art
 * 'pending'). Vorher steckte das direkt in app/api/admin/glossary-pending/
 * route.ts, vom Browser in einer for(;;)-Schleife getrieben
 * (glossary-approval-panel.tsx); die Route ruft jetzt nur noch diese Funktion.
 * Gleiche Bauart wie relinkNextBatch in crawl.ts: eine Fachfunktion für zwei
 * Aufrufer (Route und advanceJob).
 *
 * Macht genau eine Einheit (limit=1 an ensureConfirmedTermsExist) und
 * übernimmt danach die ABSCHLUSSBEHANDLUNG, wenn nichts mehr offen ist:
 * applyGlossaryConfirmation mit dem Content AUS DER DATENBANK — ein Request-
 * Content wie in der alten Route gibt es hier nicht, der Job läuft
 * unabhängig vom Editor-Tab. Die Vormerkliste wird NUR bei linked > 0
 * geleert (Erfolgsfall) — scheitert das Veröffentlichen, müsste der Operator
 * die Kandidaten sonst neu identifizieren lassen.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { ensureConfirmedTermsExist } from '@/lib/glossary/ensure-terms'
import { applyGlossaryConfirmation } from '@/lib/glossary/confirm'
import type { GlossaryCandidate } from '@/lib/glossary/types'

type AdminClient = ReturnType<typeof createAdminClient>

export interface PendingRunResult {
  /** Namen der in dieser Einheit neu erzeugten Begriffe (bei limit=1: 0 oder 1). */
  generated: string[]
  /** Name des Kandidaten, dessen Erzeugung in dieser Einheit fehlgeschlagen ist. */
  failed: string[]
  /** Noch offene bestätigte Kandidaten NACH dieser Einheit. */
  remaining: number
  /** Anzahl bei Abschluss veröffentlichter und verlinkter Begriffe (0, solange remaining > 0). */
  linked: number
}

export async function runPendingUnit(
  supabase: AdminClient,
  postId: string,
  confirmedSlugs: string[],
): Promise<PendingRunResult> {
  const confirmed = new Set(confirmedSlugs)

  // Namen fürs Protokoll: ensureConfirmedTermsExist liefert nur Slugs zurück,
  // und ein erzeugter Kandidat ist danach schon aus der Vormerkliste
  // verschwunden — ohne diesen Lookup VORHER gäbe es keinen Namen mehr dafür.
  const { data: beforeRow } = await supabase
    .from('generated_posts')
    .select('pending_glossary_terms')
    .eq('id', postId)
    .maybeSingle()
  const before = (
    (beforeRow as { pending_glossary_terms?: unknown } | null)?.pending_glossary_terms ?? []
  ) as GlossaryCandidate[]
  const nameBySlug = new Map(before.map((c) => [c.slug, c.name]))
  // Der Kandidat, den ensureConfirmedTermsExist mit limit=1 als nächstes
  // versucht — dieselbe Reihenfolge wie dort (erster bestätigter mit
  // needsGeneration). Nur für die Fehlschlag-Meldung nötig; bei Erfolg steht
  // der Name über generatedSlugs zur Verfügung.
  const attempted = before.find((c) => confirmed.has(c.slug) && c.needsGeneration) ?? null

  const ensured = await ensureConfirmedTermsExist(supabase, postId, confirmedSlugs, 1)

  // Vormerkliste fortschreiben. `pendingRemainder === null` heißt "nichts mehr
  // offen"; geleert wird sie trotzdem erst unten — und nur bei erfolgreicher
  // Veröffentlichung. Sonst würde ein Zwischenstand fälschlich "erledigt"
  // zeigen, bevor überhaupt verlinkt wurde.
  if (ensured.pendingRemainder !== null) {
    const { error } = await supabase
      .from('generated_posts')
      .update({ pending_glossary_terms: ensured.pendingRemainder })
      .eq('id', postId)
    if (error) throw new Error(`Vormerkliste nicht speicherbar: ${error.message}`)
  }

  const remainder: GlossaryCandidate[] = ensured.pendingRemainder ?? []
  const remaining = remainder.filter((c) => confirmed.has(c.slug) && c.needsGeneration).length

  const generated = ensured.generatedSlugs.map((slug) => nameBySlug.get(slug) ?? slug)
  const failed = generated.length === 0 && attempted && remaining > 0 ? [attempted.name] : []

  // Nichts mehr offen → jetzt verlinken und veröffentlichen. Erst hier, nicht
  // nach jedem Begriff: die Injektion läuft über den ganzen Artikeltext und
  // wäre pro Begriff dieselbe Arbeit N-mal.
  let linked = 0
  if (remaining === 0) {
    // Content AUS DER DATENBANK laden und übergeben: ohne ihn veröffentlicht
    // applyGlossaryConfirmation nur die Begriffe und injiziert keine Marks —
    // die Verlinkung bliebe dann still aus.
    const { data: postRow } = await supabase
      .from('generated_posts').select('content').eq('id', postId).maybeSingle()
    const currentContent = (postRow as { content?: unknown } | null)?.content
    const result = await applyGlossaryConfirmation(
      supabase,
      postId,
      confirmedSlugs,
      typeof currentContent === 'string' ? currentContent : JSON.stringify(currentContent ?? null),
    )
    linked = result.publishedSlugs.length
    if (result.content !== undefined) {
      const { error } = await supabase
        .from('generated_posts')
        .update({ content: result.content })
        .eq('id', postId)
      if (error) throw new Error(`Artikeltext nicht speicherbar: ${error.message}`)
    }
    // Vormerkliste leeren, wie im Speicherpfad — aber nur bei Erfolg, sonst
    // müsste der Operator die Kandidaten neu identifizieren lassen.
    if (linked > 0) {
      await supabase.from('generated_posts')
        .update({ pending_glossary_terms: null }).eq('id', postId)
    }
  }

  return { generated, failed, remaining, linked }
}
