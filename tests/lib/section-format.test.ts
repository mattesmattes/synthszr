import { describe, it, expect } from 'vitest'
import { joinCompanyTagToSummary } from '@/lib/claude/section-format'

describe('joinCompanyTagToSummary', () => {
  it('appends the company-tag/source line to the preceding paragraph (no blank line before it)', () => {
    const input = [
      '## Überschrift',
      '',
      'Zusammenfassung ... Opus-Modelle dominieren.',
      '',
      '{Anthropic} {OpenAI} {Ramp} → AI Weekly',
      '',
      'Synthszr Take: Ein Regierungsbann als Gütesiegel.',
    ].join('\n')

    const out = joinCompanyTagToSummary(input)

    expect(out).toContain('dominieren. {Anthropic} {OpenAI} {Ramp} → AI Weekly')
    // the blank line before the Synthszr Take must remain
    expect(out).toContain('→ AI Weekly\n\nSynthszr Take:')
    // no standalone tag paragraph (blank line directly before the tag) remains
    expect(out).not.toMatch(/\n\n\{Anthropic\}/)
  })

  it('handles a tags-only line (no source arrow)', () => {
    const input = 'Text endet hier.\n\n{OpenAI} {Anthropic}\n\nSynthszr Take: ...'
    const out = joinCompanyTagToSummary(input)
    expect(out).toContain('Text endet hier. {OpenAI} {Anthropic}')
  })

  it('leaves content without a company-tag line unchanged', () => {
    const input = '## Heading\n\nNur Fließtext ohne Tags.\n\nSynthszr Take: ...'
    expect(joinCompanyTagToSummary(input)).toBe(input)
  })

  it('only joins the company-tag line, not other paragraphs', () => {
    const input = 'Absatz eins.\n\nAbsatz zwei.\n\n{Tesla} → Quelle\n\nSynthszr Take: ...'
    const out = joinCompanyTagToSummary(input)
    expect(out).toContain('Absatz eins.\n\nAbsatz zwei. {Tesla} → Quelle')
  })

  it('collapses multiple blank lines before the tag line', () => {
    const input = 'Ende.\n\n\n{Nvidia} → Quelle\n\nSynthszr Take: ...'
    const out = joinCompanyTagToSummary(input)
    expect(out).toContain('Ende. {Nvidia} → Quelle')
  })
})
