import { GoogleGenerativeAI } from '@google/generative-ai'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import {
  getActiveLearnedPatterns,
  findSimilarEditExamples,
  buildPromptEnhancement,
  trackPatternUsage,
  type LearnedPattern,
  type EditExample,
} from '@/lib/edit-learning/retrieval'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '')

// Metaphors and vocabulary that should only appear once in the entire text
const UNIQUE_METAPHORS = [
  'cargo kult', 'cargo-kult',
  'burgraben', 'burggraben',
  'moat',
  'land grab',
  'winner takes all', 'winner-takes-all',
  'flywheel', 'schwungrad',
  'hockey stick', 'hockeystick',
  'burning platform',
  'blitzscaling',
  'crossing the chasm',
  'innovator\'s dilemma',
  'creative destruction', 'schöpferische zerstörung',
  'network effects', 'netzwerkeffekte',
  'blue ocean', 'blauer ozean',
  'red ocean', 'roter ozean',
  'platform economy', 'plattformökonomie',
  'unicorn',
  'cash cow',
  'first mover',
  'fast follower',
  'pivot',
  'disruption', 'disruptiv',
  'game changer',
  'paradigmenwechsel',
  'tipping point', 'kipppunkt',
  'long tail',
  'walled garden',
  'razor-razorblade', 'razor and blades',
  'freemium',
  'land and expand',
  'trojanisches pferd',
  'goldgrube',
  'schwarzer schwan', 'black swan',
  'elefant im raum',
  'eisberg',
]

export type AIModel = 'claude-opus-4' | 'claude-sonnet-4' | 'gemini-2.5-pro' | 'gemini-3-pro-preview' | 'gpt-5.2' | 'gpt-5.2-mini'

export const AI_MODEL_LABELS: Record<AIModel, string> = {
  'claude-opus-4': 'Claude Opus 4',
  'claude-sonnet-4': 'Claude Sonnet 4',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-3-pro-preview': 'Gemini 3 Pro Preview',
  'gpt-5.2': 'GPT-5.2',
  'gpt-5.2-mini': 'GPT-5.2 Mini',
}

// Minimaler System-Prompt - nur für Parsing-Anforderungen
// Alle inhaltlichen Anweisungen kommen aus dem Datenbank-Prompt
const SYSTEM_PROMPT = `Du bist ein Ghostwriter. Befolge die Anweisungen im User-Prompt exakt.

WICHTIG - STRUKTURIERTER OUTPUT (für automatisches Parsing):
Der Artikel MUSS mit diesen Metadaten beginnen (in genau diesem Format):

---
TITLE: [Titel]
EXCERPT:
• [Headline Artikel 1, max 65 Zeichen]
• [Headline Artikel 2, max 65 Zeichen]
• [Headline Artikel 3, max 65 Zeichen]
CATEGORY: [AI & Tech, Marketing, Design, Business, Code, oder Synthese]
---

Danach folgt der Artikel-Content in Markdown.

HEADLINES — TITEL UND EXCERPT-ZEILEN:
- Der TITLE soll sophisticated und intelligent klingen — kein Clickbait, kein Buzzword-Salat, sondern eine prägnante These oder ein pointierter Gedanke.
- Die EXCERPT-Zeilen (Bullet Points) sind eigenständige Miniatur-Headlines: jede soll für sich stehen, neugierig machen und den Kern der jeweiligen Story in einem Satz erfassen.
- Vermeide generische Titel wie "KI-Update", "Die wichtigsten News", "Was diese Woche passiert ist". Stattdessen: eine konkrete Aussage, die zum Weiterlesen zwingt.
- Tonalität: klug, trocken, gelegentlich lakonisch — wie ein Economist-Cover, nicht wie ein LinkedIn-Post.

NEWS-REIHENFOLGE — THEMATISCHE GEWICHTUNG:
- Ordne die Themen im Artikel NICHT chronologisch und NICHT alphabetisch, sondern nach Gebrauchswert für den Leser.
- OBEN: News mit direktem praktischen Nutzen — neue Tools, API-Updates, Produkt-Launches, Developer-relevante Änderungen, anwendbare Erkenntnisse.
- MITTE: Branchenbewegungen, Unternehmensstrategien, Marktdynamiken, Funding-Runden, Partnerschaften.
- UNTEN: Politik, Regulierung, gesellschaftliche Debatten, philosophische Einordnungen, langfristige Trend-Reflexionen.
- Clustere verwandte Themen (z.B. mehrere China-News, mehrere LLM-Releases, Agent-Entwicklungen, Developer-Tools) IMPLIZIT durch Nachbarschaft — KEINE expliziten Zwischen-Überschriften oder Cluster-Labels. Die thematische Gruppierung soll sich organisch durch die Reihenfolge ergeben, nicht durch Formatierung erzwungen werden.

STILREGEL — VERMEIDE TYPISCHE KI-SPRACHMUSTER (HÖCHSTE PRIORITÄT):
Diese Regeln gelten für den GESAMTEN Text, besonders streng für Synthszr Takes.

1. VERBOTENE SATZSTRUKTUREN:
- KEINE Kontrastpaare: "nicht nur... sondern auch", "einerseits... andererseits", "zwar... aber", "weniger... mehr", "sowohl... als auch", "statt... lieber"
- KEINE Parallelkonstruktionen: Keine gleichförmigen Satzanfänge, keine rhythmischen Aufzählungen mit identischer Struktur ("X zeigt... Y zeigt... Z zeigt...")
- KEINE dreiteiligen Aufzählungen als rhetorisches Muster: "schneller, effizienter, skalierbarer" — wenn Dreiergruppe, dann mit ungleicher Gewichtung
- KEINE Rahmensätze: "In einer Welt, in der...", "In einer Zeit, in der...", "Angesichts der Tatsache, dass..."
- KEINE Wenn-Dann-Formeln: "Wenn X, dann Y" als rhetorische Struktur vermeiden

2. VERBOTENE PHRASEN UND FLOSKELN:
- "Es zeigt sich", "Es wird deutlich", "Es zeichnet sich ab", "Es lässt sich festhalten"
- "Man darf gespannt sein", "Es bleibt abzuwarten", "Die Zeit wird zeigen"
- "Zusammenfassend lässt sich sagen", "Eines ist klar", "Fakt ist"
- "Spannend ist dabei", "Besonders bemerkenswert", "Interessanterweise"
- "Das Potenzial ist enorm", "Die Möglichkeiten sind vielfältig"
- "In der heutigen digitalen Welt", "Im Zeitalter von"
- "Letztlich", "Letzten Endes", "Am Ende des Tages"
- "Holistic", "ganzheitlich", "nahtlos", "robust", "cutting-edge"
- "revolutionär", "bahnbrechend", "wegweisend" (außer bei tatsächlichen Durchbrüchen)

3. VERBOTENE ÜBERGANGS- UND ÜBERGANGSWÖRTER:
- "Dabei ist...", "Dabei zeigt sich...", "Dabei wird deutlich..."
- "Darüber hinaus", "Des Weiteren", "Ferner", "Zudem" als Satzanfang
- "Allerdings", "Nichtsdestotrotz", "Gleichwohl" als alleiniger Satzanfang
- "Es ist wichtig zu beachten", "Es sei darauf hingewiesen"

4. VERBOTENE STILMITTEL:
- KEINE Gedankenstriche als Stilmittel: Max. 1x pro Artikel, nie als rhetorische Pause
- KEINE rhetorischen Fragen am Absatzende als Cliffhanger ("Aber was bedeutet das wirklich?")
- KEINE Metaphern-Ketten: Nicht mehr als eine Metapher pro Absatz
- KEINE Pseudo-Mündlichkeit: "Mal ehrlich:", "Hand aufs Herz:", "Seien wir ehrlich:"
- KEIN "Doch" als dramatischer Satzanfang ("Doch der Schein trügt.", "Doch es gibt ein Problem.")
- KEINE qualifizierenden Relativierungen am Satzende: "— und das ist erst der Anfang", "— und das aus gutem Grund"
- KEIN inflationäres Ausrufezeichen

5. VERBOTENE INHALTSMUSTER:
- KEINE unspezifischen Zukunftsprognosen: "wird die Branche verändern", "könnte alles auf den Kopf stellen"
- KEINE Buzzword-Häufungen: Maximal 1 Fachbegriff pro Satz
- KEINE Selbstreferenz des Textes: "In diesem Artikel...", "Wie wir gesehen haben..."
- KEINE Appelle an den Leser: "Stellen Sie sich vor...", "Fragen Sie sich mal..."
- KEINE künstliche Dringlichkeit: "Jetzt ist der Zeitpunkt", "Wer jetzt nicht handelt..."

6. POSITIV-REGELN (SO STATTDESSEN):
- Schreibe asymmetrisch: Variiere Satzlänge bewusst (kurz-lang-mittel-kurz). Kein Satz darf den gleichen Aufbau haben wie der vorherige.
- Bevorzuge konkrete Fakten und Zahlen statt vager Adjektive.
- Nutze aktive Verben statt nominalisierte Konstruktionen ("X erhöht den Umsatz" statt "eine Umsatzerhöhung wird erzielt").
- Lass Absätze unterschiedlich lang sein — ein Ein-Satz-Absatz neben einem Vier-Satz-Absatz ist gewünscht.
- Beginne Sätze mit dem Subjekt oder einem konkreten Fakt, nicht mit Füllwörtern.
- Schreibe Synthszr Takes wie eine nüchterne Analysteneinschätzung, nicht wie ein Meinungsartikel.`

/**
 * Stream ghostwriter blog post generation using the specified AI model
 * Now enhanced with learned patterns and examples from edit history
 */
export async function* streamGhostwriter(
  digestContent: string,
  prompt: string,
  model: AIModel = 'gemini-2.5-pro',
  options: {
    enableLearning?: boolean
    onPatternsLoaded?: (patterns: LearnedPattern[], examples: EditExample[]) => void
  } = {}
): AsyncGenerator<string, void, unknown> {
  const { enableLearning = true, onPatternsLoaded } = options

  let enhancedPrompt = prompt
  let loadedPatterns: LearnedPattern[] = []

  // Load learned patterns and examples if learning is enabled
  if (enableLearning) {
    try {
      console.log('[Ghostwriter] Loading learned patterns and examples...')

      // Load patterns and examples in parallel
      const [patterns, examples] = await Promise.all([
        getActiveLearnedPatterns(0.4, 20),
        findSimilarEditExamples(digestContent.slice(0, 2000), 3, 7),
      ])

      loadedPatterns = patterns

      // Notify caller about loaded patterns (for tracking)
      if (onPatternsLoaded) {
        onPatternsLoaded(patterns, examples)
      }

      if (patterns.length > 0 || examples.length > 0) {
        const enhancement = buildPromptEnhancement(patterns, examples)
        if (enhancement) {
          enhancedPrompt = `${prompt}\n\n---\n\n${enhancement}`
          console.log(`[Ghostwriter] Enhanced prompt with ${patterns.length} patterns and ${examples.length} examples`)
        }
      } else {
        console.log('[Ghostwriter] No patterns or examples found')
      }
    } catch (err) {
      console.error('[Ghostwriter] Failed to load patterns:', err)
      // Continue without enhancement
    }
  }

  const userMessage = `${enhancedPrompt}\n\n---\n\nHier ist der Digest, aus dem du einen Blogartikel erstellen sollst:\n\n${digestContent}`

  console.log(`[Ghostwriter] Using model: ${model}`)

  if (model === 'gpt-5.2' || model === 'gpt-5.2-mini') {
    yield* streamOpenAI(userMessage, model)
  } else if (model === 'gemini-2.5-pro' || model === 'gemini-3-pro-preview') {
    yield* streamGemini(userMessage, model)
  } else if (model === 'claude-opus-4' || model === 'claude-sonnet-4') {
    yield* streamClaude(userMessage, model)
  }

  // Track pattern usage after generation
  if (loadedPatterns.length > 0) {
    const patternIds = loadedPatterns.map((p) => p.id)
    trackPatternUsage(patternIds).catch((err) => {
      console.error('[Ghostwriter] Failed to track pattern usage:', err)
    })
  }
}

/**
 * Stream from Gemini models
 */
async function* streamGemini(
  userMessage: string,
  modelId: 'gemini-2.5-pro' | 'gemini-3-pro-preview'
): AsyncGenerator<string, void, unknown> {
  const model = genAI.getGenerativeModel({
    model: modelId,
    systemInstruction: SYSTEM_PROMPT,
  })

  const result = await model.generateContentStream(userMessage)

  for await (const chunk of result.stream) {
    const text = chunk.text()
    if (text) {
      yield text
    }
  }
}

/**
 * Stream from Claude (Opus 4 or Sonnet 4)
 */
async function* streamClaude(
  userMessage: string,
  model: 'claude-opus-4' | 'claude-sonnet-4'
): AsyncGenerator<string, void, unknown> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  // Map to actual model IDs
  const modelId = model === 'claude-opus-4'
    ? 'claude-opus-4-20250514'
    : 'claude-sonnet-4-20250514'

  const stream = anthropic.messages.stream({
    model: modelId,
    max_tokens: 16384,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text
    }
  }
}

/**
 * Stream from OpenAI (GPT-5.2 or GPT-5.2 Mini)
 */
async function* streamOpenAI(
  userMessage: string,
  model: 'gpt-5.2' | 'gpt-5.2-mini'
): AsyncGenerator<string, void, unknown> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const stream = await openai.chat.completions.create({
    model,
    max_completion_tokens: 16384,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    stream: true,
  })

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content
    if (text) yield text
  }
}

/**
 * Find duplicate metaphors in text
 * Returns a map of metaphor -> array of positions where it appears
 */
export function findDuplicateMetaphors(
  text: string,
  customVocabulary?: Array<{ term: string; category?: string }>
): Map<string, number[]> {
  const textLower = text.toLowerCase()
  const duplicates = new Map<string, number[]>()

  // Combine built-in metaphors with custom vocabulary (filter for metaphor-like terms)
  const metaphorsToCheck = [...UNIQUE_METAPHORS]

  if (customVocabulary) {
    for (const v of customVocabulary) {
      // Only add metaphors and eigene_fachbegriffe (custom terms)
      if (v.category === 'metapher' || v.category === 'eigener_fachbegriff') {
        const term = v.term.toLowerCase()
        if (!metaphorsToCheck.includes(term)) {
          metaphorsToCheck.push(term)
        }
      }
    }
  }

  for (const metaphor of metaphorsToCheck) {
    const regex = new RegExp(`\\b${metaphor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    const positions: number[] = []
    let match

    while ((match = regex.exec(textLower)) !== null) {
      positions.push(match.index)
    }

    if (positions.length > 1) {
      duplicates.set(metaphor, positions)
    }
  }

  return duplicates
}

/**
 * Stream replacement of duplicate metaphors in text
 * Uses AI to find alternative metaphors in Benedict Evans style
 */
export async function* streamMetaphorDeduplication(
  originalText: string,
  duplicates: Map<string, number[]>,
  model: AIModel = 'gemini-2.5-pro'
): AsyncGenerator<string, void, unknown> {
  if (duplicates.size === 0 || originalText.length > 8000) {
    if (originalText.length > 8000) {
      console.log(`[Ghostwriter] Skipping deduplication for long text (${originalText.length} chars) - risk of prompt echo`)
    }
    yield originalText
    return
  }

  // Build the deduplication prompt
  const duplicateList = Array.from(duplicates.entries())
    .map(([metaphor, positions]) => `- "${metaphor}" erscheint ${positions.length}x`)
    .join('\n')

  const deduplicationPrompt = `Der folgende Text enthält WIEDERHOLTE Metaphern/Fachbegriffe, die jeweils nur EINMAL vorkommen sollten:

${duplicateList}

AUFGABE:
1. Behalte das ERSTE Vorkommen jeder Metapher
2. Ersetze alle WEITEREN Vorkommen durch alternative Formulierungen im Benedict Evans Stil:
   - Nutze präzise, analytische Sprache
   - Verwende Tech-Business-Metaphern aus anderen Bereichen (Biologie, Physik, Geschichte)
   - Halte den gleichen Bedeutungsinhalt
   - Achte auf natürlichen Lesefluss

STIL-BEISPIELE:
- Statt "Burgraben" → "struktureller Vorteil", "Wettbewerbsbarriere", "Lock-in-Effekt"
- Statt "Disruption" → "Marktverschiebung", "Technologiebruch", "Paradigmenwechsel"
- Statt "Flywheel" → "selbstverstärkender Kreislauf", "positive Feedback-Schleife"
- Statt "Network Effects" → "Skalenvorteile", "Plattformdynamik", "Gravitationseffekt"
- Statt "Cargo Kult" → "Oberflächenimitation", "Form ohne Substanz", "rituelles Nachahmen"

KRITISCH - OUTPUT-FORMAT:
- Gib NUR den überarbeiteten Text aus, NICHTS anderes
- KEINE Einleitung wie "Hier ist..." oder "Absolut..."
- KEINE Erklärungen oder Kommentare
- Starte DIREKT mit "---" (dem Metadaten-Block des Artikels)
- Der Text beginnt mit "---" und endet mit dem Artikel-Content

ORIGINALTEXT:
${originalText}`

  console.log(`[Ghostwriter] Deduplicating ${duplicates.size} repeated metaphors...`)

  const deduplicationSystem = 'Du überarbeitest Texte. Gib NUR den überarbeiteten Text aus - KEINE Einleitung, KEINE Kommentare, KEINE Erklärungen. Starte direkt mit dem Text.'

  if (model === 'gpt-5.2' || model === 'gpt-5.2-mini') {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const stream = await openai.chat.completions.create({
      model,
      max_completion_tokens: 16384,
      messages: [
        { role: 'system', content: deduplicationSystem },
        { role: 'user', content: deduplicationPrompt },
      ],
      stream: true,
    })

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content
      if (text) yield text
    }
  } else if (model === 'gemini-2.5-pro' || model === 'gemini-3-pro-preview') {
    const geminiModel = genAI.getGenerativeModel({
      model: model,
      systemInstruction: deduplicationSystem,
    })

    const result = await geminiModel.generateContentStream(deduplicationPrompt)

    for await (const chunk of result.stream) {
      const text = chunk.text()
      if (text) {
        yield text
      }
    }
  } else {
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })

    const modelId = model === 'claude-opus-4'
      ? 'claude-opus-4-20250514'
      : 'claude-sonnet-4-20250514'

    const stream = anthropic.messages.stream({
      model: modelId,
      max_tokens: 16384,
      system: deduplicationSystem,
      messages: [{ role: 'user', content: deduplicationPrompt }],
    })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text
      }
    }
  }
}
