import { GoogleGenerativeAI } from '@google/generative-ai'
import Anthropic from '@anthropic-ai/sdk'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '')

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
