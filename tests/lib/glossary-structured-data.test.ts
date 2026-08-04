/**
 * SEO/GEO-Signale der Lexikonseiten: Kurz-Description und strukturierte Daten.
 *
 * Beides an Prod gemessen entstanden (2026-08-04, /en/glossary/cuda):
 *   - Die Meta-Description war 280 Zeichen lang, weil das volle summary
 *     durchgereicht wurde. Google schneidet bei ~155 ab, die SERP-Zeile endete
 *     also mitten im Satz.
 *   - Es gab weder dateModified noch BreadcrumbList.
 */
import { describe, expect, it } from 'vitest'
import { shortenForMeta } from '@/lib/seo/meta-description'
import { buildGlossaryJsonLd } from '@/lib/glossary/structured-data'

describe('shortenForMeta', () => {
  it('lässt kurze Texte unangetastet', () => {
    expect(shortenForMeta('Kurz und gut.')).toBe('Kurz und gut.')
  })

  it('kürzt auf höchstens 155 Zeichen', () => {
    const long = 'Wort '.repeat(60)
    expect(shortenForMeta(long).length).toBeLessThanOrEqual(155)
  })

  it('bricht an einer WORTGRENZE ab, nicht mitten im Wort', () => {
    // Ein abgeschnittenes Wort in der SERP-Zeile liest sich wie ein Fehler.
    const text = `${'a'.repeat(150)} Donaudampfschifffahrtsgesellschaft`
    const out = shortenForMeta(text)
    expect(out).not.toMatch(/Donau/)
  })

  it('endet mit einem Auslassungszeichen, wenn gekürzt wurde', () => {
    expect(shortenForMeta('Wort '.repeat(60))).toMatch(/…$/)
  })

  it('setzt KEIN Auslassungszeichen, wenn nichts gekürzt wurde', () => {
    expect(shortenForMeta('Kurz.')).not.toMatch(/…/)
  })

  it('bricht bevorzugt am SATZENDE ab, wenn eines im Fenster liegt', () => {
    // Ein vollständiger Satz liest sich in der SERP besser als ein Fragment mit
    // Auslassungszeichen — und Google zeigt ihn dann ohne eigenen Beschnitt.
    const text = 'CUDA ist eine Software-Sammlung von Nvidia. Weil fast alle '
      + 'KI-Programme darauf aufbauen, gilt CUDA als wichtigster Grund für die '
      + 'Vormachtstellung des Unternehmens im KI-Geschäft und darüber hinaus.'
    const out = shortenForMeta(text)
    expect(out).toBe('CUDA ist eine Software-Sammlung von Nvidia.')
  })

  it('verkraftet leeren Text', () => {
    expect(shortenForMeta('')).toBe('')
  })
})

describe('buildGlossaryJsonLd', () => {
  const base = {
    name: 'CUDA',
    summary: 'CUDA ist eine Software-Sammlung von Nvidia.',
    slug: 'cuda',
    lang: 'de',
    setName: 'Synthszr Lexikon',
    indexLabel: 'Lexikon',
  }

  it('enthält weiterhin den DefinedTerm mit seinem Begriffsset', () => {
    const blocks = buildGlossaryJsonLd({ ...base, updatedAt: null })
    const term = blocks.find((b) => b['@type'] === 'DefinedTerm') as Record<string, unknown>
    expect(term.name).toBe('CUDA')
    expect((term.inDefinedTermSet as Record<string, unknown>)['@type']).toBe('DefinedTermSet')
  })

  it('liefert eine BreadcrumbList mit Startseite, Lexikon und Begriff', () => {
    const blocks = buildGlossaryJsonLd({ ...base, updatedAt: null })
    const crumbs = blocks.find((b) => b['@type'] === 'BreadcrumbList') as Record<string, unknown>
    const items = crumbs.itemListElement as Array<Record<string, unknown>>
    expect(items).toHaveLength(3)
    expect(items.map((i) => i.position)).toEqual([1, 2, 3])
    expect(items[2].name).toBe('CUDA')
  })

  it('verwendet im Breadcrumb das Sprachsegment der Seite', () => {
    const blocks = buildGlossaryJsonLd({ ...base, lang: 'en', updatedAt: null })
    const crumbs = blocks.find((b) => b['@type'] === 'BreadcrumbList') as Record<string, unknown>
    const items = crumbs.itemListElement as Array<Record<string, unknown>>
    expect(items[1].item).toMatch(/\/en\/glossary$/)
  })

  it('gibt dateModified aus, wenn ein Änderungsdatum vorliegt', () => {
    const blocks = buildGlossaryJsonLd({ ...base, updatedAt: '2026-08-04T10:00:00Z' })
    const page = blocks.find((b) => b['@type'] === 'WebPage') as Record<string, unknown>
    expect(page.dateModified).toBe('2026-08-04T10:00:00Z')
  })

  it('lässt den WebPage-Block WEG, wenn kein Datum vorliegt', () => {
    // Ein WebPage ohne dateModified trägt kein Signal und wäre nur Ballast im
    // Markup — schlimmer noch, ein leeres Feld gilt bei Google als Fehler.
    const blocks = buildGlossaryJsonLd({ ...base, updatedAt: null })
    expect(blocks.some((b) => b['@type'] === 'WebPage')).toBe(false)
  })

  it('nennt einen Herausgeber am Begriff (E-E-A-T)', () => {
    const blocks = buildGlossaryJsonLd({ ...base, updatedAt: null })
    const term = blocks.find((b) => b['@type'] === 'DefinedTerm') as Record<string, unknown>
    expect((term.publisher as Record<string, unknown>)?.name).toMatch(/Synthszr/)
  })
})
