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
import { MODEL_PRICING, type ModelInfo } from '@/lib/ai/model-pricing'
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
const OPENAI_INCLUDE = /^(gpt-|o[0-9])/
const GOOGLE_INCLUDE = /^gemini-/

// Exclude embedding, moderation, tts, whisper, dall-e etc.
const OPENAI_EXCLUDE = /embedding|moderation|tts|whisper|dall-e|davinci|babbage|realtime/i
const GOOGLE_EXCLUDE = /embedding|aqa|vision-only|imagen/i

async function fetchAnthropicModels(): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) return []
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.models.list({ limit: 100 })
    return response.data
      .map((m) => m.id)
      .filter(id => ANTHROPIC_INCLUDE.test(id))
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
      .filter(id => OPENAI_INCLUDE.test(id) && !OPENAI_EXCLUDE.test(id))
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
      .filter((id: string) => GOOGLE_INCLUDE.test(id) && !GOOGLE_EXCLUDE.test(id))
  } catch (error) {
    console.error('[AvailableModels] Google fetch failed:', error)
    return []
  }
}

/**
 * Create a human-readable name from a model ID
 * e.g. "claude-sonnet-4-20250514" → "claude-sonnet-4-20250514"
 */
function humanizeName(id: string, provider: 'anthropic' | 'openai' | 'google'): string {
  // If we have it in our pricing map, use the curated name
  if (MODEL_PRICING[id]) return MODEL_PRICING[id].name

  // Otherwise, create a reasonable name from the ID
  const cleaned = id
    .replace(/^models\//, '')
    .replace(/-\d{8}$/, '') // strip date suffixes like -20250514
  const parts = cleaned.split('-')
  const capitalized = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')

  const providerPrefix: Record<string, string> = {
    anthropic: '',
    openai: '',
    google: '',
  }
  return `${providerPrefix[provider]}${capitalized}`
}

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  // Return cached result if fresh
  const now = Date.now()
  if (cache && now - cache.timestamp < CACHE_TTL_MS) {
    const config = await getFullModelConfig()
    return NextResponse.json({ models: cache.models, config })
  }

  // Fetch from all providers in parallel (with timeout)
  const [anthropicIds, openaiIds, googleIds] = await Promise.all([
    Promise.race([fetchAnthropicModels(), timeout(8000, [] as string[])]),
    Promise.race([fetchOpenAIModels(), timeout(8000, [] as string[])]),
    Promise.race([fetchGoogleModels(), timeout(8000, [] as string[])]),
  ])

  console.log(`[AvailableModels] Fetched: ${anthropicIds.length} Anthropic, ${openaiIds.length} OpenAI, ${googleIds.length} Google`)

  // Build models from live API results, enriched with pricing where available
  const seenIds = new Set<string>()
  const availableModels: ModelInfo[] = []

  function addModels(ids: string[], provider: 'anthropic' | 'openai' | 'google') {
    for (const id of ids) {
      if (seenIds.has(id)) continue
      seenIds.add(id)

      const known = MODEL_PRICING[id]
      if (known) {
        availableModels.push(known)
      } else {
        // New model from API — include without pricing
        availableModels.push({
          id,
          name: humanizeName(id, provider),
          provider,
          pricing: { input: 0, output: 0 }, // unknown pricing
        })
      }
    }
  }

  addModels(anthropicIds, 'anthropic')
  addModels(openaiIds, 'openai')
  addModels(googleIds, 'google')

  // Fallback: if a provider API returned nothing but the key exists,
  // include the known models from our pricing map for that provider
  if (anthropicIds.length === 0 && process.env.ANTHROPIC_API_KEY) {
    for (const info of Object.values(MODEL_PRICING)) {
      if (info.provider === 'anthropic' && !seenIds.has(info.id)) {
        availableModels.push(info)
        seenIds.add(info.id)
      }
    }
  }
  if (openaiIds.length === 0 && process.env.OPENAI_API_KEY) {
    for (const info of Object.values(MODEL_PRICING)) {
      if (info.provider === 'openai' && !seenIds.has(info.id)) {
        availableModels.push(info)
        seenIds.add(info.id)
      }
    }
  }
  if (googleIds.length === 0 && process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    for (const info of Object.values(MODEL_PRICING)) {
      if (info.provider === 'google' && !seenIds.has(info.id)) {
        availableModels.push(info)
        seenIds.add(info.id)
      }
    }
  }

  // Sort: known models (with pricing) first, then alphabetically
  availableModels.sort((a, b) => {
    const aKnown = a.pricing.input > 0 ? 0 : 1
    const bKnown = b.pricing.input > 0 ? 0 : 1
    if (aKnown !== bKnown) return aKnown - bKnown
    return a.name.localeCompare(b.name)
  })

  // Update cache
  cache = { models: availableModels, timestamp: now }

  const config = await getFullModelConfig()
  return NextResponse.json({ models: availableModels, config })
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
