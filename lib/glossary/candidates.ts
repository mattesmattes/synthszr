/**
 * Führt die drei Kandidatenquellen der Lexikon-Job-Phase (Task 10) zu EINER
 * Liste zusammen, die in `generated_posts.pending_glossary_terms` landet:
 *   - tag:   {lex:Begriff}-Direktiven des Ghostwriters (sicher, gewollt)
 *   - match: Matcher-Treffer gegen bereits veröffentlichte Begriffe
 *   - new:   vom LLM neu identifizierte, noch unbekannte Begriffe
 *
 * Diese Funktion GENERIERT NICHTS (Entkopplung 2026-08-04, Befund B). Sie ist
 * reine Listen-Arbeit: DB-Reads plus Namensabgleich, damit die lexicon-Phase in
 * Sekunden durchläuft. tag/new-Namen ohne bestehenden Begriff werden mit
 * `needsGeneration: true` und einem aus dem Namen abgeleiteten Slug markiert;
 * den Inhalt erzeugt erst die Freigabe (lib/glossary/confirm.ts) für die
 * Begriffe, die der Operator wirklich bestätigt.
 *
 * Warum: vorher generierte jeder unbekannte Name hier sofort — zwei LLM-Calls,
 * eine Bildgenerierung und ein Blob-Upload pro Begriff, sequenziell. Ein
 * Artikel mit 25 neuen Begriffen brauchte ~25 Minuten in einer Phase mit
 * 300s-Limit; Vercel killte sie, `pending_glossary_terms` wurde nie
 * geschrieben, und die schon erzeugten Drafts blieben ohne Kandidatenliste
 * unerreichbar (55 verwaiste Drafts in Prod).
 *
 * Der Namens-Abgleich gegen veröffentlichte, draft- UND hidden-Begriffe bleibt:
 * er entscheidet, ob ein Kandidat auf einen bestehenden Begriff zeigt (nur
 * verlinken) oder noch erzeugt werden muss. hidden MUSS mit rein, weil
 * glossary_terms.slug unique ist — ein erneuter Vorschlag desselben
 * (versteckten) Begriffs würde bei der Freigabe sonst am Unique-Constraint
 * scheitern, und zwar bei jeder künftigen Erwähnung erneut.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { slugify } from '@/lib/glossary/generate'
import type { GlossaryCandidate, GlossaryCandidateOrigin, GlossaryMatcherTerm, GlossaryMention } from '@/lib/glossary/types'

type AdminClient = ReturnType<typeof createAdminClient>

/** Case-insensitiver Namens-Abgleich (canonicalName ODER alias) gegen eine
 *  Begriffsliste. Anders als der Text-Matcher (mentions.ts) sucht das hier
 *  keine Vorkommen IN einem Text, sondern prüft Gleichheit zweier Namen —
 *  z. B. „mixture of experts“ == „Mixture of Experts“. */
function findTermSlugByName(name: string, terms: GlossaryMatcherTerm[]): string | null {
  const needle = name.trim().toLowerCase()
  for (const term of terms) {
    if (term.canonicalName.trim().toLowerCase() === needle) return term.slug
    if (term.aliases.some((a) => a.trim().toLowerCase() === needle)) return term.slug
  }
  return null
}

export async function buildCandidateList(
  supabase: AdminClient,
  publishedTerms: GlossaryMatcherTerm[],
  tagged: string[],
  matched: GlossaryMention[],
  fresh: string[],
): Promise<GlossaryCandidate[]> {
  const { data: existingRows, error: existingError } = await supabase
    .from('glossary_terms')
    .select('slug, canonical_name, aliases')
    .in('status', ['draft', 'hidden'])
  if (existingError) {
    // Degradiert bewusst (Kosten-Bremse greift dann nur noch gegen published),
    // statt die ganze Phase abzubrechen — aber lautlos wäre das nicht
    // debugbar, deshalb loggen statt nur verschlucken.
    console.error('[Glossary] buildCandidateList: Laden bestehender Begriffe fehlgeschlagen:', existingError.message)
  }
  const existingTerms: GlossaryMatcherTerm[] = ((existingRows ?? []) as Array<Record<string, unknown>>).map((r) => ({
    slug: r.slug as string,
    canonicalName: r.canonical_name as string,
    aliases: (r.aliases ?? []) as string[],
  }))

  const knownTerms: GlossaryMatcherTerm[] = [...publishedTerms, ...existingTerms]

  // Genau die Slugs, zu denen es schon eine VERÖFFENTLICHTE Lexikonseite gibt.
  // `existingTerms` gehört bewusst nicht dazu: das sind draft/hidden, und ein
  // Draft ist der Fall, der die Freigabe noch braucht (s. alreadyPublished in
  // types.ts).
  const publishedSlugs = new Set(publishedTerms.map((t) => t.slug))

  const bySlug = new Map<string, GlossaryCandidate>()
  // Erste Quelle gewinnt bei Kollision: tag (explizite Ghostwriter-Direktive)
  // vor match vor new, entsprechend der Verarbeitungsreihenfolge unten.
  const addCandidate = (
    slug: string, name: string, origin: GlossaryCandidateOrigin, matchedText: string | null,
    isNewlyGenerated: boolean, summary: string | undefined,
  ) => {
    if (bySlug.has(slug)) return
    const candidate: GlossaryCandidate = { slug, name, origin, matchedText, isNewlyGenerated, summary }
    // Nur setzen, wenn zutreffend: ein Feld, das überall `false` mitschleppt,
    // bläht die JSON-Spalte pending_glossary_terms ohne Aussagegewinn auf, und
    // „fehlt" ist als „nicht veröffentlicht" definiert.
    if (publishedSlugs.has(slug)) candidate.alreadyPublished = true
    bySlug.set(slug, candidate)
  }

  /**
   * Unbekannter Name: nur vormerken, nicht generieren. Der Slug wird JETZT
   * festgelegt (nicht erst beim Erzeugen), weil Panel, Freigabe, Mark-Injektion
   * und Seiten-URL denselben Schlüssel brauchen — die Freigabe gibt ihn als
   * `forcedSlug` an generateAndInsertDraft weiter.
   *
   * Leerer Slug wird verworfen statt aufgenommen: slugify('') und
   * slugify('   ') ergeben '', und ein Kandidat mit leerem Slug würde später in
   * injectGlossaryMarks über boundaryRegex('') an JEDER Position mit Länge 0
   * treffen und leere Textknoten erzeugen (ungültiges TipTap-JSON).
   *
   * Bekannte Grenze: zwei Schreibweisen desselben unbekannten Begriffs („MoE“
   * und „Mixture of Experts“) ergeben zwei Slugs und damit zwei Kandidaten. Vorher
   * fing das der Alias-Abgleich gegen den frisch generierten Begriff ab — was
   * voraussetzte, dass das Modell den Alias auch liefert. Der Operator wählt
   * jetzt ohnehin aus und kann den Doppelgänger abwählen; ein zweiter
   * LLM-Call nur zur Namensnormalisierung wäre genau die Kostenart, die dieser
   * Umbau beseitigt.
   */
  const addPendingCandidate = (name: string, origin: GlossaryCandidateOrigin) => {
    const slug = slugify(name)
    if (!slug) {
      console.error(`[Glossary] Kandidat "${name}" ergibt einen leeren Slug — übersprungen`)
      return
    }
    if (bySlug.has(slug)) return
    bySlug.set(slug, {
      slug, name, origin, matchedText: null,
      isNewlyGenerated: false, needsGeneration: true, summary: undefined,
    })
  }

  // 1) {lex:Name}-Direktiven. Ein Tag kann auf einen bestehenden Begriff
  //    zeigen (dann nur verlinken) ODER auf einen, der noch nicht existiert
  //    (dann vormerken) — in beiden Fällen bleibt origin='tag', weil
  //    die Herkunft (explizite Direktive) zählt, nicht ob schon Inhalt existiert.
  //    isNewlyGenerated hält zusätzlich fest, ob der Inhalt ungeprüfter,
  //    frisch generierter LLM-Text ist — das ist eine andere Achse als origin
  //    und wird von Task 11/12 gebraucht, um Freigabe-Vorauswahl korrekt zu
  //    steuern. Seit der Entkopplung ist es beim Vormerken IMMER false: es
  //    existiert noch kein Text, den ein Mensch übersehen könnte. Sobald die
  //    Freigabe generiert, ist der Text zwar frisch — aber genau dort hat ihn
  //    ein Mensch bewusst angefordert, was die Vorauswahl-Frage erledigt.
  for (const name of tagged) {
    const existingSlug = findTermSlugByName(name, knownTerms)
    if (existingSlug) {
      // summary noch unbekannt — knownTerms trägt sie nicht (s. Nachschlag unten).
      addCandidate(existingSlug, name, 'tag', null, false, undefined)
      continue
    }
    addPendingCandidate(name, 'tag')
  }

  // 2) Matcher-Treffer gegen bereits veröffentlichte Begriffe — Inhalt existiert
  //    bereits, hier wird nur die Trefferstelle mitgegeben.
  for (const mention of matched) {
    const term = publishedTerms.find((t) => t.slug === mention.slug)
    // summary noch unbekannt — publishedTerms (getMatcherTerms) führt sie aus
    // Egress-Gründen bewusst nicht mit (s. Nachschlag unten).
    addCandidate(mention.slug, term?.canonicalName ?? mention.matchedText, 'match', mention.matchedText, false, undefined)
  }

  // 3) Vom LLM neu identifizierte Begriffe ohne (bekannten) Glossareintrag.
  for (const name of fresh) {
    const existingSlug = findTermSlugByName(name, knownTerms)
    if (existingSlug) {
      addCandidate(existingSlug, name, 'new', null, false, undefined)
      continue
    }
    addPendingCandidate(name, 'new')
  }

  // Nachschlag für Kandidaten, die auf einen BEREITS existierenden Begriff
  // aufgelöst wurden (Matcher-Treffer, oder tag/new-Namen mit bestehendem
  // Eintrag): weder publishedTerms (getMatcherTerms, Egress-schmal) noch
  // knownTerms (GlossaryMatcherTerm, kein summary-Feld) führen die summary
  // mit. Ein gezielter Batch-Nachschlag statt eines Joins in jeder
  // Matcher-Query, die dafür nicht gebaut ist.
  // needsGeneration-Kandidaten ausgenommen: zu ihnen existiert per Definition
  // keine Zeile in glossary_terms, ein Nachschlag könnte nichts finden.
  const needSummary = Array.from(bySlug.values())
    .filter((c) => c.summary === undefined && !c.needsGeneration)
    .map((c) => c.slug)
  if (needSummary.length > 0) {
    const { data: summaryRows, error: summaryError } = await supabase
      .from('glossary_terms')
      .select('slug, summary')
      .in('slug', needSummary)
    if (summaryError) {
      console.error('[Glossary] buildCandidateList: Summary-Nachschlag fehlgeschlagen:', summaryError.message)
    } else {
      const summaryBySlug = new Map(
        ((summaryRows ?? []) as Array<{ slug: string; summary: string }>).map((r) => [r.slug, r.summary]),
      )
      for (const candidate of bySlug.values()) {
        if (candidate.summary === undefined) candidate.summary = summaryBySlug.get(candidate.slug)
      }
    }
  }

  return Array.from(bySlug.values())
}
