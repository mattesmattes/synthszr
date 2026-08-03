/**
 * Centralized AI model configuration
 *
 * Reads model preferences from the `settings` table (key: 'llm_model_config')
 * and provides fallback defaults for each use case.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { USE_CASE_DEFINITIONS, type UseCase, type UseCaseInfo } from '@/lib/ai/use-cases'

// Re-exported for backward compatibility — the definitions themselves now
// live in `lib/ai/use-cases.ts` (no server-only imports), so they can also
// be imported from client components (e.g. app/admin/settings/page.tsx)
// without pulling `createAdminClient` into the browser bundle.
export { USE_CASE_DEFINITIONS }
export type { UseCase, UseCaseInfo }

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
