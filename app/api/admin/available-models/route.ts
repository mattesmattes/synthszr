/**
 * GET /api/admin/available-models
 *
 * Fetches available models from all configured AI providers.
 * Merges live API results with static pricing data.
 * New models from providers appear automatically (without pricing).
 * Results are cached for 5 minutes.
 */

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { MODEL_PRICING, PRICING_LAST_UPDATED, type ModelInfo } from '@/lib/ai/model-pricing'
import { getFullModelConfig, saveModelConfig, type LlmModelConfig } from '@/lib/ai/model-config'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

interface CachedResult {
  models: ModelInfo[]
  timestamp: number
}

let cache: CachedResult | null = null
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// Filter patterns — only include models relevant for text generation
const ANTHROPIC_INCLUDE = /^claude-/
const OPENAI_TEXT_INCLUDE = /^(gpt-|o[0-9])/
const GOOGLE_TEXT_INCLUDE = /^gemini-/

// Exclude non-text-generation models from text-model lists
const ANTHROPIC_EXCLUDE = /haiku-3|claude-3-/i
const OPENAI_TEXT_EXCLUDE = /embedding|moderation|tts|whisper|dall-e|davinci|babbage|realtime|image|audio|transcribe|search/i
const GOOGLE_TEXT_EXCLUDE = /embedding|aqa|vision-only|imagen|preview|audio|image|tts|computer-use|latest$/i

// Image-generation models — separate include patterns
const OPENAI_IMAGE_INCLUDE = /^(gpt-image-|dall-e-)/i
const OPENAI_IMAGE_EXCLUDE = /-mini$/i // exclude mini for now (lower quality)
const GOOGLE_IMAGE_INCLUDE = /-image($|-)/i
// Image models often ship as "-preview" first (e.g. gemini-3-pro-image-preview).
// Only filter out "-latest" alias and dated snapshots so the canonical ID wins.
const GOOGLE_IMAGE_EXCLUDE = /latest$|-\d{8}$/i

type ModelCategory = 'text' | 'image'
type ProviderId = 'anthropic' | 'openai' | 'google'

async function fetchAnthropicModels(): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) return []
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.models.list({ limit: 100 })
    return response.data
      .map((m) => m.id)
      .filter(id => ANTHROPIC_INCLUDE.test(id) && !ANTHROPIC_EXCLUDE.test(id))
  } catch (error) {
    console.error('[AvailableModels] Anthropic fetch failed:', error)
    return []
  }
}

interface ProviderFetchResult {
  text: string[]
  image: string[]
}

async function fetchOpenAIModels(): Promise<ProviderFetchResult> {
  if (!process.env.OPENAI_API_KEY) return { text: [], image: [] }
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const response = await openai.models.list()
    const all = response.data.map((m) => m.id)
    return {
      text: all.filter(id => OPENAI_TEXT_INCLUDE.test(id) && !OPENAI_TEXT_EXCLUDE.test(id)),
      image: all.filter(id => OPENAI_IMAGE_INCLUDE.test(id) && !OPENAI_IMAGE_EXCLUDE.test(id)),
    }
  } catch (error) {
    console.error('[AvailableModels] OpenAI fetch failed:', error)
    return { text: [], image: [] }
  }
}

async function fetchGoogleModels(): Promise<ProviderFetchResult> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) return { text: [], image: [] }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GOOGLE_GENERATIVE_AI_API_KEY}`,
      { signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) return { text: [], image: [] }
    const data = await res.json()
    const all: string[] = (data.models || []).map((m: { name: string }) => m.name.replace('models/', ''))
    return {
      text: all.filter((id) => GOOGLE_TEXT_INCLUDE.test(id) && !GOOGLE_TEXT_EXCLUDE.test(id)),
      image: all.filter((id) => GOOGLE_IMAGE_INCLUDE.test(id) && !GOOGLE_IMAGE_EXCLUDE.test(id)),
    }
  } catch (error) {
    console.error('[AvailableModels] Google fetch failed:', error)
    return { text: [], image: [] }
  }
}

/**
 * Find pricing info for a model ID.
 * Tries exact match, then strips date suffixes to match aliases.
 * e.g. "claude-opus-4-6" matches "claude-opus-4-6-20260301"
 * e.g. "claude-sonnet-4-5-20250929" matches "claude-sonnet-4-5-20250514"
 */
function findPricing(id: string): ModelInfo | undefined {
  if (MODEL_PRICING[id]) return MODEL_PRICING[id]
  const base = id.replace(/-\d{8}$/, '')
  for (const [key, info] of Object.entries(MODEL_PRICING)) {
    const keyBase = key.replace(/-\d{8}$/, '')
    if (base === keyBase || base === key || id === keyBase) return info
  }
  return undefined
}

/**
 * Create a human-readable name from a model ID
 */
function humanizeName(id: string, provider: 'anthropic' | 'openai' | 'google'): string {
  const priced = findPricing(id)
  if (priced) return priced.name

  const cleaned = id
    .replace(/^models\//, '')
    .replace(/-\d{8}$/, '')
  const parts = cleaned.split('-')
  return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

export async function GET(request: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  // Allow cache bypass via ?refresh=true
  const { searchParams } = new URL(request.url)
  const forceRefresh = searchParams.get('refresh') === 'true'
  if (forceRefresh) {
    cache = null
  }

  // Return cached result if fresh
  const now = Date.now()
  if (cache && now - cache.timestamp < CACHE_TTL_MS) {
    const config = await getFullModelConfig()
    return NextResponse.json({ models: cache.models, config, pricingLastUpdated: PRICING_LAST_UPDATED })
  }

  // Fetch from all providers in parallel (with timeout)
  const emptyResult: ProviderFetchResult = { text: [], image: [] }
  const [anthropicIds, openaiResult, googleResult] = await Promise.all([
    Promise.race([fetchAnthropicModels(), timeout(8000, [] as string[])]),
    Promise.race([fetchOpenAIModels(), timeout(8000, emptyResult)]),
    Promise.race([fetchGoogleModels(), timeout(8000, emptyResult)]),
  ])

  console.log(`[AvailableModels] Fetched: ${anthropicIds.length} Anthropic, ${openaiResult.text.length}+${openaiResult.image.length}img OpenAI, ${googleResult.text.length}+${googleResult.image.length}img Google`)

  // Build models from live API results, enriched with pricing where available
  const seenIds = new Set<string>()
  const availableModels: ModelInfo[] = []

  function addModels(ids: string[], provider: ProviderId, category: ModelCategory) {
    for (const id of ids) {
      // For image models the canonical id is namespaced (provider/model)
      // so different providers can share short names without collision.
      const canonical = category === 'image' ? `${provider}/${id}` : id
      if (seenIds.has(canonical)) continue
      seenIds.add(canonical)

      const known = findPricing(id) || findPricing(canonical)
      if (known) {
        availableModels.push({ ...known, id: canonical, provider, category })
      } else {
        availableModels.push({
          id: canonical,
          name: humanizeName(id, provider),
          provider,
          pricing: { input: 0, output: 0 },
          category,
        })
      }
    }
  }

  addModels(anthropicIds, 'anthropic', 'text')
  addModels(openaiResult.text, 'openai', 'text')
  addModels(googleResult.text, 'google', 'text')
  addModels(openaiResult.image, 'openai', 'image')
  addModels(googleResult.image, 'google', 'image')

  // Fallback: if a provider API returned nothing but the key exists,
  // include the known models from our pricing map for that provider
  if (anthropicIds.length === 0 && process.env.ANTHROPIC_API_KEY) {
    for (const info of Object.values(MODEL_PRICING)) {
      if (info.provider === 'anthropic' && (info.category ?? 'text') === 'text' && !seenIds.has(info.id)) {
        availableModels.push({ ...info, category: 'text' })
        seenIds.add(info.id)
      }
    }
  }
  if (openaiResult.text.length === 0 && openaiResult.image.length === 0 && process.env.OPENAI_API_KEY) {
    for (const info of Object.values(MODEL_PRICING)) {
      if (info.provider === 'openai' && !seenIds.has(info.id)) {
        availableModels.push(info)
        seenIds.add(info.id)
      }
    }
  }
  if (googleResult.text.length === 0 && googleResult.image.length === 0 && process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    for (const info of Object.values(MODEL_PRICING)) {
      if (info.provider === 'google' && !seenIds.has(info.id)) {
        availableModels.push(info)
        seenIds.add(info.id)
      }
    }
  }

  // Sort: image models first (small group, separate widget), then text by
  // pricing-known status, then alphabetically.
  availableModels.sort((a, b) => {
    const aImg = (a.category === 'image') ? 0 : 1
    const bImg = (b.category === 'image') ? 0 : 1
    if (aImg !== bImg) return aImg - bImg
    const aKnown = a.pricing.input > 0 ? 0 : 1
    const bKnown = b.pricing.input > 0 ? 0 : 1
    if (aKnown !== bKnown) return aKnown - bKnown
    return a.name.localeCompare(b.name)
  })

  // Update cache
  cache = { models: availableModels, timestamp: now }

  const config = await getFullModelConfig()
  return NextResponse.json({ models: availableModels, config, pricingLastUpdated: PRICING_LAST_UPDATED })
}

/**
 * PUT /api/admin/available-models
 * Save model configuration
 */
export async function PUT(request: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const config: LlmModelConfig = await request.json()
    await saveModelConfig(config)
    return NextResponse.json({ success: true, config })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

function timeout<T>(ms: number, fallback: T): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(fallback), ms))
}
