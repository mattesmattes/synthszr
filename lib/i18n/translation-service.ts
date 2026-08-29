import { GoogleGenerativeAI } from '@google/generative-ai'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { LanguageCode } from '@/lib/types'
import { normalizeQuotesInTipTap, fixQuotes } from '@/lib/utils/typography'

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '')

/** Available translation models */
export type TranslationModel =
  | 'claude-sonnet-4'
  | 'claude-haiku-3.5'
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro'

export const TRANSLATION_MODEL_LABELS: Record<TranslationModel, string> = {
  'claude-sonnet-4': 'Claude Sonnet 4',
  'claude-haiku-3.5': 'Claude Haiku 3.5',
  'gemini-2.5-flash': 'Gemini 2.0 Flash',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
}

/** Check which models have API keys configured (does not validate) */
export function getAvailableModels(): TranslationModel[] {
  const available: TranslationModel[] = []

  if (process.env.ANTHROPIC_API_KEY) {
    available.push('claude-sonnet-4', 'claude-haiku-3.5')
  }

  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    available.push('gemini-2.5-flash', 'gemini-2.5-pro')
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
        model: 'claude-haiku-4-5-20251001',
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
      const gemini = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
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
  model: TranslationModel = 'gemini-2.5-flash'
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

  // Use compact JSON to significantly reduce token count
  const contentJson = JSON.stringify(source.content)

  // Check if content is large enough to need chunked translation
  const CHUNK_THRESHOLD = 30000 // chars of JSON — above this, chunk the content
  const needsChunking = contentJson.length > CHUNK_THRESHOLD
    && source.content.content
    && Array.isArray(source.content.content)

  if (needsChunking) {
    return await translateContentChunked(source, targetLanguage, model, systemPrompt)
  }

  const userPrompt = `Translate this content to ${targetLangName}:

TITLE: ${source.title}

EXCERPT: ${source.excerpt || ''}

CONTENT (TipTap JSON):
${contentJson}`

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

    // Normalize quotes to the correct typographic style for the target language
    const normalizedTitle = fixQuotes(title, targetLanguage)
    const normalizedExcerpt = excerpt ? fixQuotes(excerpt, targetLanguage) : undefined
    // The system prompt only asks the LLM to preserve the exact JSON
    // structure/attrs — that's a request, not a guarantee. Restore custom
    // attrs like bundleType deterministically in case the LLM dropped them.
    reapplyBundleTypeAttrs(source.content, content)
    const normalizedContent = normalizeQuotesInTipTap(content, targetLanguage)

    return {
      success: true,
      title: normalizedTitle,
      slug: slug || generateSlug(title), // Use original title for slug generation
      excerpt: normalizedExcerpt,
      content: normalizedContent,
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
 * Chunked translation for large TipTap content.
 * Splits the top-level content array into chunks and translates each separately.
 */
async function translateContentChunked(
  source: TranslationInput,
  targetLanguage: LanguageCode,
  model: TranslationModel,
  systemPrompt: string,
): Promise<TranslationResult> {
  const targetLangName = LANGUAGE_NAMES[targetLanguage]
  const blocks = (source.content as { type: string; content: unknown[] }).content
  const CHUNK_SIZE = 15 // blocks per chunk
  const CHUNK_ATTEMPTS = 3 // je Chunk, gegen schwankende Antwortformate
  const CHUNK_CONCURRENCY = 3 // gleichzeitige Chunk-Uebersetzungen, s. Begruendung unten

  console.log(`[Translation] Chunked mode: ${blocks.length} blocks in ${Math.ceil(blocks.length / CHUNK_SIZE)} chunks`)

  // First: translate title + excerpt
  const metaPrompt = `Translate to ${targetLangName}:

TITLE: ${source.title}

EXCERPT: ${source.excerpt || ''}

Return ONLY a valid JSON object:
{"title": "translated title", "slug": "translated-url-slug", "excerpt": "translated excerpt"}`

  let metaText: string
  if (model.startsWith('claude')) {
    metaText = await translateWithClaude(systemPrompt, metaPrompt, model)
  } else {
    metaText = await translateWithGemini(systemPrompt, metaPrompt, model)
  }
  const meta = parseJsonResponse(metaText)

  // Then: translate content in chunks — MEHRERE GLEICHZEITIG.
  //
  // Die Chunks sind voneinander unabhaengig: Jeder traegt ausser dem
  // Artikeltitel und einem "Chunk 2 von 3" keinen Kontext, keiner baut auf dem
  // Ergebnis eines anderen auf. Sequenziell kostete das bei gemini-2.5-pro rund
  // 56s je Aufruf, also 226s im Median fuer drei Chunks plus Meta (gemessen am
  // 29.08.2026 ueber 400 Laeufe, Ausreisser bis 408s) — nah am 300s-Fenster der
  // Admin-Route.
  //
  // OBERGRENZE statt blindem Promise.all: gemini-2.5-pro hat engere Rate
  // Limits, und callGeminiWithRetry federt Ueberlast mit exponentiellem Backoff
  // ab (und weicht auf Flash aus). Zu viele gleichzeitige Anfragen loesen genau
  // diese Bremse aus — dann waere parallel langsamer als sequenziell.
  const totalChunks = Math.ceil(blocks.length / CHUNK_SIZE)

  async function uebersetzeChunk(chunkIndex: number): Promise<unknown[]> {
    const chunk = blocks.slice(chunkIndex * CHUNK_SIZE, (chunkIndex + 1) * CHUNK_SIZE)
    const chunkNum = chunkIndex + 1

    console.log(`[Translation] Translating chunk ${chunkNum}/${totalChunks} (${chunk.length} blocks)`)

    const chunkPrompt = `Translate this TipTap JSON content array to ${targetLangName}.
This is chunk ${chunkNum} of ${totalChunks} from a larger article titled "${source.title}".

Return ONLY the translated JSON array (not wrapped in an object).

CONTENT:
${JSON.stringify(chunk)}`

    // Bis zu CHUNK_ATTEMPTS Versuche je Chunk. Das Antwortformat der Modelle
    // schwankt (derselbe Artikel lief am 2026-08-21 in FR/CS/NDS sauber durch und
    // scheiterte nur in EN) — ein zweiter Anlauf heilt das in aller Regel. Frueher
    // wurde beim ersten Fehlschlag STILL der deutsche Originalblock eingesetzt und
    // die Uebersetzung trotzdem als 'completed' gespeichert; genau so ging ein halb
    // deutscher Newsletter an 626 englische Abonnenten.
    let blocksForChunk: unknown[] | null = null
    let lastProblem = ''
    for (let attempt = 1; attempt <= CHUNK_ATTEMPTS && !blocksForChunk; attempt++) {
      try {
        const chunkText = model.startsWith('claude')
          ? await translateWithClaude(systemPrompt, chunkPrompt, model)
          : await translateWithGemini(systemPrompt, chunkPrompt, model)
        blocksForChunk = extractBlockArray(parseChunkResponse(chunkText))
        if (!blocksForChunk) lastProblem = 'kein Block-Array in der Antwort'
      } catch (error) {
        // parseChunkResponse wirft bei kaputtem JSON — frueher riss das den
        // ganzen Lauf mit, obwohl ein neuer Versuch meist genuegt.
        lastProblem = error instanceof Error ? error.message : 'unbekannt'
        blocksForChunk = null
      }
      if (!blocksForChunk) {
        console.warn(`[Translation] Chunk ${chunkNum}/${totalChunks} Versuch ${attempt}/${CHUNK_ATTEMPTS} fehlgeschlagen: ${lastProblem}`)
      }
    }

    if (!blocksForChunk) {
      // KEIN stiller Rueckfall auf den Originaltext mehr. Der Fehler laesst den
      // Lauf scheitern, die translation_queue zaehlt den Versuch hoch und nimmt
      // ihn beim naechsten Tick erneut auf — und `content_translations` bleibt
      // ohne 'completed', sodass der Newsletter sauber auf Deutsch zurueckfaellt
      // statt eine halb uebersetzte Fassung zu verschicken.
      throw new Error(
        `Chunk ${chunkNum}/${totalChunks} nach ${CHUNK_ATTEMPTS} Versuchen nicht uebersetzbar (${lastProblem}) `
        + '— Lauf abgebrochen, statt unuebersetzten Text als fertig auszugeben.',
      )
    }
    return blocksForChunk
  }

  // In Wellen abarbeiten, damit nie mehr als CHUNK_CONCURRENCY Anfragen offen
  // sind. Das Ergebnis wird ueber den Index einsortiert — die Reihenfolge im
  // Artikel haengt nicht daran, welcher Aufruf zuerst zurueckkommt.
  const ergebnisse: unknown[][] = new Array(totalChunks)
  for (let start = 0; start < totalChunks; start += CHUNK_CONCURRENCY) {
    const welle = []
    for (let k = start; k < Math.min(start + CHUNK_CONCURRENCY, totalChunks); k++) {
      welle.push(uebersetzeChunk(k).then((bloecke) => { ergebnisse[k] = bloecke }))
    }
    // allSettled statt all: Bei `Promise.all` lehnt das Sammel-Promise sofort
    // ab, sobald EIN Chunk wirft — die uebrigen laufen weiter, und wirft davon
    // ein zweiter, ist das eine unbehandelte Ablehnung. Hier warten wir alle ab
    // und werfen danach den ersten Fehler weiter. Am Verhalten aendert das
    // nichts: Scheitert ein Chunk endgueltig, scheitert der ganze Lauf, genau
    // wie in der sequenziellen Fassung.
    const ausgang = await Promise.allSettled(welle)
    const gescheitert = ausgang.find((e) => e.status === 'rejected')
    if (gescheitert && gescheitert.status === 'rejected') throw gescheitert.reason
  }
  const translatedBlocks: unknown[] = ergebnisse.flat()

  const translatedContent = {
    type: 'doc',
    content: translatedBlocks,
  } as Record<string, unknown>

  const title = (meta.title as string) || source.title
  const normalizedTitle = fixQuotes(title, targetLanguage)
  const normalizedExcerpt = meta.excerpt ? fixQuotes(meta.excerpt as string, targetLanguage) : undefined
  reapplyBundleTypeAttrs(source.content, translatedContent)
  const normalizedContent = normalizeQuotesInTipTap(translatedContent, targetLanguage)

  return {
    success: true,
    title: normalizedTitle,
    slug: (meta.slug as string) || generateSlug(title),
    excerpt: normalizedExcerpt,
    content: normalizedContent,
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
    ? 'claude-haiku-4-5-20251001'
    : 'claude-sonnet-4-20250514'

  const response = await anthropic.messages.create({
    model: modelId,
    max_tokens: 16384,
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
 * Translate using Gemini.
 * Retries transient overload errors (503/429) with exponential backoff,
 * then falls back to gemini-2.0-flash if gemini-2.5-pro stays overloaded.
 */
async function translateWithGemini(
  systemPrompt: string,
  userPrompt: string,
  model: TranslationModel
): Promise<string> {
  const primaryId = model === 'gemini-2.5-pro' ? 'gemini-2.5-pro' : 'gemini-2.5-flash'

  try {
    return await callGeminiWithRetry(primaryId, systemPrompt, userPrompt, 3)
  } catch (error) {
    if (primaryId === 'gemini-2.5-pro' && isOverloadError(error)) {
      console.warn('[Translation] gemini-2.5-pro overloaded after retries, falling back to gemini-2.0-flash')
      return await callGeminiWithRetry('gemini-2.5-flash', systemPrompt, userPrompt, 2)
    }
    throw error
  }
}

async function callGeminiWithRetry(
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  maxAttempts: number
): Promise<string> {
  const gemini = genAI.getGenerativeModel({ model: modelId, systemInstruction: systemPrompt })
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await gemini.generateContent(userPrompt)
      return result.response.text()
    } catch (error) {
      lastError = error
      if (!isOverloadError(error) || attempt === maxAttempts) throw error
      const delayMs = 1000 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 500)
      console.warn(`[Translation] ${modelId} overloaded (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms`)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}

function isOverloadError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return /\b(503|429|overload|unavailable|high demand|rate limit|quota)\b/i.test(msg)
}

/**
 * Parse a chunk response that can be a JSON array or object
 */
/**
 * Holt das Block-Array aus einer Chunk-Antwort — egal, wie das Modell es verpackt.
 *
 * Der Uebersetzer bekommt ein TipTap-Block-Array und soll eines zurueckgeben. In
 * der Praxis liefert das Modell mal ein nacktes Array, mal `{content: [...]}`,
 * mal einen selbst erfundenen Wrapper (`{blocks: ...}`, `{translation: ...}`).
 * Der alte Code kannte nur die ersten zwei Formen und setzte sonst STILL den
 * deutschen Originalblock ein — so ging am 2026-08-21 ein halb deutscher
 * Newsletter an 626 englische Abonnenten (s. tests/lib/translation-chunk-format).
 *
 * Rueckgabe `null` heisst „hier ist keine brauchbare Uebersetzung drin" und
 * loest oben einen neuen Versuch aus. Ein LEERES Array gilt bewusst als
 * unbrauchbar: es wuerde den Abschnitt spurlos loeschen, was schlimmer waere als
 * unuebersetzter Text.
 */
export function extractBlockArray(parsed: unknown): unknown[] | null {
  const isBlocks = (v: unknown): v is unknown[] =>
    Array.isArray(v) && v.length > 0 &&
    v.every((b) => typeof b === 'object' && b !== null && 'type' in (b as Record<string, unknown>))

  if (isBlocks(parsed)) return parsed
  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>
    // content zuerst — das ist die dokumentierte Form eines TipTap-doc.
    if (isBlocks(obj.content)) return obj.content
    for (const value of Object.values(obj)) if (isBlocks(value)) return value
  }
  return null
}

function parseChunkResponse(text: string): unknown {
  let cleaned = text.trim()
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7)
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3)
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3)
  cleaned = cleaned.trim()

  try {
    return JSON.parse(cleaned)
  } catch (error) {
    console.error('[Translation] Chunk JSON parse error:', error)
    throw new Error('Failed to parse chunk response as JSON')
  }
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
 * Restores `bundleType` attrs (renders as `data-bundle-type`, see
 * lib/tiptap/heading-with-queue-id.ts) on the translated doc's top-level
 * heading nodes, matched by ordinal position against the source doc's
 * headings — same matching idiom as applyBundleMarkers in
 * lib/utils/markdown-to-tiptap.ts. The translation LLM is only
 * prompt-instructed to preserve the exact JSON structure/attrs (see
 * systemPrompt above); that's not a code-level guarantee, so this mutates
 * `translated` in place as a deterministic backstop against the LLM
 * dropping a custom, non-standard attribute while "cleaning up" the JSON.
 */
function reapplyBundleTypeAttrs(
  source: Record<string, unknown>,
  translated: Record<string, unknown>
): void {
  const sourceNodes = source.content
  const translatedNodes = translated.content
  if (!Array.isArray(sourceNodes) || !Array.isArray(translatedNodes)) return

  const sourceBundleTypes = sourceNodes
    .filter((n): n is { type: string; attrs?: Record<string, unknown> } =>
      !!n && typeof n === 'object' && (n as { type?: unknown }).type === 'heading'
    )
    .map((n) => (typeof n.attrs?.bundleType === 'string' ? n.attrs.bundleType : undefined))

  if (sourceBundleTypes.every((t) => !t)) return // nothing to restore

  let i = 0
  for (const node of translatedNodes) {
    if (!node || typeof node !== 'object' || (node as { type?: unknown }).type !== 'heading') continue
    const bundleType = sourceBundleTypes[i]
    if (bundleType) {
      const n = node as { attrs?: Record<string, unknown> }
      n.attrs = { ...(n.attrs || {}), bundleType }
    }
    i++
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
  model: TranslationModel = 'gemini-2.5-flash'
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
