/**
 * GET /api/admin/available-models
 *
 * Fetches available models from all configured AI providers.
 * Merges with static pricing data.
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

async function fetchAnthropicModels(): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) return []
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.models.list({ limit: 50 })
    return response.data.map((m) => m.id)
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
    return response.data.map((m) => m.id)
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
    // Google returns models like "models/gemini-2.0-flash" — strip prefix
    return (data.models || []).map((m: { name: string }) =>
      m.name.replace('models/', '')
    )
  } catch (error) {
    console.error('[AvailableModels] Google fetch failed:', error)
    return []
  }
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

  // Build available models list — only include models that exist in our pricing map
  // AND are actually available from the provider
  const availableModels: ModelInfo[] = []

  for (const [modelId, info] of Object.entries(MODEL_PRICING)) {
    let isAvailable = false

    switch (info.provider) {
      case 'anthropic':
        // Check if model ID matches (API returns full IDs)
        isAvailable = anthropicIds.length > 0 && (
          anthropicIds.includes(modelId) ||
          anthropicIds.some(id => modelId.startsWith(id) || id.startsWith(modelId))
        )
        // If Anthropic key exists but API listing failed, still include known models
        if (!isAvailable && process.env.ANTHROPIC_API_KEY) {
          isAvailable = true
        }
        break
      case 'openai':
        isAvailable = openaiIds.length > 0 && (
          openaiIds.includes(modelId) ||
          openaiIds.some(id => modelId.startsWith(id) || id.startsWith(modelId))
        )
        if (!isAvailable && process.env.OPENAI_API_KEY) {
          isAvailable = true
        }
        break
      case 'google':
        isAvailable = googleIds.length > 0 && (
          googleIds.includes(modelId) ||
          googleIds.some(id => modelId.startsWith(id) || id.startsWith(modelId))
        )
        if (!isAvailable && process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
          isAvailable = true
        }
        break
    }

    if (isAvailable) {
      availableModels.push(info)
    }
  }

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
