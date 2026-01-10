import { GoogleGenerativeAI } from '@google/generative-ai'
import Anthropic from '@anthropic-ai/sdk'

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

export type AIModel = 'claude-opus-4' | 'claude-sonnet-4' | 'gemini-2.5-pro' | 'gemini-3-pro-preview'

export const AI_MODEL_LABELS: Record<AIModel, string> = {
  'claude-opus-4': 'Claude Opus 4',
  'claude-sonnet-4': 'Claude Sonnet 4',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-3-pro-preview': 'Gemini 3 Pro Preview',
}

// Minimaler System-Prompt - nur für Parsing-Anforderungen
// Alle inhaltlichen Anweisungen kommen aus dem Datenbank-Prompt
const SYSTEM_PROMPT = `Du bist ein Ghostwriter. Befolge die Anweisungen im User-Prompt exakt.

WICHTIG - STRUKTURIERTER OUTPUT (für automatisches Parsing):
Der Artikel MUSS mit diesen Metadaten beginnen (in genau diesem Format):

---
TITLE: [Titel]
EXCERPT: [1-2 Sätze, max 160 Zeichen]
CATEGORY: [AI & Tech, Marketing, Design, Business, Code, oder Synthese]
---

Danach folgt der Artikel-Content in Markdown.`

/**
 * Stream ghostwriter blog post generation using the specified AI model
 */
export async function* streamGhostwriter(
  digestContent: string,
  prompt: string,
  model: AIModel = 'gemini-2.5-pro'
): AsyncGenerator<string, void, unknown> {
  const userMessage = `${prompt}\n\n---\n\nHier ist der Digest, aus dem du einen Blogartikel erstellen sollst:\n\n${digestContent}`

  console.log(`[Ghostwriter] Using model: ${model}`)

  if (model === 'gemini-2.5-pro' || model === 'gemini-3-pro-preview') {
    yield* streamGemini(userMessage, model)
  } else {
    yield* streamClaude(userMessage, model)
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
    max_tokens: 8192,
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
  if (duplicates.size === 0) {
    yield originalText
    return
  }

  // Build the deduplication prompt
  const duplicateList = Array.from(duplicates.entries())
    .map(([metaphor, positions]) => `- "${metaphor}" erscheint ${positions.length}x`)
    .join('\n')

  const deduplicationPrompt = `Du bist ein Experte für Tech-Journalismus im Stil von Benedict Evans.

Der folgende Text enthält WIEDERHOLTE Metaphern/Fachbegriffe, die jeweils nur EINMAL vorkommen sollten:

${duplicateList}

AUFGABE:
1. Behalte das ERSTE Vorkommen jeder Metapher
2. Ersetze alle WEITEREN Vorkommen durch alternative Formulierungen im Benedict Evans Stil:
   - Nutze präzise, analytische Sprache
   - Verwende Tech-Business-Metaphern aus anderen Bereichen (Biologie, Physik, Geschichte)
   - Halte den gleichen Bedeutungsinhalt
   - Achte auf natürlichen Lesefluss

STIL-BEISPIELE für Benedict Evans:
- Statt "Burgraben" → "struktureller Vorteil", "Wettbewerbsbarriere", "Lock-in-Effekt"
- Statt "Disruption" → "Marktverschiebung", "Technologiebruch", "Paradigmenwechsel"
- Statt "Flywheel" → "selbstverstärkender Kreislauf", "positive Feedback-Schleife"
- Statt "Network Effects" → "Skalenvorteile", "Plattformdynamik", "Gravitationseffekt"
- Statt "Cargo Kult" → "Oberflächenimitation", "Form ohne Substanz", "rituelles Nachahmen"

Gib den KOMPLETTEN überarbeiteten Text aus, mit allen Ersetzungen. Behalte das exakte Format (Markdown, Struktur) bei.

ORIGINALTEXT:
${originalText}`

  console.log(`[Ghostwriter] Deduplicating ${duplicates.size} repeated metaphors...`)

  if (model === 'gemini-2.5-pro' || model === 'gemini-3-pro-preview') {
    const geminiModel = genAI.getGenerativeModel({
      model: model,
      systemInstruction: 'Du überarbeitest Texte und ersetzt wiederholte Metaphern durch Alternativen.',
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
      max_tokens: 8192,
      system: 'Du überarbeitest Texte und ersetzt wiederholte Metaphern durch Alternativen.',
      messages: [{ role: 'user', content: deduplicationPrompt }],
    })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text
      }
    }
  }
}
