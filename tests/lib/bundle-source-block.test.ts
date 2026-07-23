import { describe, expect, it } from 'vitest'
import { sourceShortName, buildBundleSourceBlock } from '@/lib/claude/ghostwriter-pipeline'
import type { PipelineItem } from '@/lib/claude/ghostwriter-pipeline'

const item = (over: Partial<PipelineItem>): PipelineItem => ({
  id: 'x', title: 't', content: 'c', source_display_name: null, source_url: null,
  source_identifier: 'src', ...over,
} as PipelineItem)

describe('sourceShortName', () => {
  it('kürzt Domains auf den Second-Level ohne www./TLD', () => {
    expect(sourceShortName(item({ source_url: 'https://www.reuters.com/tech/x' }))).toBe('reuters')
    expect(sourceShortName(item({ source_url: 'https://techcrunch.com/2026/x' }))).toBe('techcrunch')
    expect(sourceShortName(item({ source_url: 'https://news.ycombinator.com/item?id=1' }))).toBe('ycombinator')
  })
  it('kürzt einen domain-artigen Display-Namen ebenfalls', () => {
    expect(sourceShortName(item({ source_display_name: 'www.businessinsider.com' }))).toBe('businessinsider')
  })
  it('lässt echte Anzeigenamen unverändert', () => {
    expect(sourceShortName(item({ source_display_name: 'The Information' }))).toBe('The Information')
  })
})

describe('buildBundleSourceBlock', () => {
  it('stellt alle Quellen als kommagetrennte Kurznamen in EINER Zeile dar', () => {
    const primary = item({ source_url: 'https://www.reuters.com/a', source_identifier: 'reuters' })
    const sec = [
      item({ source_url: 'https://www.businessinsider.com/b', source_identifier: 'bi' }),
      item({ source_url: 'https://techcrunch.com/c', source_identifier: 'tc' }),
    ]
    const out = buildBundleSourceBlock(['{Anthropic}', '{Nvidia}', '{OpenAI}'], primary, sec)
    // Eine Zeile, kein "Auch:", Kurznamen als Links
    expect(out).not.toContain('Auch:')
    expect(out).not.toContain('\n')
    expect(out).toBe('{Anthropic} {Nvidia} {OpenAI} → [reuters](https://www.reuters.com/a), [businessinsider](https://www.businessinsider.com/b), [techcrunch](https://techcrunch.com/c)')
  })
})
