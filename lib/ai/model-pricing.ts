/**
 * Static AI model pricing data
 * Prices in USD per 1M tokens
 *
 * Since no provider offers a pricing API, this is maintained manually.
 * Last updated: 2026-03-16
 *
 * Pricing sources:
 * - Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
 * - OpenAI:    https://openai.com/api/pricing/
 * - Google:    https://ai.google.dev/gemini-api/docs/pricing
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

// Last verified: 2026-03-18
export const PRICING_LAST_UPDATED = '2026-03-18'

export const MODEL_PRICING: Record<string, ModelInfo> = {
  // ── Anthropic (verified 2026-03-16) ───────────────────────────────────────
  'claude-opus-4-6-20260301': {
    id: 'claude-opus-4-6-20260301',
    name: 'Claude Opus 4.6',
    provider: 'anthropic',
    pricing: { input: 5, output: 25 },
  },
  'claude-sonnet-4-6-20260301': {
    id: 'claude-sonnet-4-6-20260301',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    pricing: { input: 3, output: 15 },
  },
  'claude-sonnet-4-5-20250514': {
    id: 'claude-sonnet-4-5-20250514',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    pricing: { input: 3, output: 15 },
  },
  'claude-haiku-4-5-20251001': {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    pricing: { input: 1, output: 5 },
  },
  'claude-opus-4-5-20251101': {
    id: 'claude-opus-4-5-20251101',
    name: 'Claude Opus 4.5',
    provider: 'anthropic',
    pricing: { input: 5, output: 25 },
  },
  // Legacy — still returned by API but superseded
  'claude-opus-4-1-20250805': {
    id: 'claude-opus-4-1-20250805',
    name: 'Claude Opus 4.1 (Legacy)',
    provider: 'anthropic',
    pricing: { input: 15, output: 75 },
  },
  'claude-opus-4-20250514': {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4 (Legacy)',
    provider: 'anthropic',
    pricing: { input: 15, output: 75 },
  },
  'claude-sonnet-4-20250514': {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4 (Legacy)',
    provider: 'anthropic',
    pricing: { input: 3, output: 15 },
  },

  // ── OpenAI (verified 2026-03-16) ──────────────────────────────────────────
  'gpt-5.4': {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    provider: 'openai',
    pricing: { input: 2.5, output: 15 },
  },
  'gpt-5.4-mini': {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    provider: 'openai',
    pricing: { input: 0.75, output: 4.50 },
  },
  'gpt-5.4-nano': {
    id: 'gpt-5.4-nano',
    name: 'GPT-5.4 Nano',
    provider: 'openai',
    pricing: { input: 0.20, output: 1.25 },
  },
  'gpt-5.2': {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    provider: 'openai',
    pricing: { input: 1.75, output: 14 },
  },
  'gpt-4o': {
    id: 'gpt-4o',
    name: 'GPT-4o (Legacy)',
    provider: 'openai',
    pricing: { input: 2.5, output: 10 },
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini (Legacy)',
    provider: 'openai',
    pricing: { input: 0.15, output: 0.6 },
  },

  // ── Google (verified 2026-03-16) ──────────────────────────────────────────
  'gemini-2.5-pro': {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'google',
    pricing: { input: 1.25, output: 10 },
  },
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'google',
    pricing: { input: 0.30, output: 2.50 },
  },
  'gemini-2.5-flash-lite': {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    provider: 'google',
    pricing: { input: 0.10, output: 0.40 },
  },
}

/**
 * Format pricing for display in dropdowns
 * e.g. "Claude Sonnet 4.6 ($3/$15 per 1M tokens)"
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
