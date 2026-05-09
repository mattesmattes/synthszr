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

type ProviderId = 'anthropic' | 'openai' | 'google'

// Image-generation dropdown is curated by hand. Provider model-list APIs
// either over-include (every preview revision) or under-include (don't
// list newest models like gemini-3-pro-image at all). Keeping this
// explicit makes the dropdown predictable.
const CURATED_IMAGE_MODELS: ModelInfo[] = [
  {
    id: 'google/gemini-3-pro-image',
    name: 'Gemini 3 Pro Image',
    provider: 'google',
    pricing: { input: 0, output: 0 },
    category: 'image',
  },
  {
    id: 'openai/gpt-image-2',
    name: 'GPT Image 2',
    provider: 'openai',
    pricing: { input: 0, output: 0 },
    category: 'image',
  },
]

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

async function fetchOpenAIModels(): Promise<string[]> {
  if (!process.env.OPENAI_API_KEY) return []
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const response = await openai.models.list()
    return response.data
      .map((m) => m.id)
      .filter(id => OPENAI_TEXT_INCLUDE.test(id) && !OPENAI_TEXT_EXCLUDE.test(id))
  } catch (error) {
    console.error('[AvailableModels] OpenAI fetch failed:', error)
    return []
  }
}

async function fetchGoogleModels(): Promise<string[]> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) return []
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GOOGLE_GENERATIVE_AI_API_KEY}`,
      { signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) return []
    const data = await res.json()
    return (data.models || [])
      .map((m: { name: string }) => m.name.replace('models/', ''))
      .filter((id: string) => GOOGLE_TEXT_INCLUDE.test(id) && !GOOGLE_TEXT_EXCLUDE.test(id))
  } catch (error) {
    console.error('[AvailableModels] Google fetch failed:', error)
    return []
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

  // Fetch text models from providers in parallel (with timeout). Image
  // models come from CURATED_IMAGE_MODELS — see comment at the constant.
  const [anthropicIds, openaiIds, googleIds] = await Promise.all([
    Promise.race([fetchAnthropicModels(), timeout(8000, [] as string[])]),
    Promise.race([fetchOpenAIModels(), timeout(8000, [] as string[])]),
    Promise.race([fetchGoogleModels(), timeout(8000, [] as string[])]),
  ])

  console.log(`[AvailableModels] Fetched text: ${anthropicIds.length} Anthropic, ${openaiIds.length} OpenAI, ${googleIds.length} Google + ${CURATED_IMAGE_MODELS.length} curated image`)

  // Build models from live API results, enriched with pricing where available
  const seenIds = new Set<string>()
  const availableModels: ModelInfo[] = []

  function addTextModels(ids: string[], provider: ProviderId) {
    for (const id of ids) {
      if (seenIds.has(id)) continue
      seenIds.add(id)

      const known = findPricing(id)
      if (known) {
        availableModels.push({ ...known, id, provider, category: 'text' })
      } else {
        availableModels.push({
          id,
          name: humanizeName(id, provider),
          provider,
          pricing: { input: 0, output: 0 },
          category: 'text',
        })
      }
    }
  }

  addTextModels(anthropicIds, 'anthropic')
  addTextModels(openaiIds, 'openai')
  addTextModels(googleIds, 'google')

  // Add curated image models (always present — independent of API listings)
  for (const m of CURATED_IMAGE_MODELS) {
    if (!seenIds.has(m.id)) {
      availableModels.push(m)
      seenIds.add(m.id)
    }
  }

  // Fallback: if a text provider API returned nothing but the key exists,
  // include the known models from our pricing map for that provider
  if (anthropicIds.length === 0 && process.env.ANTHROPIC_API_KEY) {
    for (const info of Object.values(MODEL_PRICING)) {
      if (info.provider === 'anthropic' && (info.category ?? 'text') === 'text' && !seenIds.has(info.id)) {
        availableModels.push({ ...info, category: 'text' })
        seenIds.add(info.id)
      }
    }
  }
  if (openaiIds.length === 0 && process.env.OPENAI_API_KEY) {
    for (const info of Object.values(MODEL_PRICING)) {
      if (info.provider === 'openai' && (info.category ?? 'text') === 'text' && !seenIds.has(info.id)) {
        availableModels.push({ ...info, category: 'text' })
        seenIds.add(info.id)
      }
    }
  }
  if (googleIds.length === 0 && process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    for (const info of Object.values(MODEL_PRICING)) {
      if (info.provider === 'google' && (info.category ?? 'text') === 'text' && !seenIds.has(info.id)) {
        availableModels.push({ ...info, category: 'text' })
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
