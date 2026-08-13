/**
 * Fest hinterlegte Feed-Adressen wichtiger Publikationen.
 *
 * WARUM DIE LISTE NÖTIG IST (gemessen 2026-08-13): Die automatische Suche fand
 * nur 6 von 14 Domains einen Feed — und ausgerechnet die journalistisch
 * wertvollsten fehlten. Der Grund liegt nicht am Feed, sondern an seiner
 * ENTDECKUNG: Um `<link rel="alternate">` zu lesen, muss die Startseite geladen
 * werden, und genau dort blocken Reuters und MarketWatch mit HTTP 401.
 * CoinDesk antwortet mit 200, nennt seinen Feed aber gar nicht erst im HTML.
 *
 * Jede Adresse hier wurde EINZELN GEPRÜFT: HTTP 200 und ein Rumpf, der
 * tatsächlich mit <rss>, <feed> oder <rdf:RDF> beginnt. Nicht aus dem Gedächtnis
 * geschrieben — geratene Feed-URLs sind der Hauptgrund für stille Ausfälle.
 *
 * Nicht aufgenommen, weil beim Prüfen nicht erreichbar: reuters.com (401 auch
 * auf dem Feed), marktechpost.com (403), axios.com (404 auf dem üblichen Pfad),
 * analyticsindiamag.com (200, aber kein Feed-Rumpf). Für diese greift die
 * dynamische Suche und danach der Crawl-Rückfall.
 *
 * PFLEGE: Eine Adresse, die dauerhaft 404 liefert, gehört korrigiert oder
 * entfernt — sonst verhindert der Eintrag stillschweigend, dass die dynamische
 * Suche es versucht.
 */
export const KNOWN_FEEDS: Record<string, string> = {
  // Vom Betreiber ausdrücklich gewünscht (s. PRIORITY_PUBLICATIONS)
  'venturebeat.com': 'https://venturebeat.com/feed/',
  'thenewstack.io': 'https://thenewstack.io/feed/',

  'techcrunch.com': 'https://techcrunch.com/feed/',
  'theverge.com': 'https://www.theverge.com/rss/index.xml',
  'arstechnica.com': 'https://feeds.arstechnica.com/arstechnica/index',
  'wired.com': 'https://www.wired.com/feed/rss',
  'zdnet.com': 'https://www.zdnet.com/news/rss.xml',
  'cnet.com': 'https://www.cnet.com/rss/news/',
  'engadget.com': 'https://www.engadget.com/rss.xml',
  'theregister.com': 'https://www.theregister.com/headlines.atom',
  '404media.co': 'https://www.404media.co/rss/',
  'semianalysis.com': 'https://semianalysis.com/feed/',
  'cnbc.com': 'https://www.cnbc.com/id/19854910/device/rss/rss.html',
  'theguardian.com': 'https://www.theguardian.com/technology/rss',
  'nytimes.com': 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml',
  'bbc.com': 'https://feeds.bbci.co.uk/news/technology/rss.xml',
  'businessinsider.com': 'https://markets.businessinsider.com/rss/news',
  'coindesk.com': 'https://www.coindesk.com/arc/outboundfeeds/rss/',
}

/**
 * Publikationen, die IMMER berücksichtigt werden, wenn Techmeme sie zu einer
 * Story listet — auch wenn sie dort weit hinten stehen (Betreiber-Vorgabe
 * 2026-08-13). Techmemes Reihenfolge folgt der Prominenz, nicht unserer
 * fachlichen Nähe.
 */
export const PRIORITY_PUBLICATIONS = ['venturebeat.com', 'thenewstack.io']

/** Fest hinterlegter Feed einer Domain, falls vorhanden. */
export function knownFeedFor(host: string): string | null {
  const clean = host.toLowerCase().replace(/^www\./, '')
  return KNOWN_FEEDS[clean] ?? null
}

export function isPriorityPublication(host: string): boolean {
  const clean = host.toLowerCase().replace(/^www\./, '')
  return PRIORITY_PUBLICATIONS.includes(clean)
}
