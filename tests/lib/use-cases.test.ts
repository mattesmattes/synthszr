import { describe, expect, it } from 'vitest'
import { USE_CASE_DEFINITIONS, type UseCase } from '@/lib/ai/use-cases'

// Vollständige Liste aller bekannten Use Cases — falls hier jemand einen neuen
// Use Case in model-config.ts/use-cases.ts ergänzt, ohne das Settings-UI zu
// aktualisieren, soll das sichtbar werden (siehe app/admin/settings/page.tsx).
const EXPECTED_USE_CASES: UseCase[] = [
  'ghostwriter',
  'article_planning',
  'proofreading',
  'synthesis_scoring',
  'podcast_script',
  'edit_analysis',
  'pattern_extraction',
  'queue_ranking',
  'image_generation',
  'ranking_extract',
  'ranking_attribution_qa',
  'ranking_validity_qa',
  'subscription_detect',
  'glossary_candidate_identification',
  'glossary_generation',
  'glossary_readability_qa',
  'glossary_news_context',
]

describe('USE_CASE_DEFINITIONS (lib/ai/use-cases.ts)', () => {
  it('enthält genau die erwarteten Use Cases', () => {
    expect(Object.keys(USE_CASE_DEFINITIONS).sort()).toEqual([...EXPECTED_USE_CASES].sort())
  })

  it('jeder Use Case hat label, description, defaultModel und allowedProviders', () => {
    for (const [key, info] of Object.entries(USE_CASE_DEFINITIONS)) {
      expect(info.label, `${key}.label`).toBeTruthy()
      expect(info.description, `${key}.description`).toBeTruthy()
      expect(info.defaultModel, `${key}.defaultModel`).toBeTruthy()
      expect(info.allowedProviders.length, `${key}.allowedProviders`).toBeGreaterThan(0)
    }
  })

  it('importiert ohne Server-Abhängigkeiten (keine import-Statements im Modul)', async () => {
    // Regressionsschutz: dieses Modul darf keinen Supabase-Admin-Client (oder
    // sonst irgendeine Abhängigkeit) importieren, sonst ist es nicht
    // client-safe importierbar (siehe page.tsx). Reine Import-Zeilen-Prüfung,
    // damit Kommentare, die '@/lib/supabase' nur erwähnen, nicht anschlagen.
    const fs = await import('fs')
    const path = await import('path')
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../lib/ai/use-cases.ts'),
      'utf-8'
    )
    const importLines = src.split('\n').filter(line => /^\s*import\b/.test(line))
    expect(importLines).toEqual([])
  })
})
