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
 * veröffentlichte UND bereits als draft angelegte Begriffe — ein unbestätigter
 * Kandidat aus einem früheren Artikel wird so wiederverwendet statt erneut
 * (teuer) generiert zu werden.
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
): Promise<GlossaryMatcherTerm | null> {
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

    return { slug: generated.slug, canonicalName: generated.canonicalName, aliases: generated.aliases }
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
  const { data: draftRows } = await supabase
    .from('glossary_terms')
    .select('slug, canonical_name, aliases')
    .eq('status', 'draft')
  const draftTerms: GlossaryMatcherTerm[] = ((draftRows ?? []) as Array<Record<string, unknown>>).map((r) => ({
    slug: r.slug as string,
    canonicalName: r.canonical_name as string,
    aliases: (r.aliases ?? []) as string[],
  }))

  // Wächst während des Laufs: ein in diesem Tick neu generierter Begriff soll
  // bei einer zweiten Erwähnung im selben Artikel nicht doppelt generiert werden.
  const knownTerms: GlossaryMatcherTerm[] = [...publishedTerms, ...draftTerms]

  const bySlug = new Map<string, GlossaryCandidate>()
  // Erste Quelle gewinnt bei Kollision: tag (explizite Ghostwriter-Direktive)
  // vor match vor new, entsprechend der Verarbeitungsreihenfolge unten.
  const addCandidate = (slug: string, name: string, origin: GlossaryCandidateOrigin, matchedText: string | null) => {
    if (bySlug.has(slug)) return
    bySlug.set(slug, { slug, name, origin, matchedText })
  }

  // 1) {lex:Name}-Direktiven. Ein Tag kann auf einen bestehenden Begriff
  //    zeigen (dann nur verlinken) ODER auf einen, der noch nicht existiert
  //    (dann jetzt generieren) — in beiden Fällen bleibt origin='tag', weil
  //    die Herkunft (explizite Direktive) zählt, nicht ob schon Inhalt existiert.
  for (const name of tagged) {
    const existingSlug = findTermSlugByName(name, knownTerms)
    if (existingSlug) {
      addCandidate(existingSlug, name, 'tag', null)
      continue
    }
    const created = await tryGenerateDraft(supabase, name)
    if (created) {
      knownTerms.push(created)
      addCandidate(created.slug, created.canonicalName, 'tag', null)
    }
  }

  // 2) Matcher-Treffer gegen bereits veröffentlichte Begriffe — Inhalt existiert
  //    bereits, hier wird nur die Trefferstelle mitgegeben.
  for (const mention of matched) {
    const term = publishedTerms.find((t) => t.slug === mention.slug)
    addCandidate(mention.slug, term?.canonicalName ?? mention.matchedText, 'match', mention.matchedText)
  }

  // 3) Vom LLM neu identifizierte Begriffe ohne (bekannten) Glossareintrag.
  for (const name of fresh) {
    const existingSlug = findTermSlugByName(name, knownTerms)
    if (existingSlug) {
      addCandidate(existingSlug, name, 'new', null)
      continue
    }
    const created = await tryGenerateDraft(supabase, name)
    if (created) {
      knownTerms.push(created)
      addCandidate(created.slug, created.canonicalName, 'new', null)
    }
  }

  return Array.from(bySlug.values())
}
