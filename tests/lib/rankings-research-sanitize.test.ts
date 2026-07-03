import { describe, it, expect } from 'vitest'
import { parseResearchResponse } from '@/lib/rankings/research'

describe('parseResearchResponse — Tool-Call-Leak-Guard', () => {
  it('kappt geleaktes </description>/<parameter>-Markup aus der Description', () => {
    const res = parseResearchResponse(
      {
        description: 'Ein KI-Modell für Coding.</description> <parameter name="description_en">An AI model',
        description_en: 'An AI coding model.',
        features: [],
      },
      new Set(),
    )
    expect(res.description).toBe('Ein KI-Modell für Coding.')
    expect(res.descriptionEn).toBe('An AI coding model.')
  })

  it('kappt Leak in Feature-Values', () => {
    const res = parseResearchResponse(
      {
        description: 'x',
        description_en: 'y',
        features: [{ dimension: 'Preis', value: '10 $/Monat</description><parameter name="x">Rest', source_url: 'https://example.com' }],
      },
      new Set(['Preis']),
    )
    expect(res.features[0].value).toBe('10 $/Monat')
  })

  it('lässt saubere Texte mit <cite> weiterhin korrekt durch', () => {
    const res = parseResearchResponse(
      { description: 'Text <cite index="1">Quelle</cite> Ende.', description_en: 'x', features: [] },
      new Set(),
    )
    expect(res.description).toBe('Text Quelle Ende.')
  })
})
