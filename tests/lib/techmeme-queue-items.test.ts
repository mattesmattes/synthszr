/**
 * Was aus einer Techmeme-Quelle als Queue-Eintrag wird.
 *
 * Betreiber-Entscheidung 2026-08-13: EIN EINTRAG JE QUELLE, nicht je Story.
 * Damit landen bis zu zehn Einträge zur selben Meldung in der Queue — das ist
 * gewollt, weil der vorhandene Bündelungs-Mechanismus („Thema des Tages")
 * genau darauf arbeitet. Die Einträge müssen deshalb ihre Story-Zugehörigkeit
 * MITBRINGEN, sonst kann niemand sie später als zusammengehörig erkennen.
 */
import { describe, expect, it } from 'vitest'
import { buildQueueItem, filterKnownSources, storyKeyFor, publicationLabel } from '@/lib/techmeme/queue-items'
import type { TechmemeStory, TechmemeSource } from '@/lib/techmeme/client'

const STORY: TechmemeStory = {
  headline: 'Ein Labor stellt ein neues Modell vor und nennt Benchmarks',
  permalink: 'https://www.techmeme.com/260813/p7',
  sources: [],
}

const QUELLE: TechmemeSource = {
  url: 'https://example-news.com/2026/08/modell-x',
  publication: 'Erika Mustermann / Example News',
}

describe('publicationLabel', () => {
  it('nimmt die Publikation, nicht den Autor', () => {
    // Techmeme schreibt „Autor / Publikation". Wer den ganzen String nimmt,
    // bekommt in der Queue eine Quelle namens „Patrick Howell O'Neill /
    // Bloomberg" — und die Quellen-Statistik zaehlt jeden Autor als eigenes Haus.
    expect(publicationLabel("Patrick Howell O'Neill / Bloomberg")).toBe('Bloomberg')
    expect(publicationLabel('Erika Mustermann / Example News')).toBe('Example News')
  })

  it('laesst einen blossen Publikationsnamen unveraendert', () => {
    expect(publicationLabel('Reuters')).toBe('Reuters')
  })

  it('kommt mit mehreren Schraegstrichen klar', () => {
    expect(publicationLabel('A / B / The Register')).toBe('The Register')
  })
})

describe('storyKeyFor', () => {
  it('ist fuer dieselbe Story stabil', () => {
    expect(storyKeyFor(STORY)).toBe(storyKeyFor({ ...STORY, sources: [QUELLE] }))
  })

  it('unterscheidet verschiedene Stories', () => {
    expect(storyKeyFor(STORY)).not.toBe(storyKeyFor({ ...STORY, headline: 'Etwas anderes' }))
  })

  it('kommt ohne Permalink aus', () => {
    expect(storyKeyFor({ ...STORY, permalink: null })).toBeTruthy()
  })
})

describe('buildQueueItem', () => {
  const item = buildQueueItem({
    story: STORY,
    source: QUELLE,
    rank: 3,
    text: 'Der ganze Artikeltext, lang genug um als Inhalt zu taugen. '.repeat(20),
    title: 'Der Titel der Publikation selbst',
    mode: 'feed',
    publishedAt: '2026-08-13T09:30:00.000Z',
  })

  it('nimmt die Artikel-URL als Quelle', () => {
    expect(item.sourceUrl).toBe(QUELLE.url)
  })

  it('bevorzugt den Titel der Publikation vor Techmemes Ueberschrift', () => {
    expect(item.title).toBe('Der Titel der Publikation selbst')
  })

  it('faellt auf Techmemes Ueberschrift zurueck, wenn die Quelle keine nennt', () => {
    const ohne = buildQueueItem({
      story: STORY, source: QUELLE, rank: 0, text: 'x'.repeat(500),
      title: null, mode: 'crawl', publishedAt: null,
    })
    expect(ohne.title).toBe(STORY.headline)
  })

  it('traegt die Story-Zugehoerigkeit — sonst ist keine Buendelung moeglich', () => {
    const meta = item.metadata as Record<string, unknown>
    expect(meta.techmeme_story).toBe(storyKeyFor(STORY))
    expect(meta.techmeme_headline).toBe(STORY.headline)
    expect(meta.techmeme_rank).toBe(3)
  })

  it('setzt den Herkunfts-Marker, an dem die Oberflaeche das Label erkennt', () => {
    // Ohne diesen Marker ist in news_queue nicht mehr feststellbar, dass der
    // Eintrag von Techmeme kam: source_identifier traegt die Domain des
    // Originalartikels, nicht den Aggregator.
    expect((item.metadata as Record<string, unknown>).techmeme).toBe(true)
  })

  it('haelt fest, WIE der Text geholt wurde', () => {
    // Ohne diese Angabe laesst sich spaeter nicht messen, ob die Feed-Strecke
    // etwas bringt oder ob faktisch immer gecrawlt wird.
    expect((item.metadata as Record<string, unknown>).fetch_mode).toBe('feed')
  })

  it('merkt sich die Publikation, wie Techmeme sie nennt', () => {
    expect((item.metadata as Record<string, unknown>).techmeme_publication).toBe('Example News')
  })

  it('erzeugt einen Auszug, der kuerzer ist als der Text', () => {
    expect(item.excerpt!.length).toBeLessThan(item.content!.length)
    expect(item.excerpt!.length).toBeGreaterThan(0)
  })
})

describe('filterKnownSources', () => {
  const quellen: TechmemeSource[] = [
    { url: 'https://a.de/artikel-eins', publication: 'A' },
    { url: 'https://b.de/artikel-zwei', publication: 'B' },
    { url: 'https://c.de/artikel-drei', publication: 'C' },
  ]

  it('laesst weg, was schon in der Queue steht', () => {
    const frisch = filterKnownSources(quellen, ['https://b.de/artikel-zwei'])
    expect(frisch.map((q) => q.publication)).toEqual(['A', 'C'])
  })

  it('erkennt dieselbe Meldung trotz Tracking-Parametern und www', () => {
    // Techmeme-Stories stehen stundenlang auf der Startseite. Ohne
    // normalisierten Vergleich legte jeder Lauf dieselben Artikel erneut an.
    const frisch = filterKnownSources(quellen, ['https://www.b.de/artikel-zwei/?utm_source=x'])
    expect(frisch.map((q) => q.publication)).toEqual(['A', 'C'])
  })

  it('laesst alles durch, wenn nichts bekannt ist', () => {
    expect(filterKnownSources(quellen, [])).toHaveLength(3)
  })

  it('entfernt Dubletten innerhalb derselben Story', () => {
    const doppelt = [...quellen, { url: 'https://a.de/artikel-eins?utm_medium=y', publication: 'A nochmal' }]
    expect(filterKnownSources(doppelt, [])).toHaveLength(3)
  })
})
