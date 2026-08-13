/**
 * Techmeme-Parsing.
 *
 * Das Fixture unten ist NACHGEBAUT, nicht kopiert: es bildet nur die
 * Markup-Eigenheiten nach, an denen der Parser hängt — echtes Seiten-HTML
 * gehört weder ins Repo noch in einen Test.
 *
 * Zwei dieser Eigenheiten haben beim ersten Versuch (2026-08-13) zugeschlagen:
 *   - GROSSGESCHRIEBENE Attribute (`HREF=`, `CLASS=`). Ein Regex auf `href="`
 *     fand auf der 394-KB-Seite 34 statt 1770 Links.
 *   - Der Link im <CITE> zeigt auf die STARTSEITE der Publikation, nicht auf
 *     den Artikel. Die Artikel-URL steht im Link danach. Wer den CITE-Link
 *     nimmt, sammelt Domains statt Meldungen.
 */
import { describe, expect, it } from 'vitest'
import { parseTechmemeHtml, isNewsSourceUrl, publicationFromHost } from '@/lib/techmeme/client'

const FIXTURE = `
<HTML><BODY>
<DIV CLASS="clus">
  <A NAME="a260813p7"></A>
  <DIV CLASS="itc1"><DIV CLASS="itc2"><DIV CLASS="item">
    <CITE><A HREF="https://example-news.com/">Erika Mustermann / Example News</A>:</CITE>
    <DIV CLASS="ii"><A HREF="https://example-news.com/2026/08/modell-x"><IMG SRC="/i.jpg"></A>
    <STRONG>Ein Labor stellt ein neues Modell vor und nennt Benchmarks</STRONG></DIV>
  </DIV></DIV></DIV>
  <DIV CLASS="item">
    <CITE><A HREF="https://zweitblatt.de/">Zweitblatt</A>:</CITE>
    <A HREF="https://zweitblatt.de/artikel/modell-x">Auch dazu</A>
  </DIV>
  <DIV CLASS="dbpt"> <SPAN CLASS="drhed">X:</SPAN>
    <CITE><A HREF="https://x.com/jemand">Jemand / @jemand</A>:</CITE>
    <A HREF="https://x.com/jemand/status/1">Kommentar</A>,
    <A HREF="https://x.com/andere/status/2">noch einer</A>,
    <A HREF="https://spaetere-quelle.de/artikel/xyz">steht weiter hinten im Cluster</A>
  </DIV>
</DIV>
<DIV CLASS="clus">
  <A NAME="a260813p8"></A>
  <DIV CLASS="item">
    <CITE><A HREF="https://drittquelle.org/">Drittquelle</A>:</CITE>
    <A HREF="https://drittquelle.org/news/chip-fertigung"></A>
    <STRONG>Ein Auftragsfertiger meldet Fortschritte bei der Chip-Ausbeute</STRONG>
  </DIV>
</DIV>
</BODY></HTML>`

describe('parseTechmemeHtml', () => {
  const stories = parseTechmemeHtml(FIXTURE)

  it('erkennt beide Story-Cluster', () => {
    expect(stories).toHaveLength(2)
  })

  it('nimmt die ARTIKEL-URL, nicht die Startseite aus dem CITE', () => {
    expect(stories[0].sources[0].url).toBe('https://example-news.com/2026/08/modell-x')
    expect(stories[0].sources[0].url).not.toBe('https://example-news.com/')
  })

  it('liest den Publikationsnamen aus dem CITE', () => {
    expect(stories[0].sources[0].publication).toContain('Example News')
    expect(stories[0].sources[1].publication).toBe('Zweitblatt')
  })

  it('nimmt die Ueberschrift aus dem STRONG', () => {
    expect(stories[0].headline).toContain('neues Modell')
    expect(stories[1].headline).toContain('Chip-Ausbeute')
  })

  it('laesst Techmemes Diskussionsblock aus — Tweets sind keine Quellen', () => {
    // Die Handles im „X:"-Block stehen ebenfalls in <CITE>. Wer sie mitnimmt,
    // haelt Kommentare fuer Publikationen.
    const urls = stories[0].sources.map((s) => s.url)
    expect(urls.some((u) => u.includes('x.com'))).toBe(false)
    expect(stories[0].sources).toHaveLength(2)
  })

  it('ordnet einem Handle keinen spaeteren Artikel-Link zu', () => {
    // 2026-08-13 an der echten Seite gemessen: Weil alle Links eines X-Blocks
    // ausgeschlossen sind, lief die Suche WEITER und griff den naechsten
    // erstbesten Link — auf der echten Seite bis zum Rand des Suchfensters,
    // wo sie eine URL mittendrin abschnitt („https://x").
    //
    // Die Regel: Der ERSTE Link nach dem CITE ist der Artikel. Ist er keiner,
    // gehoert der Eintrag nicht zu uns — verwerfen statt weitersuchen.
    const urls = stories[0].sources.map((s) => s.url)
    expect(urls.some((u) => u.includes('spaetere-quelle.de'))).toBe(false)
    const publikationen = stories[0].sources.map((s) => s.publication)
    expect(publikationen.some((p) => p.includes('@'))).toBe(false)
  })

  it('verwirft URLs ohne plausiblen Host', () => {
    const kaputt = parseTechmemeHtml(`<DIV CLASS="clus">
      <DIV CLASS="item">
        <CITE><A HREF="https://x.de/">Irgendwas</A>:</CITE>
        <A HREF="https://abgeschnitten">Text</A>
        <STRONG>Eine Ueberschrift, die lang genug ist</STRONG>
      </DIV>
    </DIV>`)
    expect(kaputt.flatMap((s) => s.sources)).toHaveLength(0)
  })

  it('haelt Techmemes Reihenfolge ein — die vorderste Quelle zuerst', () => {
    expect(stories[0].sources.map((s) => s.publication)).toEqual([
      'Erika Mustermann / Example News',
      'Zweitblatt',
    ])
  })

  it('begrenzt auf maxStories', () => {
    expect(parseTechmemeHtml(FIXTURE, 1)).toHaveLength(1)
  })

  it('kommt mit fremdem Markup klar, statt zu werfen', () => {
    expect(parseTechmemeHtml('<html><body>nichts</body></html>')).toEqual([])
    expect(parseTechmemeHtml('')).toEqual([])
  })
})

describe('isNewsSourceUrl', () => {
  it('erkennt Nachrichtenquellen', () => {
    expect(isNewsSourceUrl('https://www.reuters.com/tech/artikel')).toBe(true)
  })

  it.each([
    'https://www.techmeme.com/260813/p7',
    'https://twitter.com/x/status/1',
    'https://news.ycombinator.com/item?id=1',
    'https://bsky.app/profile/x',
  ])('schliesst %s aus', (url) => {
    expect(isNewsSourceUrl(url)).toBe(false)
  })

  it('schliesst Mastodon-Instanzen aus, nicht nur mastodon.social', () => {
    // 2026-08-13 in der Queue gefunden: „@carnage4life@mas.to" als Quelle. Es
    // gibt tausende Fediverse-Instanzen; eine Liste einzelner Hosts pflegt man
    // nie vollstaendig.
    expect(isNewsSourceUrl('https://mas.to/@carnage4life/1')).toBe(false)
    expect(isNewsSourceUrl('https://hachyderm.io/@jemand/2')).toBe(false)
  })

  it('haelt echte Nachrichtenseiten mit /@ im Pfad heraus (Medium-Stil)', () => {
    // Medium und Substack nutzen ebenfalls /@name — dort steht aber echter
    // Text, und die Domain ist bekannt.
    expect(isNewsSourceUrl('https://medium.com/@autor/artikel-xyz')).toBe(true)
  })

  it('faellt bei Muell nicht um', () => {
    expect(isNewsSourceUrl('kein-url')).toBe(false)
  })
})

describe('publicationFromHost', () => {
  it('macht aus dem Host einen lesbaren Namen', () => {
    expect(publicationFromHost('venturebeat.com')).toBe('Venturebeat')
    expect(publicationFromHost('www.reuters.com')).toBe('Reuters')
  })
})
