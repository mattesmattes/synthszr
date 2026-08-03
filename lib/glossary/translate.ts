/**
 * Übersetzung fürs Fachbegriff-Lexikon (Task 16): übersetzt einen Begriff
 * (canonical_name, aliases, summary, body) nach glossary_term_translations,
 * und injiziert Glossar-Marks in übersetzten ARTIKEL-Content neu.
 *
 * Eigener Use Case (glossary_translation) statt Wiederverwendung von
 * translateContent/translateWithClaude (lib/i18n/translation-service.ts):
 * jener Service ist auf Artikel zugeschnitten (title/excerpt/content,
 * Chunking ab 30k Zeichen, Slug-Generierung, bundleType-Wiederherstellung)
 * und kennt kein Aliase-Array — ein Begriff braucht das, ein Artikel nicht.
 * Alle übrigen Glossar-LLM-Aufrufe (generate.ts, products.ts, review.ts)
 * folgen demselben Tool-Call+Zod-Schema+getModelForUseCase-Muster —
 * Übersetzung schließt sich dem an, statt eine dritte Konvention
 * einzuführen.
 *
 * translateTerm läuft NICHT über translation_queue: dessen CHECK-Constraint
 * kennt nur generated_post|static_page|ui, und der Cron verarbeitet nur 3
 * Übersetzungen pro 15-Minuten-Tick — Glossareinträge würden die täglichen
 * Artikelübersetzungen verdrängen.
 */
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildTipTapBody, isValidTipTapDoc, type TipTapDoc } from '@/lib/glossary/generate'
import { getMatcherTerms, getChartProductNames, buildReservedNames } from '@/lib/glossary/terms'
import { injectGlossaryMarks } from '@/lib/glossary/inject-marks'
import type { LanguageCode } from '@/lib/types'

// ---------------------------------------------------------------------------
// translateTerm
// ---------------------------------------------------------------------------

/** Das Lexikon existiert nur de/en, und `de` ist bereits die Quellsprache in
 *  glossary_terms selbst — eine Übersetzung NACH `de` würde nie gelesen
 *  (getGlossaryTerm/applyTermTranslation ruft die Übersetzungstabelle nur für
 *  `lang !== 'de'` auf, app/[lang]/glossary/[slug]/page.tsx:54-57). Reiner
 *  API-Kosten-Verschleiß, deshalb ist `en` der einzige gültige Zielwert.
 *
 *  Review-Fund Minor 2+3 (Fix-Runde 1): ursprünglich waren de+en erlaubt,
 *  mit der Begründung "das Lexikon existiert nur in de/en". Das war zu
 *  großzügig — es beschreibt, welche Sprachen das Lexikon RENDERT, nicht
 *  welche als ÜBERSETZUNGSZIEL sinnvoll sind. `de` ist nie ein sinnvolles
 *  Ziel, deshalb jetzt nur `en`. */
export const SUPPORTED_GLOSSARY_LANGS = ['en'] as const
export type SupportedGlossaryLang = (typeof SUPPORTED_GLOSSARY_LANGS)[number]

function isSupportedGlossaryLang(lang: string): lang is SupportedGlossaryLang {
  return (SUPPORTED_GLOSSARY_LANGS as readonly string[]).includes(lang)
}

const TARGET_LANG_NAMES: Record<SupportedGlossaryLang, string> = {
  en: 'English',
}

interface GlossaryTermRow {
  id: string
  canonical_name: string
  aliases: string[]
  summary: string
  body: unknown
}

/** Kehrt buildTipTapBody um: liefert die Blocks (type + Text), die der
 *  Übersetzungs-Prompt braucht. body ist an dieser Stelle bereits als
 *  TipTapDoc validiert (isValidTipTapDoc). */
function extractBlocks(body: TipTapDoc): Array<{ type: 'paragraph' | 'heading'; text: string }> {
  return body.content.map((node) => ({
    type: node.type,
    text: node.content.map((t) => t.text).join(''),
  }))
}

const TranslationSchema = z.object({
  canonical_name: z.string().min(1),
  aliases: z.array(z.string()),
  summary: z.string().min(1),
  blocks: z.array(z.object({ type: z.enum(['paragraph', 'heading']), text: z.string() })),
})

const TRANSLATE_TOOL = {
  name: 'translate_glossary_term',
  description: 'Einen Lexikoneintrag in eine Zielsprache übersetzen, Struktur und Bedeutung erhaltend',
  input_schema: {
    type: 'object' as const,
    properties: {
      canonical_name: { type: 'string', description: 'Übersetzter kanonischer Begriffsname' },
      aliases: { type: 'array', items: { type: 'string' }, description: 'Übersetzte Aliasse/Abkürzungen' },
      summary: { type: 'string', description: 'Übersetzte 1–2-Satz-Kurzbeschreibung' },
      blocks: {
        type: 'array',
        description: 'Übersetzte Absätze/Überschriften — GENAU dieselbe Anzahl und GLEICHE Reihenfolge (paragraph/heading) wie die Quelle, kein Block darf entfallen oder zusammengefasst werden',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['paragraph', 'heading'] },
            text: { type: 'string' },
          },
          required: ['type', 'text'],
        },
      },
    },
    required: ['canonical_name', 'aliases', 'summary', 'blocks'],
  },
}

function buildTranslatePrompt(
  targetLangName: string,
  canonicalName: string,
  aliases: string[],
  summary: string,
  sourceBlocks: Array<{ type: 'paragraph' | 'heading'; text: string }>,
): string {
  return `Übersetze den folgenden Lexikoneintrag eines KI/Tech-Glossars nach ${targetLangName}. Erhalte Bedeutung, Ton und Struktur — keine Zusammenfassung, keine Kürzung, keine Ergänzung.

BEGRIFF: ${canonicalName}
ALIASSE: ${aliases.length ? aliases.join(', ') : '(keine)'}
SUMMARY: ${summary}

BLOCKS (JSON-Array, gleiche Reihenfolge und Struktur beibehalten):
${JSON.stringify(sourceBlocks)}

Antworte via Tool mit dem übersetzten canonical_name, aliases, summary und blocks — GENAU ${sourceBlocks.length} Blocks, GLEICHE type-Reihenfolge wie die Quelle. Kein Block darf entfallen, verkürzt oder zusammengefasst werden.`
}

/**
 * Übersetzt einen Lexikonbegriff nach `targetLang` und schreibt das Ergebnis
 * nach glossary_term_translations (Upsert über den PK term_id+language).
 */
export async function translateTerm(termId: string, targetLang: string): Promise<void> {
  if (!isSupportedGlossaryLang(targetLang)) {
    throw new Error(
      `[glossary/translate] targetLang muss eine von ${SUPPORTED_GLOSSARY_LANGS.join(', ')} sein, erhalten: "${targetLang}"`,
    )
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('[glossary/translate] ANTHROPIC_API_KEY fehlt')
  }

  const supabase = createAdminClient()
  const { data: row, error } = await supabase
    .from('glossary_terms')
    .select('id, canonical_name, aliases, summary, body')
    .eq('id', termId)
    .maybeSingle()
  if (error) throw new Error(`[glossary/translate] Begriff ${termId} nicht ladbar: ${error.message}`)
  if (!row) throw new Error(`[glossary/translate] Begriff ${termId} nicht gefunden`)
  const term = row as GlossaryTermRow
  if (!isValidTipTapDoc(term.body)) {
    throw new Error(`[glossary/translate] Begriff ${termId} hat keinen gültigen body`)
  }
  const sourceBlocks = extractBlocks(term.body)

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { getModelForUseCase } = await import('@/lib/ai/model-config')
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const model = await getModelForUseCase('glossary_translation')

  const resp = await client.messages.create({
    model, max_tokens: 4096, tools: [TRANSLATE_TOOL],
    tool_choice: { type: 'tool', name: TRANSLATE_TOOL.name },
    messages: [{
      role: 'user',
      content: buildTranslatePrompt(
        TARGET_LANG_NAMES[targetLang], term.canonical_name, term.aliases, term.summary, sourceBlocks,
      ),
    }],
  })
  const block = resp.content.find((b) => b.type === 'tool_use')
  const parsed = TranslationSchema.safeParse(block && 'input' in block ? block.input : null)
  if (!parsed.success) {
    throw new Error(`[glossary/translate] ungültige Tool-Antwort für ${termId}: ${parsed.error.message}`)
  }
  const t = parsed.data
  // Review-Fund Minor 1 (Fix-Runde 1): max_tokens=4096 ohne Prüfung der
  // Blockzahl gegen die Quelle ließ eine bei einem stop_reason='max_tokens'
  // abgeschnittene Antwort unbemerkt durch — buildTipTapBody verwirft leere
  // Blocks kommentarlos, das Ergebnis wäre ein still verkürzter englischer
  // Erklärtext. Kein QA findet das (der Review-Cron liest nur die deutsche
  // Quelle, nie glossary_term_translations). Deshalb hier abbrechen, statt
  // eine unvollständige Übersetzung zu schreiben.
  if (t.blocks.length !== sourceBlocks.length) {
    throw new Error(
      `[glossary/translate] Blockzahl der Übersetzung (${t.blocks.length}) weicht von der Quelle ` +
      `(${sourceBlocks.length}) ab für ${termId} — vermutlich abgeschnittene Modellantwort`,
    )
  }
  const translatedBody = buildTipTapBody(t.blocks)
  if (translatedBody.content.length === 0) {
    throw new Error(`[glossary/translate] leerer übersetzter body für ${termId}`)
  }

  const { error: upsertError } = await supabase
    .from('glossary_term_translations')
    .upsert({
      term_id: termId,
      language: targetLang,
      canonical_name: t.canonical_name.trim(),
      aliases: t.aliases.map((a) => a.trim()).filter(Boolean),
      summary: t.summary.trim(),
      body: translatedBody,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'term_id,language' })
  if (upsertError) {
    throw new Error(`[glossary/translate] Schreiben fehlgeschlagen für ${termId}: ${upsertError.message}`)
  }
}

// ---------------------------------------------------------------------------
// Mark-Neu-Injektion für übersetzte Artikel
// ---------------------------------------------------------------------------

/** Sammelt alle Slugs, die im Content bereits als glossaryLink-Mark verlinkt
 *  sind (identitätsbasiert — WELCHE Begriffe redaktionell bestätigt wurden,
 *  applyGlossaryConfirmation/Task 11). Die Marks selbst werden NICHT
 *  übernommen: die Übersetzung kann Textknoten verschmelzen/aufspalten,
 *  ordinales Matching (wie reapplyBundleTypeAttrs es für bundleType versucht,
 *  lib/i18n/translation-service.ts) würde dabei brechen. Nur die Slug-Auswahl
 *  überlebt, die Textstelle wird unten im übersetzten Text neu gesucht. */
function extractLinkedSlugs(content: unknown): string[] {
  const slugs: string[] = []
  const seen = new Set<string>()
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const o = node as Record<string, unknown>
    const marks = Array.isArray(o.marks) ? o.marks : []
    for (const m of marks) {
      const mark = m as { type?: string; attrs?: { slug?: string } }
      const slug = mark.attrs?.slug
      if (mark.type === 'glossaryLink' && typeof slug === 'string' && !seen.has(slug)) {
        seen.add(slug)
        slugs.push(slug)
      }
    }
    if (Array.isArray(o.content)) o.content.forEach(walk)
  }
  walk(content)
  return slugs
}

/**
 * Injiziert Glossar-Marks in übersetzten Artikel-Content neu — mit der
 * Begriffsliste der Zielsprache (getMatcherTerms), NICHT durch Übertragen
 * der Marks aus der Quelle. `sourceContent` ist der (unübersetzte) Content
 * VOR der Übersetzung, `translatedContent` das Ergebnis von translateContent.
 *
 * Läuft NICHT während der Übersetzung selbst: DB-Zugriff gehört hier hin,
 * nicht in lib/i18n/translation-service.ts (das hat keinen DB-Zugriff, die
 * Zielsprach-Begriffsliste kommt aber aus der DB — gleiche Trennung wie
 * generate.ts/products.ts in Task 15).
 *
 * Enthält der Quell-Content keine Glossar-Marks, ist nichts zu tun (kein
 * DB-Zugriff, translatedContent geht unverändert zurück).
 *
 * Review-Fund Important 1 (Fix-Runde 1): eine frühere Fassung brach ab
 * (throw), wenn getMatcherTerms([]) zurückgab — das deckte aber nur EINEN von
 * drei stillen Verlustpfaden ab (die anderen zwei: die Übersetzungsabfrage
 * schlägt fehl UND fällt auf deutsche Namen zurück statt das zu melden, oder
 * für die Zielsprache existiert schlicht noch keine Übersetzungszeile —
 * beides liefert eine NICHT-leere, aber für den übersetzten Text unbrauchbare
 * Liste, `terms.length === 0` feuert dann gar nicht). Und ein harter Abbruch
 * wäre für den dritten, häufigen Fall — ein verlinkter Begriff ist
 * zwischenzeitlich hidden/gelöscht — zu streng gewesen: das ist keine
 * Störung, die einen Retry der GESAMTEN Artikelübersetzung rechtfertigt.
 *
 * Deshalb jetzt: `wanted` (die Teilmenge der Zielsprach-Begriffe, die zu den
 * verlinkten Slugs passt) explizit bilden und bei Leere SICHTBAR machen
 * (console.error mit targetLang + Slugs), aber NICHT abbrechen — Sichtbarkeit
 * ist das Minimum, ein harter Abbruch träfe zu viele legitime Fälle. Die
 * eigentliche Übersetzung (Titel, Text) bleibt dadurch erhalten, auch wenn
 * in diesem Lauf keine Glossar-Links gesetzt werden konnten.
 */
export async function reinjectGlossaryMarksForTranslation(
  sourceContent: unknown,
  translatedContent: unknown,
  targetLang: LanguageCode,
): Promise<unknown> {
  const slugs = extractLinkedSlugs(sourceContent)
  if (slugs.length === 0) return translatedContent

  const [rawTerms, chartProductNames] = await Promise.all([
    getMatcherTerms(targetLang),
    getChartProductNames(),
  ])
  // getMatcherTerms gibt null zurück, wenn genau die Übersetzungsabfrage
  // fehlgeschlagen ist (terms.ts) — von einem legitimen "noch keine
  // Übersetzung vorhanden" (dort bereits pro Begriff auf die deutsche
  // Fassung degradiert) unterschieden. Für die Sichtbarkeits-Meldung unten
  // reicht die Unterscheidung "wanted leer", die Ursache (Ladefehler vs.
  // hidden/noch nicht übersetzt) landet zusätzlich im Log.
  const terms = rawTerms ?? []
  const wanted = terms.filter((t) => slugs.includes(t.slug))
  if (wanted.length === 0) {
    console.error(
      `[glossary/translate] Keine passenden Zielsprach-Begriffe (${targetLang}) für verlinkte Slugs ` +
      `gefunden — Übersetzung wird ohne Glossar-Links gespeichert. ` +
      (rawTerms === null ? 'Ursache: Übersetzungsabfrage fehlgeschlagen. ' : '') +
      `Slugs: ${slugs.join(', ')}`,
    )
  }

  // Company- und Chart-Produktnamen reservieren, wie applyGlossaryConfirmation
  // (Kollisionsregel: Company > Chart-Produkt > Lexikonbegriff).
  const reserved = buildReservedNames(chartProductNames)
  return injectGlossaryMarks(translatedContent, slugs, terms, { reserved })
}
