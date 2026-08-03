/**
 * Begriffs-Generator (Task 8): identifyCandidates + generateTermContent.
 * Anthropic-SDK gemockt (Muster aus tests/lib/translation-attr-preservation.test.ts)
 * — keine Live-Calls. getModelForUseCase gemockt, damit kein echter DB-Zugriff
 * über model-config.ts passiert (Muster: tests/lib/ranking-modelconfig.test.ts
 * testet nur die reinen Definitionen, nie den DB-Pfad selbst).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mocks.create }
  },
}))

vi.mock('@/lib/ai/model-config', () => ({
  getModelForUseCase: vi.fn(async () => 'claude-opus-5'),
}))

function toolUse(input: unknown) {
  return { content: [{ type: 'tool_use', input }] }
}

beforeEach(() => {
  mocks.create.mockReset()
})

describe('slugify', () => {
  it('erzeugt URL-safe ASCII-Slugs', async () => {
    const { slugify } = await import('@/lib/glossary/generate')
    expect(slugify('Mixture of Experts')).toBe('mixture-of-experts')
    expect(slugify('Retrieval-Augmented Generation (RAG)')).toMatch(/^[a-z0-9-]+$/)
  })

  it('transliteriert Umlaute statt sie zu entfernen', async () => {
    const { slugify } = await import('@/lib/glossary/generate')
    // Naives Diacritics-Stripping würde "Prädiktion" -> "pradiktion" machen
    // (falsch im Deutschen). Korrekt ist die Transliteration "ae".
    expect(slugify('Prädiktion')).toBe('praediktion')
    expect(slugify('Über-Fitting')).toBe('ueber-fitting')
    expect(slugify('Straße')).toBe('strasse')
  })

  it('normalisiert Mehrfach-Leerzeichen/-Bindestriche und Ränder', async () => {
    const { slugify } = await import('@/lib/glossary/generate')
    expect(slugify('  Foo   Bar--Baz  ')).toBe('foo-bar-baz')
  })
})

describe('identifyCandidates', () => {
  it('schlägt neue Begriffe aus dem Artikeltext vor', async () => {
    mocks.create.mockResolvedValueOnce(toolUse({ candidates: ['Retrieval-Augmented Generation'] }))
    const { identifyCandidates } = await import('@/lib/glossary/generate')
    const result = await identifyCandidates('Der Artikel erklärt RAG im Detail.', [])
    expect(result).toEqual(['Retrieval-Augmented Generation'])
  })

  it('schlägt bereits im Glossar bekannte Begriffe nicht erneut vor', async () => {
    mocks.create.mockResolvedValueOnce(toolUse({ candidates: ['Inferenz', 'Mixture of Experts'] }))
    const { identifyCandidates } = await import('@/lib/glossary/generate')
    const result = await identifyCandidates('Text über Inferenz und Mixture of Experts.', ['inferenz'])
    expect(result).toEqual(['Mixture of Experts'])
  })

  it('dedupliziert Kandidaten, die auf denselben Slug führen', async () => {
    mocks.create.mockResolvedValueOnce(
      toolUse({ candidates: ['Mixture of Experts', 'mixture of experts'] }),
    )
    const { identifyCandidates } = await import('@/lib/glossary/generate')
    const result = await identifyCandidates('...', [])
    expect(result).toEqual(['Mixture of Experts'])
  })

  it('liefert eine leere Liste bei fehlender/ungültiger Tool-Antwort', async () => {
    mocks.create.mockResolvedValueOnce({ content: [] })
    const { identifyCandidates } = await import('@/lib/glossary/generate')
    const result = await identifyCandidates('Text', [])
    expect(result).toEqual([])
  })

  it('degradiert auf eine leere Liste, wenn der Call wirft', async () => {
    mocks.create.mockRejectedValueOnce(new Error('boom'))
    const { identifyCandidates } = await import('@/lib/glossary/generate')
    const result = await identifyCandidates('Text', [])
    expect(result).toEqual([])
  })
})

describe('generateTermContent', () => {
  const contentInput = {
    canonical_name: 'Mixture of Experts',
    aliases: ['MoE', 'Mixture-of-Experts', 'Mixture of Experts'],
    summary: 'Ein Ansatz, bei dem pro Anfrage nur ein Teil eines Modells rechnet.',
    blocks: [
      { type: 'paragraph', text: 'Stell dir eine Redaktion vor, in der nur zwei Leute pro Frage recherchieren.' },
      { type: 'heading', text: 'Wie die Auswahl funktioniert' },
      { type: 'paragraph', text: 'Ein kleines Zusatznetz, der Router, entscheidet, welche Experten zuständig sind.' },
    ],
    needs_illustration: true,
    illustration_alt: 'Schema eines Routers, der Anfragen an einzelne Experten verteilt',
  }
  const readabilityInput = { readability_score: 88, reasoning: 'kurze Sätze, klare Struktur' }

  it('slugifiziert den Begriffsnamen URL-safe', async () => {
    mocks.create
      .mockResolvedValueOnce(toolUse(contentInput))
      .mockResolvedValueOnce(toolUse(readabilityInput))
    const { generateTermContent } = await import('@/lib/glossary/generate')
    const t = await generateTermContent('Mixture of Experts')
    expect(t.slug).toMatch(/^[a-z0-9-]+$/)
    expect(t.slug).toBe('mixture-of-experts')
  })

  it('nimmt den kanonischen Namen nicht doppelt in aliases auf', async () => {
    mocks.create
      .mockResolvedValueOnce(toolUse(contentInput))
      .mockResolvedValueOnce(toolUse(readabilityInput))
    const { generateTermContent } = await import('@/lib/glossary/generate')
    const t = await generateTermContent('Mixture of Experts')
    expect(t.aliases.map((a) => a.toLowerCase())).not.toContain('mixture of experts')
    expect(t.aliases).toEqual(['MoE', 'Mixture-of-Experts'])
  })

  it('baut ein strukturell valides TipTap-Dokument aus den Blocks', async () => {
    mocks.create
      .mockResolvedValueOnce(toolUse(contentInput))
      .mockResolvedValueOnce(toolUse(readabilityInput))
    const { generateTermContent } = await import('@/lib/glossary/generate')
    const t = await generateTermContent('Mixture of Experts')
    expect(t.body.type).toBe('doc')
    expect(Array.isArray(t.body.content)).toBe(true)
    expect(t.body.content.length).toBeGreaterThan(0)
    for (const node of t.body.content) {
      expect(['paragraph', 'heading']).toContain(node.type)
      expect(Array.isArray(node.content)).toBe(true)
      expect(node.content[0].type).toBe('text')
      expect(typeof node.content[0].text).toBe('string')
      expect(node.content[0].text.length).toBeGreaterThan(0)
    }
    const heading = t.body.content.find((n) => n.type === 'heading')
    expect(heading?.attrs?.level).toBe(2)
  })

  it('übernimmt den readability_score aus dem zweiten Call', async () => {
    mocks.create
      .mockResolvedValueOnce(toolUse(contentInput))
      .mockResolvedValueOnce(toolUse(readabilityInput))
    const { generateTermContent } = await import('@/lib/glossary/generate')
    const t = await generateTermContent('Mixture of Experts')
    expect(t.readabilityScore).toBe(88)
  })

  it('setzt needsIllustration/illustrationAlt aus der Tool-Antwort um (false-Fall)', async () => {
    mocks.create
      .mockResolvedValueOnce(toolUse({ ...contentInput, needs_illustration: false, illustration_alt: null }))
      .mockResolvedValueOnce(toolUse(readabilityInput))
    const { generateTermContent } = await import('@/lib/glossary/generate')
    const t = await generateTermContent('Compliance')
    expect(t.needsIllustration).toBe(false)
    expect(t.illustrationAlt).toBeNull()
  })

  it('degradiert auf readabilityScore=null, wenn der zweite Call fehlschlägt', async () => {
    mocks.create
      .mockResolvedValueOnce(toolUse(contentInput))
      .mockRejectedValueOnce(new Error('boom'))
    const { generateTermContent } = await import('@/lib/glossary/generate')
    const t = await generateTermContent('Mixture of Experts')
    expect(t.readabilityScore).toBeNull()
    expect(t.slug).toBe('mixture-of-experts')
  })

  it('wirft, wenn die erste Tool-Antwort ungültig/fehlend ist', async () => {
    mocks.create.mockResolvedValueOnce({ content: [] })
    const { generateTermContent } = await import('@/lib/glossary/generate')
    await expect(generateTermContent('Foo')).rejects.toThrow()
  })
})
