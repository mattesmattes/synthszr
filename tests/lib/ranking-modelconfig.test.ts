import { describe, it, expect } from 'vitest'
import { USE_CASE_DEFINITIONS } from '@/lib/ai/model-config'

describe('queue_ranking use case', () => {
  it('is defined with an anthropic default model', () => {
    const def = USE_CASE_DEFINITIONS['queue_ranking']
    expect(def).toBeDefined()
    expect(def.defaultModel).toBe('claude-sonnet-4-6')
    expect(def.allowedProviders).toContain('anthropic')
  })
})
