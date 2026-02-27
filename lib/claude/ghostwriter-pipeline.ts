/**
 * Two-Pass Ghostwriter Pipeline
 *
 * Pass 1 (Planning, ~5s):   Gemini Flash analysiert alle Items → JSON mit Reihenfolge, Überschriften, Artikel-These, Intro
 * Pass 2 (Writing, parallel): Pro Item ein eigener LLM-Aufruf mit vollem Attention-Budget
 * Assembly:                   Sections in geplanter Reihenfolge zusammensetzen + Metadata-Block
 *
 * Vorteil vs. Single-Pass: Jeder Synthszr Take bekommt volle LLM-Attention statt 1/N.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { KNOWN_COMPANIES, KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'
import type { AIModel } from './ghostwriter'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '')

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PipelineItem {
  id: string
  title: string
  content: string | null
  source_display_name: string | null
  source_url: string | null
  source_identifier: string
}

export interface ArticlePlan {
  thesis: string          // Leitfaden-Satz für den Ghostwriter
  ordering: number[]      // 1-basierte Item-Indizes in optimaler Reihenfolge
  headings: Record<string, string>  // item index → deutsche Überschrift
  articleTitle: string
  excerptBullets: string[]  // genau 3 Einträge
  category: string
  introParagraph: string
}

export type PipelineEvent =
  | { type: 'planning'; message: string }
  | { type: 'planned'; itemCount: number }
  | { type: 'writing'; current: number; total: number; title: string }
  | { type: 'written'; current: number; total: number }
  | { type: 'assembling' }

// ─────────────────────────────────────────────────────────────────────────────
// System Prompt for per-item section writing (focused, no article-level rules)
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_SYSTEM_PROMPT = `Du bist ein Ghostwriter und schreibst EINEN einzelnen Abschnitt für den Synthszr Newsletter.

SPRACHE: Gesamter Output auf DEUTSCH. Fachbegriffe dürfen auf Englisch bleiben.

SYNTHSZR TAKE — PERSONA (HÖCHSTE PRIORITÄT):
Schreibe als erfahrener Tech-Stratege für informierte Fachkollegen — kein LinkedIn-Stil, keine Dramatik, keine rhetorischen Fragen. Nur: Was bedeutet das konkret für IT-Dienstleister, Agenturen oder Produktentwickler?

TAKE-STRUKTUR (5-7 Sätze, diese Reihenfolge):
1. Konkrete Beobachtung oder Zahl aus der News — KEIN evaluativer Einstieg
2. Warum das strategisch relevant ist (Marktmechanik, Wirtschaftlichkeit, Wettbewerb)
3–4. Konkrete Implikation für den Leser
5. Nüchterne Einschätzung: positiv ODER negativ, nie unverbindlich-neutral

ERLAUBTE SATZANFÄNGE im Take: Eigenname, Zahl, konkretes Substantiv, aktives Verb
VERBOTENE SATZANFÄNGE: "Das...", "Dies...", "Hier...", "Es...", "Was...", "Ob...", "Die Frage..."

POSITIVES BEISPIEL — GUTER TAKE:
Synthszr Take: Anthropic monetarisiert nicht Intelligenz, sondern Compliance-Arbeit. Enterprise-Kunden zahlen für ein Modell, das den Security-Review besteht — nicht für das klügste. Für Agenturen verschiebt sich der Pitch: Nicht "schneller als euer Team", sondern "ISO-27001-ready und auditierbar". Wer das ignoriert, verliert Deals an Berater, die diesen Satz kennen. Modelle werden austauschbar; wer den Beschaffungsprozess beherrscht, gewinnt.

NEGATIVES BEISPIEL — STRIKT VERBOTEN:
Synthszr Take: Das ist ein bedeutender Schritt für die KI-Branche. Einerseits zeigt dies das enorme Potenzial der Technologie, andererseits bleibt abzuwarten, ob dieser Ansatz nachhaltig ist. Die eigentliche Frage ist nicht ob KI kommt, sondern ob Unternehmen bereit sind.
[FALSCH: evaluativer Einstieg + Kontrastpaar + Potenzial-Floskel + Abwarte-Formel + Reframing]

ABSOLUT VERBOTEN:
- Einstieg mit Bewertung: "Das ist wichtig/bedeutend/bemerkenswert/spannend"
- Kontrastpaare: "einerseits... andererseits", "nicht nur... sondern auch", "zwar... aber"
- Abwarte-Formeln: "Es bleibt abzuwarten", "Die Zeit wird zeigen", "Man darf gespannt sein"
- Potenzial-Phrasen: "Das Potenzial ist enorm", "Die Möglichkeiten sind vielfältig"
- Reframing: "Die eigentliche Frage ist...", "Es geht nicht um X, sondern um Y"
- Pseudo-Offenheit: "Ob das gelingt, ist offen", "Wie sich das entwickelt, bleibt unklar"
- Rhetorische Fragen am Ende, "Doch" als Satzanfang, Pseudo-Mündlichkeit ("Mal ehrlich:")

STILREGELN:
- Asymmetrische Satzlängen: kurz–lang–mittel–kurz
- Konkrete Fakten und Zahlen statt vager Adjektive
- Aktive Verben statt Nominalstil`

// ─────────────────────────────────────────────────────────────────────────────
// Pass 1: Article Planning
// ─────────────────────────────────────────────────────────────────────────────

export async function planArticle(items: PipelineItem[]): Promise<ArticlePlan> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

  const itemList = items
    .map(
      (item, i) =>
        `${i + 1}. TITEL: ${item.title}\n   QUELLE: ${item.source_display_name || item.source_identifier}\n   VORSCHAU: ${(item.content || '').slice(0, 200).replace(/\n/g, ' ')}`
    )
    .join('\n\n')

  const planPrompt = `Du bist Redakteur des Synthszr Newsletters (Tech-Strategie für IT-Dienstleister und Agenturen).

Analysiere diese ${items.length} News-Items und erstelle einen Artikel-Plan.

ITEMS:
${itemList}

REIHENFOLGE-PRINZIP:
- OBEN: Praktische Tools, API-Updates, Produkt-Launches, Developer-News
- MITTE: Unternehmensstrategien, Marktdynamiken, Funding, Partnerschaften
- UNTEN: Politik, Regulierung, gesellschaftliche Debatten

Erstelle folgenden JSON-Plan (antworte NUR mit validem JSON, keine Erklärungen):
{
  "thesis": "Ein Satz — thematischer Kern als Leitfaden für den Ghostwriter",
  "ordering": [1, 3, 7, 2],
  "headings": {"1": "Deutsche Überschrift für Item 1", "2": "..."},
  "articleTitle": "Konkreter Artikel-Titel — keine generischen 'KI-Update'-Titel, sondern eine These oder einen pointierten Gedanken",
  "excerptBullets": ["Max 65 Zeichen, eigenständige Mini-Headline", "...", "..."],
  "category": "AI & Tech",
  "introParagraph": "2-3 Sätze Einleitung auf Deutsch. Direkter Einstieg mit konkreter Beobachtung — kein 'In einer Welt in der...', kein LLM-Stil."
}`

  const result = await model.generateContent(planPrompt)
  const text = result.response.text()

  // Strip possible markdown code fences
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || text.match(/(\{[\s\S]*\})/)
  const jsonStr = jsonMatch?.[1] || text

  const plan = JSON.parse(jsonStr) as ArticlePlan

  // Validate: ensure all items are in ordering
  const presentSet = new Set(plan.ordering)
  for (let i = 1; i <= items.length; i++) {
    if (!presentSet.has(i)) plan.ordering.push(i)
  }

  // Validate: ensure exactly 3 excerpt bullets
  while (plan.excerptBullets.length < 3) {
    const item = items[plan.excerptBullets.length]
    plan.excerptBullets.push(item?.title?.slice(0, 65) || '...')
  }
  plan.excerptBullets = plan.excerptBullets.slice(0, 3)

  return plan
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 2: Write individual section (per-item call)
// ─────────────────────────────────────────────────────────────────────────────

export async function writeSection(
  item: PipelineItem,
  heading: string,
  thesis: string,
  model: AIModel,
  promptText: string
): Promise<string> {
  const publicCompanyList = Object.keys(KNOWN_COMPANIES).join(', ')
  const premarketCompanyList = Object.keys(KNOWN_PREMARKET_COMPANIES).join(', ')

  const sourceName = item.source_display_name || item.source_identifier
  // Company tag line: companies + linked source (the ONE place source appears in output)
  const tagSourcePart = item.source_url
    ? `[${sourceName}](${item.source_url})`
    : `{${sourceName}}`

  const userPrompt = `${promptText}

---

ARTIKEL-KONTEXT: ${thesis}

Schreibe GENAU DIESEN EINEN Abschnitt. Kein Intro, keine anderen News, kein Abschluss.

NEWS-INHALT (Quelleninfo nur für dich — Quelle: ${sourceName}${item.source_url ? ` | URL: ${item.source_url}` : ''}):
${item.content || 'Kein Inhalt verfügbar.'}

---

AUFGABE — EXAKT IN DIESER REIHENFOLGE, beginne mit "## ${heading}":

1. **NEWS-ZUSAMMENFASSUNG:** 5-7 Sätze Fließtext (keine Bullet Points).

2. **COMPANY TAGGING + QUELLE:** Direkt nach dem letzten Satz der Zusammenfassung (VOR dem Synthszr Take) genau eine Zeile:
   PFLICHT-FORMAT: {Company1} {Company2} → ${tagSourcePart}
   BEISPIEL: {OpenAI} {Anthropic} → [Techmeme](https://techmeme.com)
   Maximal 3 Company-Tags. Nur aus diesen Listen:
   PUBLIC: ${publicCompanyList}
   PREMARKET: ${premarketCompanyList}
   WICHTIG: Die Quelle erscheint NUR in dieser Zeile — KEIN separates "**Quelle:**" Label davor oder danach.

3. **SYNTHSZR TAKE:** "Synthszr Take:" gefolgt von 5-7 Sätzen im Analysten-Stil (sieh System-Prompt).`

  const text = await callModelNonStreaming(userPrompt, SECTION_SYSTEM_PROMPT, model)

  // Ensure section starts with the correct heading
  const trimmed = text.trim()
  if (!trimmed.startsWith('##')) {
    return `## ${heading}\n\n${trimmed}`
  }
  return trimmed
}

// ─────────────────────────────────────────────────────────────────────────────
// Non-streaming model call
// ─────────────────────────────────────────────────────────────────────────────

async function callModelNonStreaming(
  prompt: string,
  systemPrompt: string,
  model: AIModel
): Promise<string> {
  if (model === 'gemini-2.5-pro' || model === 'gemini-2.0-flash') {
    const geminiModel = genAI.getGenerativeModel({
      model,
      systemInstruction: systemPrompt,
    })
    const result = await geminiModel.generateContent(prompt)
    return result.response.text()
  }

  if (model === 'claude-opus-4' || model === 'claude-sonnet-4') {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const modelId =
      model === 'claude-opus-4' ? 'claude-opus-4-20250514' : 'claude-sonnet-4-20250514'
    const response = await anthropic.messages.create({
      model: modelId,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    })
    return (response.content[0] as { type: 'text'; text: string }).text
  }

  if (model === 'gpt-5.2' || model === 'gpt-5.2-mini') {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    })
    return response.choices[0]?.message?.content || ''
  }

  // Fallback: Gemini Flash
  const fallback = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
  })
  const result = await fallback.generateContent(prompt)
  return result.response.text()
}

// ─────────────────────────────────────────────────────────────────────────────
// Main pipeline runner (async generator for streaming progress)
// ─────────────────────────────────────────────────────────────────────────────

export async function* runGhostwriterPipeline(
  items: PipelineItem[],
  promptText: string,
  model: AIModel,
  concurrency = 3
): AsyncGenerator<PipelineEvent | { type: 'section'; text: string } | { type: 'metadata'; text: string }> {
  // ── Pass 1: Plan ────────────────────────────────────────────────────────────
  yield { type: 'planning', message: `Struktur für ${items.length} Items planen...` }

  let plan: ArticlePlan
  try {
    plan = await planArticle(items)
  } catch (err) {
    console.error('[Pipeline] planArticle failed:', err)
    // Fallback plan: sequential order, item titles as headings
    plan = {
      thesis: 'Aktuelle Tech-News für IT-Dienstleister und Agenturen',
      ordering: items.map((_, i) => i + 1),
      headings: Object.fromEntries(items.map((item, i) => [String(i + 1), item.title])),
      articleTitle: 'Tech-Digest',
      excerptBullets: items.slice(0, 3).map(i => i.title.slice(0, 65)),
      category: 'AI & Tech',
      introParagraph: 'Die wichtigsten Tech-News der Woche im Überblick.',
    }
  }

  yield { type: 'planned', itemCount: items.length }

  // Emit metadata block immediately so client can show title/excerpt
  const excerptLines = plan.excerptBullets
    .map(b => (b.startsWith('•') ? b : `• ${b}`))
    .join('\n')

  const metadataBlock = `---\nTITLE: ${plan.articleTitle}\nEXCERPT:\n${excerptLines}\nCATEGORY: ${plan.category || 'AI & Tech'}\n---\n\n${plan.introParagraph}\n\n`
  yield { type: 'metadata', text: metadataBlock }

  // ── Pass 2: Write sections in parallel ──────────────────────────────────────
  const orderedItems = plan.ordering.map(idx => items[idx - 1]).filter(Boolean)
  let writtenCount = 0

  // Use a results array and a "notify" mechanism so we can yield sections as
  // soon as they arrive in order (real progressive streaming)
  const results: Array<string | undefined> = new Array(orderedItems.length)
  const resolvers: Array<() => void> = []
  const waitFor = (i: number) =>
    results[i] !== undefined
      ? Promise.resolve()
      : new Promise<void>(r => {
          resolvers[i] = r
        })

  // Start bounded-parallel tasks
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, orderedItems.length) }, async () => {
    while (cursor < orderedItems.length) {
      const i = cursor++
      const item = orderedItems[i]
      const itemIdx = plan.ordering[i]
      const heading = plan.headings[String(itemIdx)] || item.title

      try {
        results[i] = await writeSection(item, heading, plan.thesis, model, promptText)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error(`[Pipeline] writeSection ${i + 1} failed:`, errMsg)
        results[i] = `## ${heading}\n\n*Fehler: ${errMsg}*\n`
      }
      writtenCount++
      resolvers[i]?.()
    }
  })

  // Yield sections in order as they become available
  const workersPromise = Promise.all(workers)
  for (let i = 0; i < orderedItems.length; i++) {
    await waitFor(i)
    yield { type: 'writing', current: i + 1, total: orderedItems.length, title: orderedItems[i].title }
    yield { type: 'section', text: results[i]! + '\n\n' }
    yield { type: 'written', current: i + 1, total: orderedItems.length }
  }
  await workersPromise

  yield { type: 'assembling' }
}
