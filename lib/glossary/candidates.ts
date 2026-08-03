/**
 * Führt die drei Kandidatenquellen der Lexikon-Job-Phase (Task 10) zu EINER
 * Liste zusammen, die in `generated_posts.pending_glossary_terms` landet:
 *   - tag:   {lex:Begriff}-Direktiven des Ghostwriters (sicher, gewollt)
 *   - match: Matcher-Treffer gegen bereits veröffentlichte Begriffe
 *   - new:   vom LLM neu identifizierte, noch unbekannte Begriffe
 *
 * Für tag/new-Namen ohne bestehenden Begriff wird der Inhalt (+ ggf. eine
 * Illustration) generiert und der Begriff mit status='draft' angelegt.
 * Kosten-Bremse: bevor generiert wird, prüft ein Namens-Abgleich gegen
 * veröffentlichte, bereits als draft angelegte UND hidden-Begriffe — ein
 * unbestätigter Kandidat aus einem früheren Artikel (oder ein bewusst
 * versteckter) wird so wiederverwendet statt erneut (teuer) generiert zu
 * werden. hidden MUSS mit rein: glossary_terms.slug ist unique, also würde ein
 * erneuter Vorschlag desselben (versteckten) Begriffs sonst den vollen
 * LLM-Content-Call + ggf. Illustration/Upload durchlaufen und dann am
 * Unique-Constraint scheitern — der Kandidat verschwindet dabei lautlos
 * (tryGenerateDrafts catch), und zwar bei JEDER künftigen Erwähnung erneut.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { generateTermContent } from '@/lib/glossary/generate'
import { generateGlossaryIllustration, uploadGlossaryIllustration } from '@/lib/gemini/image-generator'
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

/**
 * Generiert Inhalt + optional eine Illustration für `name` und legt den
 * Begriff als draft an. Gibt bei Fehlschlag `null` zurück statt zu werfen —
 * ein einzelner missratener LLM-Call darf nicht die gesamte Kandidatenliste
 * kosten (inkl. bereits aufgelöster tag-/match-Kandidaten).
 */
async function tryGenerateDraft(
  supabase: AdminClient,
  name: string,
): Promise<(GlossaryMatcherTerm & { summary: string }) | null> {
  try {
    const generated = await generateTermContent(name)

    let illustrationUrl: string | null = null
    let illustrationAlt: string | null = null
    if (generated.needsIllustration) {
      try {
        const img = await generateGlossaryIllustration(generated.canonicalName, generated.summary)
        if (img.success && img.imageBase64) {
          // uploadGlossaryIllustration wirft bei Fehlern statt ein Error-Objekt
          // zurückzugeben — der Begriff bleibt auch ohne Bild nützlich, also
          // fängt der äußere try/catch dieses Blocks den Wurf ab, ohne den
          // Kandidaten selbst zu verwerfen.
          illustrationUrl = await uploadGlossaryIllustration(img.imageBase64, generated.slug)
          illustrationAlt = generated.illustrationAlt
        } else {
          console.error(`[Glossary] Illustration für "${generated.slug}" fehlgeschlagen: ${img.error}`)
        }
      } catch (err) {
        console.error(`[Glossary] Illustration-Upload für "${generated.slug}" fehlgeschlagen:`, err)
      }
    }

    const { error } = await supabase.from('glossary_terms').insert({
      slug: generated.slug,
      canonical_name: generated.canonicalName,
      aliases: generated.aliases,
      status: 'draft',
      summary: generated.summary,
      body: generated.body,
      illustration_url: illustrationUrl,
      illustration_alt: illustrationAlt,
      readability_score: generated.readabilityScore,
    })
    if (error) throw new Error(`glossary_terms insert failed: ${error.message}`)

    return {
      slug: generated.slug,
      canonicalName: generated.canonicalName,
      aliases: generated.aliases,
      summary: generated.summary,
    }
  } catch (err) {
    console.error(`[Glossary] Begriffs-Generierung für "${name}" fehlgeschlagen:`, err)
    return null
  }
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

  // Wächst während des Laufs: ein in diesem Tick neu generierter Begriff soll
  // bei einer zweiten Erwähnung im selben Artikel nicht doppelt generiert werden.
  const knownTerms: GlossaryMatcherTerm[] = [...publishedTerms, ...existingTerms]

  const bySlug = new Map<string, GlossaryCandidate>()
  // Erste Quelle gewinnt bei Kollision: tag (explizite Ghostwriter-Direktive)
  // vor match vor new, entsprechend der Verarbeitungsreihenfolge unten.
  const addCandidate = (
    slug: string, name: string, origin: GlossaryCandidateOrigin, matchedText: string | null,
    isNewlyGenerated: boolean, summary: string | undefined,
  ) => {
    if (bySlug.has(slug)) return
    bySlug.set(slug, { slug, name, origin, matchedText, isNewlyGenerated, summary })
  }

  // 1) {lex:Name}-Direktiven. Ein Tag kann auf einen bestehenden Begriff
  //    zeigen (dann nur verlinken) ODER auf einen, der noch nicht existiert
  //    (dann jetzt generieren) — in beiden Fällen bleibt origin='tag', weil
  //    die Herkunft (explizite Direktive) zählt, nicht ob schon Inhalt existiert.
  //    isNewlyGenerated hält zusätzlich fest, ob der Inhalt ungeprüfter,
  //    frisch generierter LLM-Text ist — das ist eine andere Achse als origin
  //    und wird von Task 11/12 gebraucht, um Freigabe-Vorauswahl korrekt zu
  //    steuern (ein frischer Tag-Kandidat hat dieselbe Vertrauensstufe wie ein
  //    frischer new-Kandidat, obwohl beide origin unterschiedlich ist).
  for (const name of tagged) {
    const existingSlug = findTermSlugByName(name, knownTerms)
    if (existingSlug) {
      // summary noch unbekannt — knownTerms trägt sie nicht (s. Nachschlag unten).
      addCandidate(existingSlug, name, 'tag', null, false, undefined)
      continue
    }
    const created = await tryGenerateDraft(supabase, name)
    if (created) {
      knownTerms.push(created)
      addCandidate(created.slug, created.canonicalName, 'tag', null, true, created.summary)
    }
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
    const created = await tryGenerateDraft(supabase, name)
    if (created) {
      knownTerms.push(created)
      addCandidate(created.slug, created.canonicalName, 'new', null, true, created.summary)
    }
  }

  // Nachschlag für Kandidaten, die auf einen BEREITS existierenden Begriff
  // aufgelöst wurden (Matcher-Treffer, oder tag/new-Namen mit bestehendem
  // Eintrag): weder publishedTerms (getMatcherTerms, Egress-schmal) noch
  // knownTerms (GlossaryMatcherTerm, kein summary-Feld) führen die summary
  // mit. Ein gezielter Batch-Nachschlag statt eines Joins in jeder
  // Matcher-Query, die dafür nicht gebaut ist.
  const needSummary = Array.from(bySlug.values())
    .filter((c) => c.summary === undefined)
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
