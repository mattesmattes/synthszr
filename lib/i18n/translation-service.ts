import { GoogleGenerativeAI } from '@google/generative-ai'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { LanguageCode } from '@/lib/types'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '')

/** Available translation models */
export type TranslationModel =
  | 'claude-sonnet-4'
  | 'claude-haiku-3.5'
  | 'gemini-2.0-flash'
  | 'gemini-2.5-pro'

export const TRANSLATION_MODEL_LABELS: Record<TranslationModel, string> = {
  'claude-sonnet-4': 'Claude Sonnet 4',
  'claude-haiku-3.5': 'Claude Haiku 3.5',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
}

/** Check which models have API keys configured (does not validate) */
export function getAvailableModels(): TranslationModel[] {
  const available: TranslationModel[] = []

  if (process.env.ANTHROPIC_API_KEY) {
    available.push('claude-sonnet-4', 'claude-haiku-3.5')
  }

  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    available.push('gemini-2.0-flash', 'gemini-2.5-pro')
  }

  return available
}

/** Test if API keys are actually working by making minimal test calls */
export async function testApiKeys(): Promise<{
  anthropic: { valid: boolean; error?: string; lastChars?: string }
  google: { valid: boolean; error?: string; lastChars?: string }
  openai: { valid: boolean; error?: string; lastChars?: string }
}> {
  const results = {
    anthropic: { valid: false, error: undefined as string | undefined, lastChars: undefined as string | undefined },
    google: { valid: false, error: undefined as string | undefined, lastChars: undefined as string | undefined },
    openai: { valid: false, error: undefined as string | undefined, lastChars: undefined as string | undefined },
  }

  // Test Anthropic
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (anthropicKey) {
    results.anthropic.lastChars = anthropicKey.slice(-4)
    try {
      const anthropic = new Anthropic()
      await anthropic.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say "ok"' }],
      })
      results.anthropic.valid = true
    } catch (error) {
      results.anthropic.error = error instanceof Error ? error.message : String(error)
    }
  } else {
    results.anthropic.error = 'API key not configured'
  }

  // Test Google
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (googleKey) {
    results.google.lastChars = googleKey.slice(-4)
    try {
      const gemini = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
      await gemini.generateContent('Say "ok"')
      results.google.valid = true
    } catch (error) {
      results.google.error = error instanceof Error ? error.message : String(error)
    }
  } else {
    results.google.error = 'API key not configured'
  }

  // Test OpenAI
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    results.openai.lastChars = openaiKey.slice(-4)
    try {
      const openai = new OpenAI()
      await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say "ok"' }],
      })
      results.openai.valid = true
    } catch (error) {
      results.openai.error = error instanceof Error ? error.message : String(error)
    }
  } else {
    results.openai.error = 'API key not configured'
  }

  return results
}

const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  de: 'German',
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  cs: 'Czech',
  nds: 'Low German (Plattdeutsch)',
}

interface TranslationInput {
  title: string
  excerpt?: string | null
  content: Record<string, unknown>  // TipTap JSON
}

interface TranslationResult {
  success: boolean
  title?: string
  slug?: string
  excerpt?: string
  content?: Record<string, unknown>
  error?: string
}

/**
 * Translates article content to the target language
 */
export async function translateContent(
  source: TranslationInput,
  targetLanguage: LanguageCode,
  model: TranslationModel = 'gemini-2.0-flash'
): Promise<TranslationResult> {
  const targetLangName = LANGUAGE_NAMES[targetLanguage]

  const systemPrompt = `You are a professional translator specializing in web content.
Your task is to translate the following content to ${targetLangName}.

CRITICAL RULES:
1. Maintain the EXACT same TipTap JSON structure - only translate text content
2. Keep company names, product names, and technical terms unchanged
3. Preserve all formatting, links, and special markers like {Company} tags
4. Translate naturally while keeping the original tone and style
5. For the slug: create a URL-friendly version of the translated title (lowercase, hyphens, no special chars)

Return ONLY a valid JSON object with this exact structure:
{
  "title": "translated title",
  "slug": "translated-url-slug",
  "excerpt": "translated excerpt",
  "content": { ... translated TipTap JSON ... }
}

Do NOT include any markdown formatting or code blocks. Return ONLY the raw JSON.`

  const userPrompt = `Translate this content to ${targetLangName}:

TITLE: ${source.title}

EXCERPT: ${source.excerpt || ''}

CONTENT (TipTap JSON):
${JSON.stringify(source.content, null, 2)}`

  try {
    let responseText: string

    if (model.startsWith('claude')) {
      responseText = await translateWithClaude(systemPrompt, userPrompt, model)
    } else {
      responseText = await translateWithGemini(systemPrompt, userPrompt, model)
    }

    // Parse JSON response
    const parsed = parseJsonResponse(responseText)

    const title = parsed.title as string | undefined
    const slug = parsed.slug as string | undefined
    const excerpt = parsed.excerpt as string | undefined
    const content = parsed.content as Record<string, unknown> | undefined

    if (!title || !content) {
      return {
        success: false,
        error: 'Invalid response structure: missing title or content',
      }
    }

    return {
      success: true,
      title,
      slug: slug || generateSlug(title),
      excerpt,
      content,
    }
  } catch (error) {
    console.error('[Translation] Error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Translate using Claude
 */
async function translateWithClaude(
  systemPrompt: string,
  userPrompt: string,
  model: TranslationModel
): Promise<string> {
  const anthropic = new Anthropic()

  const modelId = model === 'claude-haiku-3.5'
    ? 'claude-3-5-haiku-20241022'
    : 'claude-sonnet-4-20250514'

  const response = await anthropic.messages.create({
    model: modelId,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const textBlock = response.content.find(block => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude')
  }

  return textBlock.text
}

/**
 * Translate using Gemini
 */
async function translateWithGemini(
  systemPrompt: string,
  userPrompt: string,
  model: TranslationModel
): Promise<string> {
  const modelId = model === 'gemini-2.5-pro' ? 'gemini-2.5-pro' : 'gemini-2.0-flash'

  const gemini = genAI.getGenerativeModel({
    model: modelId,
    systemInstruction: systemPrompt,
  })

  const result = await gemini.generateContent(userPrompt)
  const response = result.response

  return response.text()
}

/**
 * Parse JSON from LLM response (handles potential markdown wrapping)
 */
function parseJsonResponse(text: string): Record<string, unknown> {
  // Remove markdown code blocks if present
  let cleaned = text.trim()

  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7)
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3)
  }

  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3)
  }

  cleaned = cleaned.trim()

  try {
    return JSON.parse(cleaned)
  } catch (error) {
    console.error('[Translation] JSON parse error:', error)
    console.error('[Translation] Raw response:', text.slice(0, 500))
    throw new Error('Failed to parse translation response as JSON')
  }
}

/**
 * Generate URL-friendly slug from title
 */
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[ñ]/g, 'n')
    .replace(/[ç]/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

/**
 * Translate UI strings (for batch UI translations)
 */
export async function translateUIStrings(
  strings: Record<string, string>,
  targetLanguage: LanguageCode,
  model: TranslationModel = 'gemini-2.0-flash'
): Promise<{ success: boolean; translations?: Record<string, string>; error?: string }> {
  const targetLangName = LANGUAGE_NAMES[targetLanguage]

  const systemPrompt = `You are a professional translator for UI strings.
Translate the following key-value pairs to ${targetLangName}.
Keep the keys exactly as they are, only translate the values.
Return ONLY a valid JSON object with the same keys.`

  const userPrompt = `Translate these UI strings to ${targetLangName}:
${JSON.stringify(strings, null, 2)}`

  try {
    let responseText: string

    if (model.startsWith('claude')) {
      responseText = await translateWithClaude(systemPrompt, userPrompt, model)
    } else {
      responseText = await translateWithGemini(systemPrompt, userPrompt, model)
    }

    const parsed = parseJsonResponse(responseText) as Record<string, string>

    return { success: true, translations: parsed }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
