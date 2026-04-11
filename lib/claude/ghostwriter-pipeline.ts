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
import { getModelForUseCase } from '@/lib/ai/model-config'
import {
  getActiveLearnedPatterns,
  findSimilarEditExamples,
  buildPromptEnhancement,
  trackPatternUsage,
  type LearnedPattern,
} from '@/lib/edit-learning/retrieval'
import { type AIModel, resolveModel } from './ghostwriter'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '')

import { domainFromUrl, deriveSourceUrl } from '@/lib/news-queue/service'

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
  | { type: 'proofreading'; message: string }
  | { type: 'proofread'; text: string }

// ─────────────────────────────────────────────────────────────────────────────
// Company extraction: find mentioned companies in item text (avoids sending all 492 names per call)
// ─────────────────────────────────────────────────────────────────────────────

function extractRelevantCompanies(text: string): { public: string[]; premarket: string[] } {
  const textLower = (text || '').toLowerCase()
  const pub: string[] = []
  const pre: string[] = []

  for (const name of Object.keys(KNOWN_COMPANIES)) {
    if (name.length < 3) continue
    if (textLower.includes(name.toLowerCase())) {
      pub.push(name)
    }
  }

  for (const name of Object.keys(KNOWN_PREMARKET_COMPANIES)) {
    if (name.length < 3) continue
    if (textLower.includes(name.toLowerCase())) {
      pre.push(name)
    }
  }

  return { public: pub, premarket: pre }
}

// ─────────────────────────────────────────────────────────────────────────────
// System Prompt for per-item section writing (focused, no article-level rules)
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_SYSTEM_PROMPT = `Du bist ein Ghostwriter und schreibst EINEN einzelnen Abschnitt für den Synthszr Newsletter.

SPRACHE: Gesamter Output auf DEUTSCH. Überschrift, Fließtext, Synthszr Take: alles Deutsch. Englische Fachbegriffe (Token, Reasoning, Inference, Fine-Tuning, Open Source) bleiben Englisch.

PERSONA:
Schreibe wie ein erfahrener Tech-Stratege, der für informierte Leser denkt. Kein LinkedIn-Stil, keine Dramatik.

INHALTLICHE TREUE:
Dein Take MUSS sich auf die vorliegende News beziehen. Verwende konkrete Fakten, Zahlen und Namen aus dem User-Prompt.

SYNTHSZR TAKE — DENKWEISE:
Denke frei und assoziativ. Nutze unerwartete Analogien aus anderen Domänen (Franchise-Systeme, Biologie, Stadtplanung, Spieltheorie, Physik, Ökologie), um die News einzuordnen. Vermeide dabei konsequent Analogien aus dem Bereich Militär und Krieg — keine Schlachten, Waffen, Mobilmachung, Kampfverbände, Offensiven oder ähnliche Bildsprache. Historischer Kontext ist erwünscht. Nuancierte Positionen sind besser als Schwarz-Weiß-Urteile. Der letzte Satz soll eine prägnante Haltung zeigen, die für sich allein stehen kann.

5-8 Sätze, freier Fluss. Kein Zählen, kein Schema abarbeiten.

GUTE TAKES (SO SOLL ES KLINGEN):

Beispiel 1:
Synthszr Take: Xi Jinping setzt auf einen Führungsstil, den westliche Management-Theorie für unmöglich hält: zentrale Doktrin plus lokale Improvisation. Das Modell erinnert an Franchise-Systeme, bei denen Markenstandards gelten, aber der Filialleiter vor Ort entscheidet, wie er sie umsetzt. Chinas Wirtschaftswunder der letzten 40 Jahre basierte genau auf dieser Spannung: Peking gab die Richtung vor, Provinzgouverneure experimentierten mit Sonderwirtschaftszonen, Subventionsmodellen und Regulierung. Ob das unter verschärfter ideologischer Kontrolle weiter funktioniert, hängt davon ab, wie viel Spielraum "lokale Bedingungen berücksichtigen" in der Praxis bedeutet. Xi wettet darauf, dass Loyalität und Kreativität kein Nullsummenspiel sind.

Beispiel 2:
Synthszr Take: Anthropic monetarisiert Compliance-Arbeit. Enterprise-Kunden zahlen für ein Modell, das den Security-Review besteht, Intelligenz ist sekundär. "ISO-27001-ready und auditierbar" schlägt jedes Performance-Argument im Vertrieb. Modelle werden austauschbar; wer den Beschaffungsprozess beherrscht, gewinnt.

Beispiel 3:
Synthszr Take: Bluesky nutzt seine größte Schwäche gegen X: die Komplexität des AT-Protokolls. Nutzer, die sich durch Custom-Feeds arbeiten mussten, bekommen jetzt einen KI-Assistenten als Übersetzungsschicht. 15 Millionen Nutzer sind nichts gegen X's 500 Millionen, aber wenn jeder seinen eigenen Algorithmus per Chat konfigurieren kann, wird die Plattform-Logik auf den Kopf gestellt. Attie ist Blueskys Hebel für die Demokratisierung von Social Media.

SCHLECHTER TAKE (VERBOTEN):
Synthszr Take: Das ist ein bedeutender Schritt für die KI-Branche. Einerseits zeigt dies das enorme Potenzial der Technologie, andererseits bleibt abzuwarten, ob dieser Ansatz nachhaltig ist. Die Möglichkeiten sind vielfältig. Man darf gespannt sein, wie sich das entwickelt.
[WARUM SCHLECHT: Bewertungs-Einstieg, leere Floskeln, keine einzige konkrete Beobachtung, kein Gedanke]

VERBOTEN (nur die wirklich toxischen Muster):
- Einstieg mit Bewertung: "Das ist wichtig/bedeutend/bemerkenswert/spannend"
- Abwarte-Floskeln: "Es bleibt abzuwarten", "Die Zeit wird zeigen", "Man darf gespannt sein"
- Potenzial-Leerformeln: "Das Potenzial ist enorm", "Die Möglichkeiten sind vielfältig"
- Engagement-Köder: "Lass das mal sacken", "Das verändert alles", "Punkt."
- Generische Insider-Behauptungen: "Was dir keiner sagt", alles mit "niemand" oder "die meisten merken nicht"
- Negations-Reframing: "Das ist nicht X. Das ist Y.", "Vergiss X.", "Weniger X, mehr Y." Formuliere direkt positiv.
- Tote KI-Sprache: "In der heutigen...", "Es ist wichtig zu beachten", "Gamechanger", "bahnbrechend"

SCHREIBSTIL:
- Komm sofort zum Punkt. Der erste Satz ist der stärkste.
- Satzlänge variieren: kurze, harte Sätze. Dann längere, die eine Beobachtung ausführen. Nie drei lange hintereinander.
- Konkret statt abstrakt: Zahlen, Namen, greifbare Details.
- Unsicherheit klar markieren: "wahrscheinlich", "könnte sein" klingt menschlich.
- Einschübe in Klammern für ehrliche Kommentare (so wie hier).
- Humor durch Präzision, nicht durch Witze.
- KEINE Gedankenstriche (—). Stattdessen: Komma, Punkt, Doppelpunkt, Semikolon oder Klammer.

OUTPUT-FORMAT — halte dich an diese Reihenfolge:
1. Überschrift: "## [Überschrift]" — falls Englisch, übersetze in eine pointierte deutsche These.
2. NEWS-ZUSAMMENFASSUNG: 5-7 Sätze Fließtext (keine Bullet Points).
3. COMPANY TAGGING + QUELLE: Direkt nach Zusammenfassung (VOR Synthszr Take) genau eine Zeile:
   FORMAT: {Company1} {Company2} → [Quellenname](URL)
   BEISPIEL: {OpenAI} {Anthropic} → [Techmeme](https://techmeme.com)
   Max 3 Company-Tags. Falls KEINE Quelle: nur Tags, kein Pfeil/Quellenname.
   WICHTIG: Quelle NUR in dieser Zeile.
4. SYNTHSZR TAKE: "Synthszr Take:" + 5-8 Sätze, frei und assoziativ.`

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
  model: AIModel,
  context: {
    relevantCompanies: { public: string[]; premarket: string[] }
    cacheableUserPrefix: string
  },
): Promise<string> {
  const publicCompanyList = context.relevantCompanies.public.join(', ') || '(keine erkannt)'
  const premarketCompanyList = context.relevantCompanies.premarket.join(', ') || '(keine erkannt)'

  const rawSourceName = item.source_display_name || item.source_identifier
  const hasValidSource = rawSourceName && rawSourceName !== 'unknown'
  const sourceName = hasValidSource
    ? rawSourceName
    : (item.source_url ? domainFromUrl(item.source_url) : null)
  const articleUrl = item.source_url || deriveSourceUrl(null, item.source_identifier)
  const effectiveUrl = articleUrl
  const tagSourcePart = effectiveUrl && sourceName
    ? `[${sourceName}](${effectiveUrl})`
    : sourceName || null

  // Dynamic per-item prompt only — format template + checkliste are in SECTION_SYSTEM_PROMPT,
  // vocabulary + edit learning + thesis are in cacheableUserPrefix
  const userPrompt = `ÜBERSCHRIFT: ## ${heading}

NEWS-INHALT${sourceName ? ` (Quelle: ${sourceName}` : ''}${effectiveUrl ? ` | URL: ${effectiveUrl}` : ''}${sourceName ? ')' : ''}:
${(item.content || 'Kein Inhalt verfügbar.').slice(0, 6000)}

COMPANY-TAGS:${tagSourcePart ? `
QUELLFORMAT: → ${tagSourcePart}` : `
KEINE QUELLE — nur Company-Tags, kein Pfeil.`}
PUBLIC: ${publicCompanyList}
PREMARKET: ${premarketCompanyList}`

  const text = await callModelNonStreaming(userPrompt, SECTION_SYSTEM_PROMPT, model, {
    cacheableUserPrefix: context.cacheableUserPrefix,
  })

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
  model: AIModel,
  options?: { cacheableUserPrefix?: string; maxTokens?: number }
): Promise<string> {
  const tokenLimit = options?.maxTokens ?? 4096
  const resolved = resolveModel(model)

  if (resolved?.provider === 'google') {
    const geminiModel = genAI.getGenerativeModel({
      model: resolved.modelId,
      systemInstruction: systemPrompt,
    })
    const fullPrompt = options?.cacheableUserPrefix
      ? `${options.cacheableUserPrefix}\n\n${prompt}`
      : prompt
    const result = await geminiModel.generateContent(fullPrompt)
    return result.response.text()
  }

  if (resolved?.provider === 'anthropic') {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    // Prompt caching: system prompt + static user prefix are cached across 30 section calls
    // Cached tokens cost $1.88/M vs $15/M normal — saves ~$1.20 per run with Opus
    const userContent: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> =
      options?.cacheableUserPrefix
        ? [
            { type: 'text', text: options.cacheableUserPrefix, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: prompt },
          ]
        : [{ type: 'text', text: prompt }]

    const params = {
      model: resolved.modelId,
      max_tokens: tokenLimit,
      system: [{ type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } }],
      messages: [{ role: 'user' as const, content: userContent }],
    }

    // Use streaming for large requests — Anthropic SDK rejects non-streaming calls
    // that it estimates could exceed 10 minutes (based on input size + max_tokens)
    if (tokenLimit > 16384 || prompt.length > 30000) {
      let result = ''
      const stream = anthropic.messages.stream(params)
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          result += event.delta.text
        }
      }
      return result
    }

    const response = await anthropic.messages.create(params)
    return (response.content[0] as { type: 'text'; text: string }).text
  }

  if (resolved?.provider === 'openai') {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const fullPrompt = options?.cacheableUserPrefix
      ? `${options.cacheableUserPrefix}\n\n${prompt}`
      : prompt
    const response = await openai.chat.completions.create({
      model: resolved.modelId,
      max_tokens: tokenLimit,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: fullPrompt },
      ],
    })
    return response.choices[0]?.message?.content || ''
  }

  // Fallback: Gemini Flash
  const fallback = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
  })
  const fullPrompt = options?.cacheableUserPrefix
    ? `${options.cacheableUserPrefix}\n\n${prompt}`
    : prompt
  const result = await fallback.generateContent(fullPrompt)
  return result.response.text()
}

// ─────────────────────────────────────────────────────────────────────────────
// Main pipeline runner (async generator for streaming progress)
// ─────────────────────────────────────────────────────────────────────────────

export async function* runGhostwriterPipeline(
  items: PipelineItem[],
  model: AIModel,
  options: { concurrency?: number; vocabularyContext?: string } = {},
): AsyncGenerator<PipelineEvent | { type: 'section'; text: string } | { type: 'metadata'; text: string }> {
  const { concurrency = 2, vocabularyContext } = options
  // ── Pass 1: Plan ────────────────────────────────────────────────────────────
  yield { type: 'planning', message: `Struktur für ${items.length} Items planen...` }

  let plan: ArticlePlan
  try {
    const planningModel = await getModelForUseCase('article_planning') as AIModel
    console.log(`[Pipeline] Planning model: ${planningModel}`)
    plan = await planArticle(items, planningModel)
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
  let editLearningContext = ''
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
        editLearningContext = enhancement
        console.log(`[Pipeline] Edit learning: ${patterns.length} patterns, ${examples.length} examples`)
      }
    }
  } catch (err) {
    console.error('[Pipeline] Failed to load Edit Learning patterns:', err)
  }

  // ── Pre-extract relevant companies per item (avoids sending all 492 names per call) ──
  const companiesPerItem = new Map<string, { public: string[]; premarket: string[] }>()
  for (const item of items) {
    companiesPerItem.set(item.id, extractRelevantCompanies(`${item.title} ${item.content || ''}`))
  }

  // ── Build cacheable user prefix (shared across all section calls) ──
  // For Anthropic: cached after first call, 29 subsequent calls pay $1.88/M instead of $15/M
  const prefixParts: string[] = []
  if (vocabularyContext) prefixParts.push(vocabularyContext)
  if (editLearningContext) prefixParts.push(editLearningContext)
  prefixParts.push(`ARTIKEL-KONTEXT: ${plan.thesis}\n\nSchreibe GENAU DIESEN EINEN Abschnitt. Kein Intro, keine anderen News, kein Abschluss.`)
  const cacheableUserPrefix = prefixParts.join('\n\n')

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
        const itemCompanies = companiesPerItem.get(item.id) || { public: [], premarket: [] }
        results[i] = await writeSection(item, heading, model, {
          relevantCompanies: itemCompanies,
          cacheableUserPrefix,
        })
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

  // ── Post-Processing: German Proofreading ────────────────────────────────────
  const fullText = results.filter(Boolean).join('\n\n')
  yield { type: 'proofreading', message: 'Rechtschreib- und Grammatikprüfung...' }

  try {
    const proofreadingModel = await getModelForUseCase('proofreading') as AIModel
    console.log(`[Pipeline] Proofreading model: ${proofreadingModel}`)
    const corrected = await proofreadText(fullText, proofreadingModel)
    yield { type: 'proofread', text: corrected }
  } catch (err) {
    console.error('[Pipeline] Proofreading failed:', err)
    // Bei Fehler: Originaltext beibehalten (proofread event wird nicht gesendet)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// German proofreading
// ─────────────────────────────────────────────────────────────────────────────

const PROOFREADING_PROMPT = `Du bist ein professioneller deutscher Lektor. Korrigiere den folgenden Text.

REGELN:
1. Korrigiere alle deutschen Rechtschreib- und Grammatikfehler.
2. Korrigiere falsche Kommasetzung und Zeichensetzung.
3. Englische Fachbegriffe (Token, Reasoning, API, Fine-Tuning, Open Source, Benchmark, Model, Inference, Training, Edge Computing, etc.) NICHT übersetzen oder eindeutschen, wenn es kein adäquates deutsches Wort gibt.
4. Firmennamen, Produktnamen und Eigennamen NICHT verändern.
5. Markdown-Formatierung (##, **, {Company}, →, Synthszr Take:) NICHT verändern.
6. Stil, Ton und Inhalt NICHT verändern. Nur Fehler korrigieren.
7. Gib NUR den korrigierten Text zurück, keine Erklärungen oder Kommentare.`

async function proofreadText(text: string, model: AIModel): Promise<string> {
  const corrected = await callModelNonStreaming(
    text,
    PROOFREADING_PROMPT,
    model,
    { maxTokens: 100000 },
  )
  return corrected.trim()
}
