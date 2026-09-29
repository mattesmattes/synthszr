import { describe, it, expect } from 'vitest'
import { FEATURE_NAMES, JEV_FEATURE_NAMES, TASTE_QUESTIONS } from '@/lib/news-taste/questions'
import { buildTasteState, answersToVector, extraFeatures } from '@/lib/news-taste/features'
import type { EvaluateAnswer } from '@/lib/ai/evaluate'

describe('buildTasteState', () => {
  it('baut State aus Titel, Quelle und Text', () => {
    const s = buildTasteState({ title: 'GPT-6 launched', source: 'Techmeme', text: 'OpenAI shipped…' })
    expect(s).toContain('TITLE: GPT-6 launched')
    expect(s).toContain('SOURCE: Techmeme')
    expect(s).toContain('TEXT: OpenAI shipped…')
  })
  it('crasht nicht bei fehlender Quelle und leerem Text (Review Focus 1)', () => {
    const s = buildTasteState({ title: 'Nur Titel', source: null, text: null })
    expect(s).toContain('TITLE: Nur Titel')
    expect(s).not.toContain('null')
  })
  it('kürzt den Text auf 1500 Zeichen', () => {
    const s = buildTasteState({ title: 't', source: null, text: 'x'.repeat(5000) })
    expect(s.length).toBeLessThan(1700)
  })
})

describe('answersToVector', () => {
  const answers: Record<string, EvaluateAnswer> = {
    concrete_event: { type: 'boolean', probability: 0.9 },
    importance: { type: 'score', score: 3, probabilities: [0, 0, 0.2, 0.6, 0.2] },
    story_type: { type: 'choice', choice: 'launch', probabilities: { launch: 0.8, finance: 0.2 } },
  }
  it('mappt boolean → probability, score → normierter Wert + Streuung, choice → soft one-hot', () => {
    const v = answersToVector(answers)
    expect(v.concrete_event).toBeCloseTo(0.9)
    expect(v.importance).toBeCloseTo(3 / 4) // 5 Stufen → Skala 0..4
    expect(v.importance_spread).toBeGreaterThan(0)
    expect(v.story_launch).toBeCloseTo(0.8)
    expect(v.story_finance).toBeCloseTo(0.2)
    expect(v.story_other).toBe(0)
  })
  it('fehlende Antworten und unbekannte Optionen → 0, nie NaN (Review Focus 2)', () => {
    const v = answersToVector({ story_type: { type: 'choice', choice: 'weird', probabilities: { weird: 1 } } })
    for (const name of JEV_FEATURE_NAMES) {
      expect(Number.isFinite(v[name]), `${name} ist ${v[name]}`).toBe(true)
    }
    expect(v.concrete_event).toBe(0)
    expect(v.story_launch).toBe(0)
  })
  it('liefert exakt die JEV_FEATURE_NAMES als Schlüssel', () => {
    const v = answersToVector(answers)
    expect(Object.keys(v).sort()).toEqual([...JEV_FEATURE_NAMES].sort())
  })
  // Zusätzlicher Test für live Record-shaped Score answer
  it('behandelt Record-shaped Score-Wahrscheinlichkeiten korrekt (live format)', () => {
    const liveAnswers: Record<string, EvaluateAnswer> = {
      importance: {
        type: 'score',
        score: 3.73,
        probabilities: { '0': 0, '1': 0, '2': 0.01, '3': 0.23, '4': 0.76 },
      } as EvaluateAnswer,
    }
    const v = answersToVector(liveAnswers)
    expect(v.importance).toBeCloseTo(3.73 / 4, 2)
    expect(v.importance_spread).toBeGreaterThan(0)
    expect(Number.isFinite(v.importance_spread)).toBe(true)
  })
})

describe('Katalog-Konsistenz', () => {
  it('FEATURE_NAMES = Jev-Features + Extras, ohne Duplikate', () => {
    expect(new Set(FEATURE_NAMES).size).toBe(FEATURE_NAMES.length)
    expect(FEATURE_NAMES.length).toBeGreaterThanOrEqual(35)
  })
  it('jede Boolean-Frage hat criteria (kalibrierte Ja/Nein-Definition)', () => {
    for (const [name, q] of Object.entries(TASTE_QUESTIONS)) {
      if (q.type === 'boolean') expect(q.criteria, name).toBeDefined()
    }
  })
})

describe('extraFeatures', () => {
  it('liefert die Zusatzsignale mit log-skalierter Länge', () => {
    const v = extraFeatures({
      queueItemId: 'x',
      title: 't',
      source: null,
      text: null,
      synthesis: 7,
      relevance: 8,
      uniqueness: 6,
      sourceBonus: 1,
      sourcePubRate: 0.3,
      contentLength: 3000,
    })
    expect(v.synthesis_score).toBe(7)
    expect(v.relevance_score).toBe(8)
    expect(v.uniqueness_score).toBe(6)
    expect(v.source_bonus).toBe(1)
    expect(v.source_pub_rate).toBe(0.3)
    expect(v.log_content_length).toBeCloseTo(Math.log10(3001))
  })
})
