/**
 * Task 11': queue_ranking wurde als Use Case entfernt (lib/ai/use-cases.ts),
 * weil der LLM-Reranker durch total_score + semantischen Dedup ersetzt wurde
 * (siehe lib/news-queue/ranking-service.ts). Ein bestehender DB-Eintrag in
 * settings.llm_model_config kann trotzdem noch einen alten 'queue_ranking'-
 * Schlüssel enthalten (vor dem nächsten Speichern über die Settings-UI).
 * Dieser Test stellt sicher, dass model-config.ts so einen verwaisten
 * Schlüssel stillschweigend ignoriert statt zu werfen.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              value: {
                queue_ranking: 'claude-sonnet-4-6', // stale — use case removed in Task 11'
                ghostwriter: 'claude-opus-5-custom',
              },
            },
            error: null,
          }),
        }),
      }),
    }),
  }),
}))

import { getFullModelConfig, getModelForUseCase } from '@/lib/ai/model-config'

describe('model-config: verwaister queue_ranking-Eintrag in der DB', () => {
  it('getFullModelConfig() wirft nicht und gibt den verwaisten Schlüssel nicht zurück', async () => {
    const full = await getFullModelConfig()
    expect(full).not.toHaveProperty('queue_ranking')
    expect(full.ghostwriter).toBe('claude-opus-5-custom')
  })

  it('getModelForUseCase() löst reguläre Use Cases weiterhin korrekt auf', async () => {
    const model = await getModelForUseCase('ghostwriter')
    expect(model).toBe('claude-opus-5-custom')
  })
})
