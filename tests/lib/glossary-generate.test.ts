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

describe('normalizeSlugForDedup', () => {
  it('entfernt Bindestriche', async () => {
    const { normalizeSlugForDedup } = await import('@/lib/glossary/generate')
    expect(normalizeSlugForDedup('pre-training')).toBe('pretraining')
  })

  it('entfernt genau einen End-"s"', async () => {
    const { normalizeSlugForDedup } = await import('@/lib/glossary/generate')
    expect(normalizeSlugForDedup('evals')).toBe('eval')
    // Nur EINEN End-"s", kein rekursives Strippen.
    expect(normalizeSlugForDedup('kubernetes')).toBe('kubernete')
  })

  it('fasst die vier in Prod gefundenen Dubletten-Paare zusammen (2026-08-06)', async () => {
    const { normalizeSlugForDedup } = await import('@/lib/glossary/generate')
    const pairs: Array<[string, string]> = [
      ['eval', 'evals'],
      ['leveraged-etf', 'leveraged-etfs'],
      ['pre-training', 'pretraining'],
      ['time-series-foundation-model', 'time-series-foundation-models'],
    ]
    for (const [a, b] of pairs) {
      expect(normalizeSlugForDedup(a)).toBe(normalizeSlugForDedup(b))
    }
  })

  it('wirft inhaltlich verschiedene Begriffe nicht zusammen, an den echten Daten geprueft', async () => {
    // Snapshot aller 471 am 2026-08-06 veroeffentlichten Slugs (Prod). Wenn diese
    // Regel jemals zu aggressiv wird, faellt es hier auf - nicht erst am naechsten
    // False-Positive in Prod. Die vier Paare oben sind die EINZIGEN Kollisionen in
    // diesem Bestand; alle anderen 463 Slugs bleiben nach der Normalisierung
    // eindeutig.
    const { normalizeSlugForDedup } = await import('@/lib/glossary/generate')
    const slugs = (await import('../fixtures/glossary-slugs-2026-08-06.json')).default as string[]
    expect(slugs.length).toBe(471)

    const groups = new Map<string, string[]>()
    for (const slug of slugs) {
      const key = normalizeSlugForDedup(slug)
      const g = groups.get(key) ?? []
      g.push(slug)
      groups.set(key, g)
    }
    const collisions = [...groups.values()].filter((g) => g.length > 1)
    expect(collisions.sort()).toEqual([
      ['eval', 'evals'],
      ['leveraged-etf', 'leveraged-etfs'],
      ['pre-training', 'pretraining'],
      ['time-series-foundation-model', 'time-series-foundation-models'],
    ])
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

/**
 * Hängt Füllwörter an einen Absatz, damit die Fixture die von Regel 4 verlangten
 * 400 Wörter erreicht.
 *
 * Nötig, seit generateTermContent die Länge DURCHSETZT (Nachforderung, dann
 * Abbruch — 2026-08-04): eine Fixture unter der Grenze löst den Retry-Pfad aus,
 * und jeder Test würde dann etwas anderes prüfen als seinen Gegenstand. Der
 * Füllsatz hält die Fixture lesbar, statt 400 Wörter Beispielprosa zu erfinden;
 * die inhaltlich tragenden ersten Sätze bleiben unverändert vorne.
 */
function pad(text: string): string {
  return `${text} ${Array.from({ length: 110 }, (_, i) => `Füllwort${i}`).join(' ')}`
}

describe('generateTermContent', () => {
  // Volle Rule-3-Struktur (Intro-Absatz + drei Heading/Paragraph-Paare = 7
  // Blocks), nicht nur die für .min(4) nötige Mindestmenge — die Fixture soll
  // eine plausible Modellantwort simulieren, nicht nur knapp am Schema vorbei.
  const contentInput = {
    canonical_name: 'Mixture of Experts',
    aliases: ['MoE', 'Mixture-of-Experts', 'Mixture of Experts'],
    summary: 'Ein Ansatz, bei dem pro Anfrage nur ein Teil eines Modells rechnet.',
    blocks: [
      { type: 'paragraph', text: pad('Stell dir eine Redaktion vor, in der nur zwei Leute pro Frage recherchieren.') },
      { type: 'heading', text: 'Warum das wichtig ist' },
      { type: 'paragraph', text: pad('So bleiben auch sehr große Modelle im Betrieb bezahlbar.') },
      { type: 'heading', text: 'Wie die Auswahl funktioniert' },
      { type: 'paragraph', text: pad('Ein kleines Zusatznetz, der Router, entscheidet, welche Experten zuständig sind.') },
      { type: 'heading', text: 'Wo man dem Begriff begegnet' },
      { type: 'paragraph', text: pad('Viele aktuelle Sprachmodelle großer Anbieter nutzen dieses Prinzip.') },
    ],
    needs_illustration: true,
    illustration_alt: 'Schema eines Routers, der Anfragen an einzelne Experten verteilt',
  }
  const readabilityInput = { readability_score: 88, reasoning: 'kurze Sätze, klare Struktur' }

  it('verbietet im Prompt die Schablonen-Überschriften', async () => {
    // Prod-Befund 2026-08-04: "Warum das wichtig ist" / "Wie es funktioniert" /
    // "Wo man dem Begriff begegnet" standen WORTGLEICH über api-gateway und cuda.
    // Ursache war Regel 3: sie nennt Leitfragen, und das Modell übernahm sie als
    // Überschrift. Regel 3a trennt jetzt Inhaltsvorgabe von Formulierung.
    // Vertragstest auf den Prompt — die Wirkung selbst zeigt sich erst am
    // nächsten generierten Begriff und ist nicht deterministisch prüfbar.
    mocks.create
      .mockResolvedValueOnce(toolUse(contentInput))
      .mockResolvedValueOnce(toolUse(readabilityInput))
    const { generateTermContent } = await import('@/lib/glossary/generate')
    await generateTermContent('Mixture of Experts')
    const system = JSON.stringify(mocks.create.mock.calls[0][0].system)
    expect(system).toContain('Wie es funktioniert')       // als Verbot genannt
    expect(system).toContain('darf auf keinen anderen Eintrag passen')
    expect(system).toContain('NIE dieselbe Überschrift')
  })

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

  it('erzwingt illustrationAlt=null bei needs_illustration=false, auch wenn das Modell trotzdem einen Alt-Text liefert', async () => {
    // Scharfer Test: illustration_alt ist NICHT leer, needs_illustration ist
    // false. Nur wenn der Code bei false wirklich hart auf null zwingt (statt
    // nur durchzureichen, was das Modell schickt), kommt hier null heraus.
    mocks.create
      .mockResolvedValueOnce(
        toolUse({ ...contentInput, needs_illustration: false, illustration_alt: 'ein nicht leerer Alt-Text' }),
      )
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

  it('wirft bei einer degenerierten Antwort (leerer Name, leere blocks) statt ein leeres Dokument zu bauen', async () => {
    mocks.create.mockResolvedValueOnce(
      toolUse({ ...contentInput, canonical_name: '', blocks: [] }),
    )
    const { generateTermContent } = await import('@/lib/glossary/generate')
    await expect(generateTermContent('Foo')).rejects.toThrow()
  })

  it('wirft bei reinem Whitespace-canonical_name (besteht die Roh-Längenprüfung, ist aber nach trim() leer)', async () => {
    mocks.create.mockResolvedValueOnce(toolUse({ ...contentInput, canonical_name: '   ' }))
    const { generateTermContent } = await import('@/lib/glossary/generate')
    await expect(generateTermContent('Foo')).rejects.toThrow()
  })
})

/**
 * Durchsetzung von Regel 4 (400–700 Wörter). Bis 2026-08-04 war die Regel im
 * Prompt formuliert, aber nichts prüfte sie: ein Prod-Eintrag hatte ~150 Wörter.
 *
 * Zwei Ursachen, beide behoben:
 *  - max_tokens 4096 OHNE `thinking`-Feld. Opus 5 denkt per Default, wenn das
 *    Feld fehlt, und max_tokens deckt Thinking UND Text gemeinsam ab — das
 *    Reasoning fraß das Budget, der Text wurde abgeschnitten. (Derselbe
 *    Fehlermodus wie im Ghostwriter, dort schon gefixt.)
 *  - Keine Nachforderung bei zu kurzer Antwort.
 *
 * Muster für die Nachforderung ist enforceHeadingLength im Ghostwriter:
 * deterministisch angestoßen, nur wenn die Grenze verletzt ist.
 */
describe('generateTermContent — Längendurchsetzung (Regel 4)', () => {
  const longBlocks = (wordsPerParagraph: number) => {
    const filler = Array.from({ length: wordsPerParagraph }, (_, i) => `Wort${i}`).join(' ')
    return [
      { type: 'paragraph', text: filler },
      { type: 'heading', text: 'Ein konkreter Aspekt' },
      { type: 'paragraph', text: filler },
      { type: 'heading', text: 'Ein zweiter Aspekt' },
      { type: 'paragraph', text: filler },
      { type: 'heading', text: 'Ein dritter Aspekt' },
      { type: 'paragraph', text: filler },
    ]
  }
  const base = {
    canonical_name: 'Mixture of Experts',
    aliases: ['MoE'],
    summary: 'Kurz erklärt.',
    needs_illustration: false,
    illustration_alt: '',
  }
  const readability = { readability_score: 88, reasoning: 'ok' }

  it('schaltet Thinking ab und gibt Platz für 700 Wörter', async () => {
    mocks.create
      .mockResolvedValueOnce(toolUse({ ...base, blocks: longBlocks(120) }))
      .mockResolvedValueOnce(toolUse(readability))
    const { generateTermContent } = await import('@/lib/glossary/generate')
    await generateTermContent('Mixture of Experts')
    const params = mocks.create.mock.calls[0][0]
    expect(params.thinking).toEqual({ type: 'disabled' })
    expect(params.max_tokens).toBeGreaterThanOrEqual(8192)
  })

  it('fordert nach, wenn die Antwort unter 400 Wörtern bleibt', async () => {
    mocks.create
      .mockResolvedValueOnce(toolUse({ ...base, blocks: longBlocks(10) }))   // ~40 Wörter
      .mockResolvedValueOnce(toolUse({ ...base, blocks: longBlocks(120) }))  // Nachforderung
      .mockResolvedValueOnce(toolUse(readability))
    const { generateTermContent } = await import('@/lib/glossary/generate')
    const t = await generateTermContent('Mixture of Experts')
    // Drei Calls: Erstversuch, Nachforderung, Lesbarkeits-Urteil.
    expect(mocks.create).toHaveBeenCalledTimes(3)
    // Die Nachforderung muss die gemessene Kürze benennen, sonst schreibt das
    // Modell dieselbe Länge erneut.
    expect(JSON.stringify(mocks.create.mock.calls[1][0].messages)).toMatch(/zu kurz|400/)
    expect(JSON.stringify(t.body)).toContain('Wort119')
  })

  it('fordert NICHT nach, wenn die Antwort lang genug ist', async () => {
    mocks.create
      .mockResolvedValueOnce(toolUse({ ...base, blocks: longBlocks(120) }))
      .mockResolvedValueOnce(toolUse(readability))
    const { generateTermContent } = await import('@/lib/glossary/generate')
    await generateTermContent('Mixture of Experts')
    expect(mocks.create).toHaveBeenCalledTimes(2)
  })

  it('wirft, wenn der Eintrag auch nach der Nachforderung zu kurz bleibt', async () => {
    // Regel 4 GILT: ein dauerhaft zu dünner Eintrag wird nicht angelegt. Der
    // Aufrufer (generateAndInsertDraft) fängt den Wurf und liefert null, der
    // Kandidat bleibt für einen späteren Versuch vorgemerkt.
    mocks.create
      .mockResolvedValueOnce(toolUse({ ...base, blocks: longBlocks(10) }))
      .mockResolvedValueOnce(toolUse({ ...base, blocks: longBlocks(12) }))
    const { generateTermContent } = await import('@/lib/glossary/generate')
    await expect(generateTermContent('Mixture of Experts')).rejects.toThrow(/zu kurz|400/)
  })
})
