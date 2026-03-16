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
import {
  getActiveLearnedPatterns,
  findSimilarEditExamples,
  buildPromptEnhancement,
  trackPatternUsage,
  type LearnedPattern,
} from '@/lib/edit-learning/retrieval'
import { type AIModel, resolveModel } from './ghostwriter'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '')

function domainFromUrl(url: string | null): string | null {
  if (!url) return null
  try { return new URL(url).hostname.replace('www.', '') } catch { return null }
}

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

SPRACHE: Gesamter Output auf DEUTSCH — Überschrift (##), Fließtext, Synthszr Take. NIEMALS englische Überschriften. Fachbegriffe dürfen auf Englisch bleiben.

SYNTHSZR TAKE — PERSONA:
Schreibe als erfahrener Tech-Stratege für informierte Leser. Kein LinkedIn-Stil, keine Dramatik, keine rhetorischen Fragen.

INHALTLICHE TREUE (HÖCHSTE PRIORITÄT):
Dein Synthszr Take MUSS sich inhaltlich auf den NEWS-INHALT im User-Prompt beziehen. Verwende konkrete Fakten, Zahlen und Namen AUS DIESER NEWS. Schreibe NIEMALS einen Take über ein anderes Thema als die vorliegende News.

TAKE-STRUKTUR (5-7 Sätze, diese Reihenfolge):
1. Konkrete Beobachtung oder Zahl aus der News — KEIN evaluativer Einstieg
2. Warum das strategisch relevant ist (Marktmechanik, Wirtschaftlichkeit, Wettbewerb)
3–4. Konkrete Implikation für den Leser
5. Nüchterne Einschätzung: positiv ODER negativ, nie unverbindlich-neutral

ERLAUBTE SATZANFÄNGE im Take: Eigenname, Zahl, konkretes Substantiv, aktives Verb
VERBOTENE SATZANFÄNGE: "Das...", "Dies...", "Hier...", "Es...", "Was...", "Ob...", "Die Frage..."

POSITIVES BEISPIEL — GUTER TAKE:
Synthszr Take: Anthropic monetarisiert Compliance-Arbeit. Enterprise-Kunden zahlen für ein Modell, das den Security-Review besteht, Intelligenz ist sekundär. "ISO-27001-ready und auditierbar" schlägt jedes Performance-Argument im Vertrieb. Modelle werden austauschbar; wer den Beschaffungsprozess beherrscht, gewinnt.

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

SCHREIBSTIL (GESAMTER ABSCHNITT — NEWS + TAKE):

GRUNDHALTUNG:
Schreib wie ein scharf denkender Mensch, der etwas zu sagen hat. Kein Vorgeplänkel, keine Ankündigung. Der erste Satz ist der stärkste. Komm sofort zum Punkt.

SPRACHE:
- Natürliche Verkürzungen: "ich hab", "du kannst nicht", "das reicht nicht"
- Satzlänge variieren: kurze, harte Sätze. Dann ab und zu längere, die eine Beobachtung ausführen. Nie drei lange Sätze hintereinander.
- Konkret statt abstrakt: Zahlen, Namen, greifbare Details. "Viele Unternehmen scheitern" ist wertlos. "Cotti Coffee hat 6.000 Shops in 12 Monaten eröffnet" ist ein Argument.
- Unsicherheit klar markieren: "wahrscheinlich", "könnte sein" — klingt menschlich. Scheingewissheit wirkt aufgesetzt.
- Einschübe in Klammern für ehrliche Kommentare oder kurze Abschweifungen (so wie hier).
- Humor durch Präzision: unerwartet konkrete Details sind besser als jede Pointe. "Drei Unterschriften, zwei Committees, sechs Wochen" statt "der Prozess ist schwerfällig".
- Aktive Verben statt Nominalstil: "X steigert Umsatz" statt "eine Umsatzsteigerung wird erzielt".

FORMATIERUNG:
- KEINE Gedankenstriche (—). Stattdessen: Komma, Punkt, Doppelpunkt, Semikolon oder Klammer.
- Fettschrift sparsam: nur wenn ein Begriff wirklich heraussticht.

VERBOTENE FORMULIERUNGEN:
- Tote KI-Sprache: "In der heutigen...", "Es ist wichtig zu beachten", "Gamechanger", "bahnbrechend", "unkompliziert", "nutzen/einsetzen" als leere Business-Sprache
- Tote Übergänge: "darüber hinaus", "zusätzlich", "außerdem" (wenn mechanisch), "besonders interessant daran ist...", "anders gesagt...", "um das einzuordnen..."
- Engagement-Köder: "Lass das mal sacken", "Lies das nochmal", "Das verändert alles", "Punkt."
- Generische Insider-Behauptungen: "Hier kommt der Teil, über den niemand spricht", "Was dir keiner sagt", alles mit "niemand" oder "die meisten merken nicht"
- DER GROSSE FEHLER (FATAL): "Das ist nicht X. Das ist Y.", "Nicht X. Y.", "Vergiss X. Das ist Y.", "Weniger X, mehr Y." — jede Konstruktion, die erst ein Framing negiert und dann ein korrigiertes behauptet. Formuliere DIREKT POSITIV.`

// ─────────────────────────────────────────────────────────────────────────────
// Pass 1: Article Planning
// ─────────────────────────────────────────────────────────────────────────────

export async function planArticle(items: PipelineItem[], model: AIModel): Promise<ArticlePlan> {
  const itemList = items
    .map(
      (item, i) =>
        `${i + 1}. TITEL: ${item.title}\n   QUELLE: ${item.source_display_name || item.source_identifier}\n   INHALT: ${(item.content || '').slice(0, 600).replace(/\n/g, ' ')}`
    )
    .join('\n\n')

  const planSystemPrompt = `Du bist Chef-Redakteur des Synthszr Newsletters. Dein Output ist ausschließlich valides JSON — keine Erklärungen, kein Markdown.`

  const planPrompt = `Analysiere diese ${items.length} News-Items und erstelle einen Artikel-Plan für den Synthszr Newsletter.

ITEMS:
${itemList}

KATEGORIEN — jedes Item bekommt genau EINE Kategorie:
[AI Tech|Gossip|Politik|UX|Informatik|Robotik|Gesellschaft|Philosophie]

SORTIERUNG nach Kategorie (HÖCHSTE PRIORITÄT für ordering):
1. AI Tech → 2. Gossip → 3. Politik → 4. UX → 5. Informatik → 6. Robotik → 7. Gesellschaft → 8. Philosophie
Innerhalb derselben Kategorie: nach journalistischer Relevanz sortieren.

SPRACHE — ABSOLUT VERBINDLICH:
- ALLE Outputs (articleTitle, headings, excerptBullets, thesis, introParagraph) MÜSSEN auf DEUTSCH sein.
- NIEMALS englische Überschriften — auch nicht bei englischsprachigen Quellen.
- Fachbegriffe (Token, Reasoning, API, Fine-Tuning) dürfen Englisch bleiben, eingebettet in deutsche Sätze.

HEADLINE-STIL — INTELLEKTUELLER WORTWITZ (HÖCHSTE PRIORITÄT):
Headlines sollen scharf denken, nicht aufmerksamkeitsheischend sein.
Humor durch Präzision: unerwartet konkrete Details statt Pointen.
Doppeldeutigkeiten, die erst beim zweiten Lesen landen.
Lakonisches Understatement statt Dramatik.

GUTE HEADLINES (SO SOLL ES KLINGEN):
- "Wenn der Compiler billiger wird als der Kaffee"
- "Drei Unterschriften, zwei Committees, sechs Wochen: Agentic AI trifft deutsche Beschaffung"
- "Gemini kann jetzt Code schreiben. Die IDE hat das noch nicht mitbekommen."
- "OpenAI verkauft Compliance. Anthropic auch. Die Frage ist nur: an wen zuerst"
- "Der Praktikant heißt jetzt Claude und macht keine Pause"

SCHLECHTE HEADLINES (VERBOTEN):
- "OpenAI Launches New Model" ← Englisch (FATALER FEHLER)
- "New AI Tools and Updates" ← Englisch + generisch
- "KI-Update: Die wichtigsten News" ← generisch, hohl
- "Spannende Entwicklungen in der KI-Welt" ← tote Sprache
- "OpenAI launcht GPT-5.2" ← reine Nacherzählung, keine These

REGELN PRO FELD:
- articleTitle: Übergreifende These oder pointierter Gedanke aus ALLEN Items zusammen. Was ist die tiefere Erkenntnis?
- headings: KEINE Nacherzählung ("X launcht Y"). Eine These, Implikation oder pointierte Beobachtung.
- excerptBullets: Eigenständige Mini-Headlines, je max 65 Zeichen. Jede soll für sich stehen und neugierig machen.
- thesis: Der rote Faden. Nicht die offensichtliche Gemeinsamkeit ("alles über KI"), sondern die tiefere Verbindung.

Erstelle folgenden JSON-Plan:
{
  "thesis": "Ein Satz auf DEUTSCH — thematischer Kern als Leitfaden",
  "ordering": [1, 3, 7, 2],
  "headings": {"1": "Pointierte These auf DEUTSCH — kein 'X launcht Y'", "2": "..."},
  "articleTitle": "Witzige, scharfe These auf DEUTSCH — Humor durch Präzision",
  "excerptBullets": ["Max 65 Zeichen, DEUTSCH, pointiert", "...", "..."],
  "category": "AI & Tech",
  "introParagraph": "2-3 Sätze auf DEUTSCH. Direkter Einstieg mit konkreter Beobachtung, kein LLM-Stil."
}`

  const text = await callModelNonStreaming(planPrompt, planSystemPrompt, model)

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
  promptText: string,
): Promise<string> {
  const publicCompanyList = Object.keys(KNOWN_COMPANIES).join(', ')
  const premarketCompanyList = Object.keys(KNOWN_PREMARKET_COMPANIES).join(', ')

  const rawSourceName = item.source_display_name || item.source_identifier
  const hasValidSource = rawSourceName && rawSourceName !== 'unknown'
  // Derive a meaningful display name: prefer display_name > identifier > URL domain
  const sourceName = hasValidSource
    ? rawSourceName
    : (item.source_url ? domainFromUrl(item.source_url) : null)
  // Company tag line: companies + linked source (the ONE place source appears in output)
  // When no meaningful source can be determined, omit the arrow+source entirely
  const tagSourcePart = item.source_url && sourceName
    ? `[${sourceName}](${item.source_url})`
    : sourceName || null

  const userPrompt = `${promptText}

---

ARTIKEL-KONTEXT: ${thesis}

Schreibe GENAU DIESEN EINEN Abschnitt. Kein Intro, keine anderen News, kein Abschluss.

NEWS-INHALT (Quelleninfo nur für dich${sourceName ? ` — Quelle: ${sourceName}` : ''}${item.source_url ? ` | URL: ${item.source_url}` : ''}):
${item.content || 'Kein Inhalt verfügbar.'}

---

AUFGABE — EXAKT IN DIESER REIHENFOLGE, beginne mit "## ${heading}" (falls die Überschrift Englisch ist, übersetze sie in eine pointierte deutsche These):

1. **NEWS-ZUSAMMENFASSUNG:** 5-7 Sätze Fließtext (keine Bullet Points).

2. **COMPANY TAGGING + QUELLE:** Direkt nach dem letzten Satz der Zusammenfassung (VOR dem Synthszr Take) genau eine Zeile:${tagSourcePart ? `
   PFLICHT-FORMAT: {Company1} {Company2} → ${tagSourcePart}` : `
   PFLICHT-FORMAT: {Company1} {Company2}
   HINWEIS: Für diesen Artikel ist keine Quellenangabe verfügbar. NUR Company-Tags, KEIN Pfeil (→) und KEIN Quellenname.`}
   BEISPIEL: {OpenAI} {Anthropic} → [Techmeme](https://techmeme.com)
   Maximal 3 Company-Tags. Nur aus diesen Listen:
   PUBLIC: ${publicCompanyList}
   PREMARKET: ${premarketCompanyList}
   WICHTIG: Die Quelle erscheint NUR in dieser Zeile — KEIN separates "**Quelle:**" Label davor oder danach.

3. **SYNTHSZR TAKE:** "Synthszr Take:" gefolgt von 5-7 Sätzen im Analysten-Stil (sieh System-Prompt).

SYNTHSZR TAKE CHECKLISTE:
- INHALT-PFLICHT: Dein Take MUSS sich auf die Fakten im NEWS-INHALT oben beziehen. Nenne mindestens eine konkrete Zahl, einen Namen oder ein Detail AUS DIESER NEWS. Schreibe NIEMALS über ein anderes Thema.
- MINDESTENS 5 Sätze (Ziel: 5-7)
- Satz 1: Konkrete Beobachtung/Zahl AUS DEM NEWS-INHALT, KEIN evaluativer Einstieg
- VERBOTEN: Kontrastpaare, Abwarte-Formeln, Potenzial-Phrasen, Reframing, rhetorische Fragen, "Doch" als Satzanfang, Gedankenstriche (—)
- FATAL: "Nicht X. Y.", "Vergiss X. Das ist Y.", "Weniger X, mehr Y." → DIREKT POSITIV formulieren.
- Humor durch Präzision: unerwartet konkrete Details statt Pointen.
- Einschübe in Klammern für ehrliche Kommentare erlaubt.
- Klingt das wie ein Mensch, der das gedacht hat, oder wie ein Textgenerator?
- LETZTER CHECK: Bezieht sich dein Take auf "${heading}"? Wenn nicht, schreib ihn neu.`

  const text = await callModelNonStreaming(userPrompt, SECTION_SYSTEM_PROMPT, model)

  // Ensure section starts with the correct heading
  let trimmed = text.trim()
  if (!trimmed.startsWith('##')) {
    trimmed = `## ${heading}\n\n${trimmed}`
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
  const resolved = resolveModel(model)

  if (resolved?.provider === 'google') {
    const geminiModel = genAI.getGenerativeModel({
      model: resolved.modelId,
      systemInstruction: systemPrompt,
    })
    const result = await geminiModel.generateContent(prompt)
    return result.response.text()
  }

  if (resolved?.provider === 'anthropic') {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: resolved.modelId,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    })
    return (response.content[0] as { type: 'text'; text: string }).text
  }

  if (resolved?.provider === 'openai') {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const response = await openai.chat.completions.create({
      model: resolved.modelId,
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
    plan = await planArticle(items, model)
  } catch (err) {
    console.error('[Pipeline] planArticle failed:', err)
    // Fallback plan: sequential order, item titles as headings
    plan = {
      thesis: 'Aktuelle Tech-News und Marktanalyse',
      ordering: items.map((_, i) => i + 1),
      headings: Object.fromEntries(items.map((item, i) => [String(i + 1), item.title])),
      articleTitle: 'Tech-Digest',
      excerptBullets: items.slice(0, 3).map(i => i.title.slice(0, 65)),
      category: 'AI & Tech',
      introParagraph: 'Die wichtigsten Tech-News der Woche im Überblick.',
    }
  }

  yield { type: 'planned', itemCount: items.length }

  // ── Edit Learning: Load patterns and examples ──────────────────────────────
  let enhancedPrompt = promptText
  let loadedPatterns: LearnedPattern[] = []
  try {
    const [patterns, examples] = await Promise.all([
      getActiveLearnedPatterns(0.4, 20),
      findSimilarEditExamples(
        items.map(i => i.title).join(' ').slice(0, 2000), 3, 7
      ),
    ])
    loadedPatterns = patterns
    if (patterns.length > 0 || examples.length > 0) {
      const enhancement = buildPromptEnhancement(patterns, examples)
      if (enhancement) {
        enhancedPrompt = `${promptText}\n\n---\n\n${enhancement}`
        console.log(`[Pipeline] Enhanced prompt with ${patterns.length} patterns and ${examples.length} examples`)
      }
    }
  } catch (err) {
    console.error('[Pipeline] Failed to load Edit Learning patterns:', err)
  }

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
        results[i] = await writeSection(item, heading, plan.thesis, model, enhancedPrompt)
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

  // Track pattern usage after generation
  if (loadedPatterns.length > 0) {
    trackPatternUsage(loadedPatterns.map(p => p.id)).catch(err => {
      console.error('[Pipeline] Failed to track pattern usage:', err)
    })
  }

  yield { type: 'assembling' }
}
