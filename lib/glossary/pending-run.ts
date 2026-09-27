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
 * unabhängig vom Editor-Tab. Die Vormerkliste wird NUR geleert, wenn
 * AUSNAHMSLOS ALLE bestätigten Slugs tatsächlich veröffentlicht wurden
 * (`publishFailed` leer) — Review-Fund 2026-08-05: ein geschluckter Lesefehler
 * in ensureConfirmedTermsExist ODER ein fehlgeschlagenes Publish-Update ODER
 * ein inzwischen hidden/gelöschter Begriff konnten sonst dazu führen, dass
 * die Liste geleert wird, OBWOHL Kandidaten nie erzeugt/veröffentlicht
 * wurden — unauffindbarer Datenverlust, plus ein Job, der fälschlich 'done'
 * meldet (der grüne Endzustand, den niemand anzweifelt).
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
  /** Namen der in dieser Einheit INHALTLICH gescheiterten Kandidaten — sie
   *  werden als generationFailed markiert und blockieren den Lauf nicht mehr. */
  skipped: string[]
  /** Noch offene bestätigte Kandidaten NACH dieser Einheit. */
  remaining: number
  /** Anzahl bei Abschluss tatsächlich veröffentlichter Begriffe (0, solange remaining > 0). */
  linked: number
  /**
   * Namen bestätigter Slugs, die beim Abschluss (remaining===0) NICHT
   * veröffentlicht wurden — nur gesetzt, wenn mindestens einer betroffen ist.
   * advanceJob MUSS den Job dann als 'error' beenden, nicht als 'done'
   * (Review-Fund): ein Nachfolgelauf kann die Vormerkliste (bleibt in diesem
   * Fall erhalten) erneut versuchen.
   */
  publishFailed?: string[]
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
  // Offen = bestätigt, noch zu erzeugen und nicht aufgegeben. Dieselbe Menge,
  // aus der ensureConfirmedTermsExist mit limit=1 seinen "missing"-Batch bildet.
  const isOpen = (c: GlossaryCandidate) => confirmed.has(c.slug) && !!c.needsGeneration && !c.generationFailed
  const beforeEligible = before.filter(isOpen)

  const ensured = await ensureConfirmedTermsExist(supabase, postId, confirmedSlugs, 1)

  // Inhaltlich gescheitert (s. GlossaryCandidate.generationFailed): markieren
  // statt offen lassen. Überlast und Request-Fehler zählen hier nicht dazu —
  // die bleiben offen, und nach zehn Durchgängen ohne Fortschritt gibt der Job
  // sichtbar auf.
  const contentFailed = new Set(ensured.contentFailedSlugs ?? [])
  if (ensured.pendingRemainder !== null && contentFailed.size > 0) {
    ensured.pendingRemainder = ensured.pendingRemainder.map((c) =>
      contentFailed.has(c.slug) ? { ...c, generationFailed: true } : c,
    )
  }

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
  const stillOpenSlugs = new Set(remainder.filter(isOpen).map((c) => c.slug))
  const remaining = stillOpenSlugs.size

  const generatedSlugSet = new Set(ensured.generatedSlugs)
  const generated = ensured.generatedSlugs.map((slug) => nameBySlug.get(slug) ?? slug)

  // Der TATSÄCHLICH versuchte Kandidat für die Fehlschlag-Meldung: der erste
  // vorher offene, der weder erzeugt wurde noch noch offen ist. Review-Fund:
  // ensure-terms.ts prüft die Existenz ALLER eligiblen Kandidaten VORAB und
  // entfernt schon vorhandene lautlos aus der Liste, bevor es den ersten
  // "missing" Kandidaten überhaupt versucht — der schlicht erste offene
  // Kandidat in `before` kann also ein stiller Erfolg sein, nicht der
  // tatsächliche (fehlgeschlagene) Versuch.
  const attempted = beforeEligible.find(
    (c) => !generatedSlugSet.has(c.slug) && stillOpenSlugs.has(c.slug),
  ) ?? null
  const failed = generated.length === 0 && attempted ? [attempted.name] : []
  const skipped = [...contentFailed].map((slug) => nameBySlug.get(slug) ?? slug)

  // Nichts mehr offen → jetzt verlinken und veröffentlichen. Erst hier, nicht
  // nach jedem Begriff: die Injektion läuft über den ganzen Artikeltext und
  // wäre pro Begriff dieselbe Arbeit N-mal.
  let linked = 0
  let publishFailed: string[] | undefined
  if (remaining === 0) {
    // Aufgegebene Kandidaten gibt es nicht als Begriff — sie aus der Menge
    // nehmen, sonst zählten sie unten als "nicht veröffentlicht" und der Job
    // endete mit Fehler, obwohl alles Machbare verlinkt ist.
    const abandoned = new Set(
      [...before, ...remainder].filter((c) => c.generationFailed).map((c) => c.slug),
    )
    const publishable = confirmedSlugs.filter((s) => !abandoned.has(s))
    // Content AUS DER DATENBANK laden und übergeben: ohne ihn veröffentlicht
    // applyGlossaryConfirmation nur die Begriffe und injiziert keine Marks —
    // die Verlinkung bliebe dann still aus.
    const { data: postRow } = await supabase
      .from('generated_posts').select('content').eq('id', postId).maybeSingle()
    const currentContent = (postRow as { content?: unknown } | null)?.content
    const result = await applyGlossaryConfirmation(
      supabase,
      postId,
      publishable,
      typeof currentContent === 'string' ? currentContent : JSON.stringify(currentContent ?? null),
    )
    linked = result.publishedSlugs.length

    // Wurden WIRKLICH ALLE bestätigten Slugs veröffentlicht? Ein Nein hier
    // ist der Review-Fund: transienter Lesefehler im Status-Check
    // (confirm.ts:56-65), ein fehlgeschlagenes Publish-Update (confirm.ts:
    // 52-54), oder ein bestätigter Slug ist inzwischen hidden/gelöscht.
    const notPublished = publishable.filter((s) => !result.publishedSlugs.includes(s))
    if (notPublished.length > 0) {
      publishFailed = notPublished.map((s) => nameBySlug.get(s) ?? s)
    }

    if (result.content !== undefined) {
      const { error } = await supabase
        .from('generated_posts')
        .update({ content: result.content })
        .eq('id', postId)
      if (error) throw new Error(`Artikeltext nicht speicherbar: ${error.message}`)
    }
    // Vormerkliste NUR leeren, wenn AUSNAHMSLOS alle bestätigten Slugs
    // veröffentlicht wurden — sonst wären die betroffenen Kandidaten
    // unauffindbar verloren, ohne je erzeugt/veröffentlicht worden zu sein.
    if (linked > 0 && notPublished.length === 0) {
      await supabase.from('generated_posts')
        .update({ pending_glossary_terms: null }).eq('id', postId)
    }
  }

  return { generated, failed, skipped, remaining, linked, publishFailed }
}
