/**
 * Static AI model pricing data
 * Prices in USD per 1M tokens
 *
 * Since no provider offers a pricing API, this is maintained manually.
 * Last updated: 2026-03-05
 */

export interface ModelPricing {
  input: number   // USD per 1M input tokens
  output: number  // USD per 1M output tokens
}

export interface ModelInfo {
  id: string
  name: string
  provider: 'anthropic' | 'openai' | 'google'
  pricing: ModelPricing
}

export const MODEL_PRICING: Record<string, ModelInfo> = {
  // Anthropic
  'claude-opus-4-20250514': {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    provider: 'anthropic',
    pricing: { input: 15, output: 75 },
  },
  'claude-sonnet-4-20250514': {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    pricing: { input: 3, output: 15 },
  },
  'claude-haiku-4-5-20251001': {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    pricing: { input: 0.80, output: 4 },
  },
  // OpenAI
  'gpt-5.2': {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    provider: 'openai',
    pricing: { input: 2.5, output: 10 },
  },
  'gpt-5.2-mini': {
    id: 'gpt-5.2-mini',
    name: 'GPT-5.2 Mini',
    provider: 'openai',
    pricing: { input: 0.15, output: 0.6 },
  },
  'gpt-4o': {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    pricing: { input: 2.5, output: 10 },
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    pricing: { input: 0.15, output: 0.6 },
  },
  // Google
  'gemini-2.5-pro': {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    pricing: { input: 1.25, output: 10 },
  },
  'gemini-2.0-flash': {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'google',
    pricing: { input: 0.10, output: 0.40 },
  },
}

/**
 * Format pricing for display in dropdowns
 * e.g. "Claude Sonnet 4 ($3/$15 per 1M tokens)"
 */
export function formatModelLabel(modelId: string): string {
  const info = MODEL_PRICING[modelId]
  if (!info) return modelId
  return `${info.name} ($${info.pricing.input}/$${info.pricing.output})`
}

/**
 * Get all models for a specific provider
 */
export function getModelsByProvider(provider: 'anthropic' | 'openai' | 'google'): ModelInfo[] {
  return Object.values(MODEL_PRICING).filter(m => m.provider === provider)
}
