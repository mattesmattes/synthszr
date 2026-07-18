import { describe, expect, it } from 'vitest'
import { capSummarySentences, shortenByOneSentence } from '@/lib/claude/bundle-length'

const S = (summary: string, take: string) => `## H\n\n${summary}\n\nSynthszr Take: ${take}`

describe('capSummarySentences', () => {
  it('kürzt Zusammenfassung >18 Sätze auf 18, Take unberührt', () => {
    const summary = Array.from({ length: 22 }, (_, i) => `Satz ${i + 1}.`).join(' ')
    const out = capSummarySentences(S(summary, 'Take-Satz eins. Take-Satz zwei.'), 18)
    expect(out).toContain('Satz 18.')
    expect(out).not.toContain('Satz 19.')
    expect(out).toContain('Take-Satz zwei.') // Take bleibt vollständig
  })
  it('lässt ≤18 Sätze unverändert', () => {
    const summary = 'Ein Satz. Zwei Sätze.'
    expect(capSummarySentences(S(summary, 'T.'), 18)).toContain('Zwei Sätze.')
  })
  it('lässt die Heading-Zeile beim getriggerten Cut als eigene Zeile intakt', () => {
    const summary = Array.from({ length: 22 }, (_, i) => `Satz ${i + 1}.`).join(' ')
    const out = capSummarySentences(S(summary, 'Take eins. Take zwei.'), 18)
    expect(out).toMatch(/^## H\n\n/) // Heading bleibt eigene Zeile
    expect(out).not.toContain('## H Satz 1.') // nicht in den Text gemerged
    expect(out).toContain('Satz 18.')
    expect(out).not.toContain('Satz 19.')
  })
})

describe('shortenByOneSentence', () => {
  it('entfernt je einen Satz aus Zusammenfassung UND Take', () => {
    const out = shortenByOneSentence(S('A. B. C.', 'X. Y.'))
    expect(out).toContain('A. B.'); expect(out).not.toMatch(/\bC\.\B/)
    expect(out).toContain('X.'); expect(out).not.toContain('Y.')
  })

  it('droppt einen echten Satz statt der Company-Tag-/Quellen-Zeile (joinCompanyTagToSummary-Fall)', () => {
    // So sieht eine NORMALE Section aus, NACHDEM joinCompanyTagToSummary die
    // Tag-/Quellen-Zeile an den letzten Satz angehängt hat. splitSentences
    // isoliert diese Zeile als letztes "Satz"-Element (Punkt vor "{" ist ein
    // Satzende) — dropLast darf sie NICHT löschen, sonst verschwinden
    // {Company}-Vote-Direktiven + Quelle aus jedem normalen Artikel.
    const summary = 'Erster Satz. Zweiter Satz. Letzter echter Satz. {Anthropic} {OpenAI} → [Quelle](https://example.com)'
    const out = shortenByOneSentence(S(summary, 'X. Y.'))
    expect(out).toContain('{Anthropic} {OpenAI} → [Quelle](https://example.com)') // Attribution überlebt
    expect(out).toContain('Erster Satz.')
    expect(out).toContain('Zweiter Satz.')
    expect(out).not.toContain('Letzter echter Satz.') // ein ECHTER Satz wurde gekürzt
  })
})
