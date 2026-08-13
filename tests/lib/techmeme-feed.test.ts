/**
 * Feed-Auswertung: aus dem RSS/Atom einer Publikation den EINEN Artikel holen,
 * auf den Techmeme zeigt.
 *
 * Der Knackpunkt ist nicht das XML, sondern der URL-VERGLEICH. Techmeme und der
 * Feed derselben Publikation nennen dieselbe Meldung selten zeichengleich:
 * Tracking-Parameter, „www.", ein Schrägstrich am Ende, http statt https. Ein
 * Vergleich mit === findet deshalb fast nie etwas — und der Job fiele
 * stillschweigend immer auf den Crawl zurück, ohne dass es jemandem auffiele.
 */
import { describe, expect, it } from 'vitest'
import { parseFeedItems, normalizeArticleUrl, findEntryForUrl } from '@/lib/techmeme/feed'

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>Example News</title>
  <item>
    <title>Ein Labor stellt ein neues Modell vor</title>
    <link>https://example-news.com/2026/08/modell-x/?utm_source=rss&amp;utm_medium=feed</link>
    <pubDate>Wed, 13 Aug 2026 09:30:00 +0000</pubDate>
    <description><![CDATA[<p>Kurzfassung der Meldung.</p>]]></description>
    <content:encoded><![CDATA[<p>Der <b>ganze</b> Text der Meldung mit allen Einzelheiten.</p>]]></content:encoded>
  </item>
  <item>
    <title>Etwas völlig anderes</title>
    <link>https://example-news.com/2026/08/anderes/</link>
    <description>Nur eine Kurzfassung.</description>
  </item>
</channel>
</rss>`

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Chip-Ausbeute steigt</title>
    <link rel="alternate" type="text/html" href="https://drittquelle.org/news/chip-fertigung"/>
    <updated>2026-08-13T08:00:00Z</updated>
    <content type="html">&lt;p&gt;Ein Auftragsfertiger meldet Fortschritte.&lt;/p&gt;</content>
  </entry>
</feed>`

describe('parseFeedItems', () => {
  it('liest RSS-Items mit Titel, Link und Volltext', () => {
    const items = parseFeedItems(RSS)
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe('Ein Labor stellt ein neues Modell vor')
    expect(items[0].url).toContain('example-news.com/2026/08/modell-x')
  })

  it('bevorzugt content:encoded vor description — das ist der Volltext', () => {
    const items = parseFeedItems(RSS)
    expect(items[0].content).toContain('ganze')
    expect(items[0].content).toContain('Einzelheiten')
  })

  it('faellt auf description zurueck, wenn es keinen Volltext gibt', () => {
    const items = parseFeedItems(RSS)
    expect(items[1].content).toContain('Kurzfassung')
  })

  it('liefert Text, kein Markup — der Ghostwriter bekommt keine Tags', () => {
    const items = parseFeedItems(RSS)
    expect(items[0].content).not.toContain('<p>')
    expect(items[0].content).not.toContain('<b>')
  })

  it('liest das Datum, wenn der Feed eines nennt', () => {
    const items = parseFeedItems(RSS)
    expect(items[0].publishedAt).toBe('2026-08-13T09:30:00.000Z')
    expect(items[1].publishedAt).toBeNull()
  })

  it('liest Atom-Entries — der Link steht dort im href-Attribut', () => {
    const items = parseFeedItems(ATOM)
    expect(items).toHaveLength(1)
    expect(items[0].url).toBe('https://drittquelle.org/news/chip-fertigung')
    expect(items[0].title).toBe('Chip-Ausbeute steigt')
    expect(items[0].content).toContain('Auftragsfertiger')
  })

  it('faellt bei Muell nicht um', () => {
    expect(parseFeedItems('')).toEqual([])
    expect(parseFeedItems('<html><body>keine Feed-Seite</body></html>')).toEqual([])
  })
})

describe('normalizeArticleUrl', () => {
  it('macht aus denselben Meldungen dieselbe Zeichenkette', () => {
    const a = normalizeArticleUrl('https://www.example-news.com/2026/08/modell-x/?utm_source=rss')
    const b = normalizeArticleUrl('http://example-news.com/2026/08/modell-x')
    expect(a).toBe(b)
  })

  it('behaelt Parameter, die den Artikel BESTIMMEN', () => {
    // Viele Nachrichtenseiten adressieren ihre Artikel ueber ?id= oder ?p=.
    // Wer die mit den Trackern zusammen wegwirft, macht aus allen Artikeln
    // einer Seite dieselbe URL — und der Abgleich trifft den falschen.
    const eins = normalizeArticleUrl('https://alt.example.com/read?id=123&utm_campaign=x')
    const zwei = normalizeArticleUrl('https://alt.example.com/read?id=456')
    expect(eins).not.toBe(zwei)
    expect(eins).toContain('id=123')
    expect(eins).not.toContain('utm_campaign')
  })

  it('unterscheidet verschiedene Artikel derselben Seite', () => {
    expect(normalizeArticleUrl('https://x.de/a')).not.toBe(normalizeArticleUrl('https://x.de/b'))
  })

  it('gibt bei Muell die Eingabe zurueck, statt zu werfen', () => {
    expect(normalizeArticleUrl('kein-url')).toBe('kein-url')
  })
})

describe('findEntryForUrl', () => {
  const items = parseFeedItems(RSS)

  it('findet den Eintrag trotz Tracking-Parametern und www', () => {
    const hit = findEntryForUrl(items, 'https://www.example-news.com/2026/08/modell-x')
    expect(hit?.title).toBe('Ein Labor stellt ein neues Modell vor')
  })

  it('nimmt NICHT irgendeinen Eintrag, wenn der gesuchte fehlt', () => {
    // Genau hier lag die Gefahr: ein „nimm den ersten"-Rueckfall wuerde eine
    // FREMDE Meldung als die gesuchte ausgeben — falscher Inhalt unter richtiger
    // Ueberschrift, und niemand sieht es.
    expect(findEntryForUrl(items, 'https://example-news.com/2026/08/gibt-es-nicht')).toBeNull()
  })

  it('findet den Eintrag auch, wenn nur der Slug uebereinstimmt', () => {
    // Kommt vor, wenn Techmeme auf die AMP- oder Kurzfassung zeigt.
    const hit = findEntryForUrl(items, 'https://example-news.com/amp/modell-x')
    expect(hit?.title).toBe('Ein Labor stellt ein neues Modell vor')
  })

  it('verwechselt kurze Slugs nicht', () => {
    const kurz = parseFeedItems(`<rss><channel>
      <item><title>A</title><link>https://x.de/de</link></item>
    </channel></rss>`)
    expect(findEntryForUrl(kurz, 'https://x.de/en')).toBeNull()
  })
})
