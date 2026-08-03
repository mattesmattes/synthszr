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
import { buildTipTapBody, type TipTapDoc } from '@/lib/glossary/generate'
import { getMatcherTerms, getChartProductNames } from '@/lib/glossary/terms'
import { injectGlossaryMarks } from '@/lib/glossary/inject-marks'
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'
import type { LanguageCode } from '@/lib/types'

// ---------------------------------------------------------------------------
// translateTerm
// ---------------------------------------------------------------------------

/** Das Lexikon existiert nur de/en (app/[lang]/glossary/[slug]/page.tsx:
 *  "Lexikon-Content existiert nur de/en" — availableLocales dort ist fest
 *  ['de','en']). Jede andere LanguageCode würde eine Übersetzung schreiben,
 *  die nie gelesen wird (getGlossaryTerm() wird für diese Locales nie mit
 *  einem anderen `lang` aufgerufen) — reiner API-Kosten-Verschleiß, deshalb
 *  hart abgelehnt statt still zu übersetzen. */
const SUPPORTED_GLOSSARY_LANGS = ['de', 'en'] as const
type SupportedGlossaryLang = (typeof SUPPORTED_GLOSSARY_LANGS)[number]

function isSupportedGlossaryLang(lang: string): lang is SupportedGlossaryLang {
  return (SUPPORTED_GLOSSARY_LANGS as readonly string[]).includes(lang)
}

const TARGET_LANG_NAMES: Record<SupportedGlossaryLang, string> = {
  de: 'German',
  en: 'English',
}

interface GlossaryTermRow {
  id: string
  canonical_name: string
  aliases: string[]
  summary: string
  body: unknown
}

/** Deterministische Vorprüfung, analog lib/glossary/review.ts:isValidTipTapDoc
 *  — body ist jsonb ohne NOT NULL, ein kaputter/fehlender body würde sonst
 *  erst beim extractBlocks()-Zugriff mit einer TypeError abbrechen, statt mit
 *  einer sprechenden Fehlermeldung. */
function isValidTipTapDoc(body: unknown): body is TipTapDoc {
  if (!body || typeof body !== 'object') return false
  const content = (body as { content?: unknown }).content
  if (!Array.isArray(content)) return false
  return content.every((n) => Array.isArray((n as { content?: unknown }).content))
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
        description: 'Übersetzte Absätze/Überschriften, GLEICHE Reihenfolge und GLEICHE Struktur (paragraph/heading) wie die Quelle',
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
  body: TipTapDoc,
): string {
  const blocksJson = JSON.stringify(extractBlocks(body))
  return `Übersetze den folgenden Lexikoneintrag eines KI/Tech-Glossars nach ${targetLangName}. Erhalte Bedeutung, Ton und Struktur — keine Zusammenfassung, keine Kürzung, keine Ergänzung.

BEGRIFF: ${canonicalName}
ALIASSE: ${aliases.length ? aliases.join(', ') : '(keine)'}
SUMMARY: ${summary}

BLOCKS (JSON-Array, gleiche Reihenfolge und Struktur beibehalten):
${blocksJson}

Antworte via Tool mit dem übersetzten canonical_name, aliases, summary und blocks — GLEICHE Anzahl Blocks, GLEICHE type-Reihenfolge wie die Quelle.`
}

/**
 * Übersetzt einen Lexikonbegriff nach `targetLang` und schreibt das Ergebnis
 * nach glossary_term_translations (Upsert über den PK term_id+language).
 */
export async function translateTerm(termId: string, targetLang: string): Promise<void> {
  if (!isSupportedGlossaryLang(targetLang)) {
    throw new Error(`[glossary/translate] targetLang muss 'de' oder 'en' sein, erhalten: "${targetLang}"`)
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
        TARGET_LANG_NAMES[targetLang], term.canonical_name, term.aliases, term.summary, term.body,
      ),
    }],
  })
  const block = resp.content.find((b) => b.type === 'tool_use')
  const parsed = TranslationSchema.safeParse(block && 'input' in block ? block.input : null)
  if (!parsed.success) {
    throw new Error(`[glossary/translate] ungültige Tool-Antwort für ${termId}: ${parsed.error.message}`)
  }
  const t = parsed.data
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
 */
export async function reinjectGlossaryMarksForTranslation(
  sourceContent: unknown,
  translatedContent: unknown,
  targetLang: LanguageCode,
): Promise<unknown> {
  const slugs = extractLinkedSlugs(sourceContent)
  if (slugs.length === 0) return translatedContent

  const [terms, chartProductNames] = await Promise.all([
    getMatcherTerms(targetLang),
    getChartProductNames(),
  ])
  if (terms.length === 0) {
    // slugs stammen aus glossary_terms (status=published, sprachunabhängig)
    // — diese Begriffe existieren nachweislich. getMatcherTerms loggt einen
    // DB-Fehler intern und gibt dann [] zurück, OHNE ihn nach außen zu
    // signalisieren — eine leere Liste hier ist also mutmaßlich ein
    // verschluckter Ladefehler, kein echtes "keine Begriffe vorhanden". Eine
    // Übersetzung mit null Marks zu schreiben wäre der dauerhafte
    // Linkverlust, den diese Aufgabe beheben soll — deshalb abbrechen.
    throw new Error(
      `[glossary/translate] Zielsprach-Begriffsliste (${targetLang}) leer trotz ${slugs.length} ` +
      `verlinkter Slugs im Original — Injektion abgebrochen`,
    )
  }

  // Company- und Chart-Produktnamen reservieren, wie applyGlossaryConfirmation
  // (Kollisionsregel: Company > Chart-Produkt > Lexikonbegriff).
  const reserved = [
    ...Object.keys(KNOWN_COMPANIES),
    ...Object.keys(KNOWN_PREMARKET_COMPANIES),
    ...chartProductNames,
  ]
  return injectGlossaryMarks(translatedContent, slugs, terms, { reserved })
}
