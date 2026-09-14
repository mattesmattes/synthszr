import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  buildMentionContextPrompt,
  parseMentionContextDecision,
  filterMentionsByContext,
} from '@/lib/glossary/mention-context-qa'

describe('parseMentionContextDecision', () => {
  it('parst eine gültige Tool-Antwort', () => {
    expect(parseMentionContextDecision({ is_relevant: false, confidence: 0.9, reasoning: 'Alltagswort' }))
      .toEqual({ isRelevant: false, confidence: 0.9, reasoning: 'Alltagswort' })
  })
  it('null bei ungültiger/fehlender Antwort', () => {
    expect(parseMentionContextDecision(null)).toBeNull()
    expect(parseMentionContextDecision({ is_relevant: 'no' })).toBeNull()
    expect(parseMentionContextDecision({ is_relevant: true, confidence: 2, reasoning: 'x' })).toBeNull() // conf > 1
    expect(parseMentionContextDecision({ is_relevant: true, confidence: 0.5 })).toBeNull() // reasoning fehlt
  })
})

describe('buildMentionContextPrompt', () => {
  it('enthält Namen, Definition, Textstelle und das Ausgabefeld', () => {
    const p = buildMentionContextPrompt({
      slug: 'trainingsumgebung', name: 'Environment',
      summary: 'Die Simulation, in der ein RL-Agent trainiert wird.',
      excerpt: 'Die Environmental Protection Network warnte.',
    })
    expect(p).toContain('Environment')
    expect(p).toContain('Die Simulation, in der ein RL-Agent trainiert wird.')
    expect(p).toContain('Environmental Protection Network')
    expect(p).toContain('is_relevant')
  })
})

describe('filterMentionsByContext', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('lässt ohne ANTHROPIC_API_KEY alle Kandidaten durch (fail-open)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const approved = await filterMentionsByContext([
      { slug: 'a', name: 'A', summary: 'x', excerpt: 'y' },
      { slug: 'b', name: 'B', summary: 'x', excerpt: 'y' },
    ])
    expect(approved).toEqual(new Set(['a', 'b']))
  })

  it('liefert eine leere Menge ohne Kandidaten', async () => {
    expect(await filterMentionsByContext([])).toEqual(new Set())
  })
})
