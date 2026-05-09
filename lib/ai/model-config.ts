/**
 * Centralized AI model configuration
 *
 * Reads model preferences from the `settings` table (key: 'llm_model_config')
 * and provides fallback defaults for each use case.
 */

import { createAdminClient } from '@/lib/supabase/admin'

export type UseCase =
  | 'ghostwriter'
  | 'article_planning'
  | 'proofreading'
  | 'synthesis_scoring'
  | 'synthesis_development'
  | 'podcast_script'
  | 'edit_analysis'
  | 'pattern_extraction'
  | 'image_generation'

export interface UseCaseInfo {
  label: string
  description: string
  defaultModel: string
  allowedProviders: Array<'anthropic' | 'openai' | 'google'>
}

export const USE_CASE_DEFINITIONS: Record<UseCase, UseCaseInfo> = {
  ghostwriter: {
    label: 'Ghostwriter',
    description: 'Blog-Artikel aus dem Digest generieren',
    defaultModel: 'claude-sonnet-4-6-20260301',
    allowedProviders: ['anthropic', 'openai', 'google'],
  },
  article_planning: {
    label: 'Artikel-Planung',
    description: 'Struktur, Reihenfolge und Überschriften planen',
    defaultModel: 'gemini-2.0-flash',
    allowedProviders: ['anthropic', 'openai', 'google'],
  },
  proofreading: {
    label: 'Rechtschreibprüfung',
    description: 'Deutsche Rechtschreib- und Grammatikkorrektur',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic', 'openai', 'google'],
  },
  synthesis_scoring: {
    label: 'Bewertung (Scoring)',
    description: 'Artikel nach Originalität und Relevanz bewerten',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
  synthesis_development: {
    label: 'Synthese (Development)',
    description: 'Synthese-Texte aus Artikelpaaren entwickeln',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
  podcast_script: {
    label: 'Podcast-Skript',
    description: 'Podcast-Skripte aus Blog-Artikeln generieren',
    defaultModel: 'claude-sonnet-4-6-20260301',
    allowedProviders: ['anthropic'],
  },
  edit_analysis: {
    label: 'Edit-Analyse',
    description: 'Manuelle Edits klassifizieren und analysieren',
    defaultModel: 'claude-sonnet-4-6-20260301',
    allowedProviders: ['anthropic'],
  },
  pattern_extraction: {
    label: 'Pattern-Extraktion',
    description: 'Muster aus wiederkehrenden Edits extrahieren',
    defaultModel: 'claude-sonnet-4-6-20260301',
    allowedProviders: ['anthropic'],
  },
  image_generation: {
    label: 'Bildgenerierung',
    description: 'Article-Thumbnails und Cover-Bilder',
    defaultModel: 'google/gemini-3-pro-image',
    allowedProviders: ['openai', 'google'],
  },
}

export type LlmModelConfig = Partial<Record<UseCase, string>>

// In-memory cache with TTL
let cachedConfig: LlmModelConfig | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 60_000 // 1 minute

/**
 * Load model config from the database
 */
async function loadModelConfig(): Promise<LlmModelConfig> {
  const now = Date.now()
  if (cachedConfig && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedConfig
  }

  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'llm_model_config')
      .single()

    cachedConfig = (data?.value as LlmModelConfig) || {}
    cacheTimestamp = now
    return cachedConfig
  } catch {
    console.error('[ModelConfig] Failed to load config, using defaults')
    return {}
  }
}

/**
 * Get the configured model for a specific use case.
 * Falls back to the hardcoded default if not configured.
 */
export async function getModelForUseCase(useCase: UseCase): Promise<string> {
  const config = await loadModelConfig()
  const configured = config[useCase]

  if (configured) {
    console.log(`[ModelConfig] ${useCase} → ${configured} (from DB)`)
    return configured
  }

  const fallback = USE_CASE_DEFINITIONS[useCase].defaultModel
  console.log(`[ModelConfig] ${useCase} → ${fallback} (FALLBACK default)`)
  return fallback
}

/**
 * Save model config to the database
 */
export async function saveModelConfig(config: LlmModelConfig): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('settings')
    .upsert(
      { key: 'llm_model_config', value: config },
      { onConflict: 'key' }
    )

  if (error) {
    throw new Error(`Failed to save model config: ${error.message}`)
  }

  // Invalidate cache
  cachedConfig = config
  cacheTimestamp = Date.now()
}

/**
 * Get the full current config (merged with defaults)
 */
export async function getFullModelConfig(): Promise<Record<UseCase, string>> {
  const config = await loadModelConfig()
  const full: Record<string, string> = {}

  for (const [useCase, info] of Object.entries(USE_CASE_DEFINITIONS)) {
    full[useCase] = config[useCase as UseCase] || info.defaultModel
  }

  return full as Record<UseCase, string>
}
