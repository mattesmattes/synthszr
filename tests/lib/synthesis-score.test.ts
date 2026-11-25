import { describe, expect, it } from 'vitest'
import {
  buildBatchScoringPrompt,
  buildScoringRequestParams,
  extractTextFromContent,
  parseBatchScoreText,
} from '@/lib/synthesis/score'
import type Anthropic from '@anthropic-ai/sdk'

describe('buildScoringRequestParams', () => {
  it('deaktiviert Thinking explizit für claude-haiku-5-5 und gibt ausreichend max_tokens', () => {
    const params = buildScoringRequestParams('claude-haiku-5-5', 'prompt', 10) as unknown as Record<string, unknown>
    expect(params.thinking).toEqual({ type: 'disabled' })
    expect(params.max_tokens).toBeGreaterThanOrEqual(850)
  })

  it('setzt effort: low für Modelle ohne disabled-Thinking wie claude-opus-5-5 und erhöht max_tokens', () => {
    const params = buildScoringRequestParams('claude-opus-5-5', 'prompt', 10) as unknown as Record<string, unknown>
    expect(params.thinking).toBeUndefined()
    expect(params.output_config).toEqual({ effort: 'low' })
    expect(params.max_tokens).toBe(1800)
  })

  it('lässt thinking für Legacy-Modelle wie claude-haiku-4-5-20251001 weg', () => {
    const params = buildScoringRequestParams('claude-haiku-4-5-20251001', 'prompt', 10) as unknown as Record<string, unknown>
    expect(params.thinking).toBeUndefined()
    expect(params.output_config).toBeUndefined()
    expect(params.max_tokens).toBe(850)
  })
})

describe('extractTextFromContent', () => {
  it('liest Textblöcke auch dann aus, wenn zuerst ein Thinking-Block steht', () => {
    const content = [
      { type: 'thinking', thinking: 'internal', signature: 'sig' },
      { type: 'text', text: 'ARTIKEL_1: SUBSTANZ:8 RELEVANZ:9 NEUHEIT:7' },
    ] as unknown as Anthropic.Message['content']
    expect(extractTextFromContent(content)).toBe('ARTIKEL_1: SUBSTANZ:8 RELEVANZ:9 NEUHEIT:7')
  })
})

describe('parseBatchScoreText', () => {
  const group = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('parst Klartext, Markdown-Bold, Dezimalwerte und kappt Ausreißer auf [0, 10]', () => {
    const text = [
      'ARTIKEL_1: SUBSTANZ:8 RELEVANZ:9 NEUHEIT:7',
      '- **ARTIKEL 2**: **SUBSTANZ**: 7.5, **RELEVANZ**: 8,5; **NEUHEIT**: 12',
      'ARTIKEL_3: SUBSTANZ:0 RELEVANZ:1 NEUHEIT:0',
    ].join('\n')

    const { results, parseFailures } = parseBatchScoreText(text, group)
    expect(parseFailures).toBe(0)
    expect(results[0].score).toMatchObject({ synthesisScore: 8, relevanceScore: 9, uniquenessScore: 7 })
    expect(results[1].score).toMatchObject({ synthesisScore: 7.5, relevanceScore: 8.5, uniquenessScore: 10 })
    expect(results[2].score).toMatchObject({ synthesisScore: 0, relevanceScore: 1, uniquenessScore: 0 })
  })

  it('zählt Parse-Fehler explizit und fällt pro fehlendem Artikel auf 3/3/3 zurück', () => {
    const { results, parseFailures } = parseBatchScoreText('ARTIKEL_1: SUBSTANZ:8 RELEVANZ:9 NEUHEIT:7', group)
    expect(parseFailures).toBe(2)
    expect(results[1].score.reasoning).toBe('Parse-Fehler')
    expect(results[1].score.synthesisScore).toBe(3)
  })
})

describe('buildBatchScoringPrompt', () => {
  it('nutzt bis zu 1500 Zeichen Snippet und den kalibrierten Kriterienkatalog', () => {
    const longBody = 'q'.repeat(2000)
    const prompt = buildBatchScoringPrompt([{ id: '1', title: 'OpenAI Release', content: longBody }])
    expect(prompt).toContain('HARTE JUNK-KAPPUNG')
    expect(prompt).toContain('KI im Kern')
    expect(prompt).toContain('Big Player')
    // Title (14) + \n\n (2) + body capped to 1500 chars total per item
    expect(prompt.match(/q{100,}/g)?.[0].length).toBe(1500 - 'OpenAI Release\n\n'.length)
  })
})
