/**
 * Techmeme als ENTDECKUNGSQUELLE für die News-Queue.
 *
 * Techmeme kuratiert Tech-Nachrichten in Story-Clustern: eine Hauptmeldung, dazu
 * ein „More:"-Block mit denselben Nachrichten bei anderen Publikationen. Genau
 * diese Kuration ist der Wert — sie sagt uns, WORÜBER berichtet wird und WIE
 * BREIT, ohne dass wir es selbst ermitteln müssen.
 *
 * ZWEI FALLSTRICKE, die beim ersten Versuch zuschlagen (2026-08-13 gemessen):
 *
 * 1. Der RSS-Feed (/feed.xml) liefert NUR Techmeme-Permalinks. Die Links auf die
 *    Originalpublikationen stehen ausschließlich im HTML der Startseite — über
 *    den Feed ist dieser Job nicht zu bauen.
 *
 * 2. Techmeme nutzt altes Markup mit GROSSGESCHRIEBENEN Attributen (`HREF=`,
 *    `<HTML>`, `<TITLE>`). Ein Regex auf `href="` findet auf einer 400-KB-Seite
 *    ganze 34 Treffer statt 1770. Alles hier arbeitet deshalb
 *    case-insensitiv und akzeptiert Attribute ohne Anführungszeichen.
 */

import { isPriorityPublication } from '@/lib/techmeme/known-feeds'

/** Eine Story: die Hauptmeldung plus die Quellen, die darüber berichten. */
export interface TechmemeStory {
  /** Überschrift der Hauptmeldung. */
  headline: string
  /** Techmeme-Permalink (Kontext, nicht zur Übernahme gedacht). */
  permalink: string | null
  /** Quell-Artikel, in Techmemes eigener Reihenfolge — die vorderste zuerst. */
  sources: TechmemeSource[]
}

export interface TechmemeSource {
  url: string
  /** Publikationsname, wie Techmeme ihn nennt (z. B. „Reuters"). */
  publication: string
}

const TECHMEME_URL = 'https://www.techmeme.com/'

/** Hosts, die nie eine Nachrichtenquelle sind — Techmemes eigene Angebote,
 *  soziale Netze und Kommentarplattformen. */
const NON_SOURCE_HOSTS = [
  'techmeme.com', 'memeorandum.com', 'mediagazer.com', 'wesmirch.com',
  'twitter.com', 'x.com', 'facebook.com', 'linkedin.com', 'bsky.app',
  // threads.com UND .net: Meta hat die Domain gewechselt, Techmeme verlinkt
  // beide. Nur eine zu sperren, lässt Handles durchrutschen.
  'threads.net', 'threads.com', 'mastodon.social', 'techhub.social', 'reddit.com',
  'news.ycombinator.com', 'feedburner.com', 'youtube.com',
]

export function isNewsSourceUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    // Ein Host ohne Punkt ist keine Domain, sondern ein Rest: Beim Messen am
    // 2026-08-13 tauchten „https://x" und „https://w" auf — abgeschnittene
    // Adressen. Ungeprüft landen sie als „Publikation ohne Feed" in der
    // Statistik und sehen dort aus wie ein normaler Rückfall auf den Crawl.
    if (!/\.[a-z]{2,}$/i.test(host)) return false
    return !NON_SOURCE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  } catch {
    return false
  }
}

/**
 * Zerlegt die Startseite in Stories.
 *
 * Techmemes Aufbau ist über die Jahre gewachsen und kennt keine sprechenden
 * Klassennamen für die Cluster. Verlässlich ist dagegen die REIHENFOLGE im
 * Dokument: Auf eine Überschrift folgen ihre Quell-Links, bis die nächste
 * Überschrift beginnt. Genau daran entlang wird hier geschnitten — das
 * überlebt Layout-Änderungen besser als ein Selektor auf eine bestimmte
 * Verschachtelung.
 */
export function parseTechmemeHtml(html: string, maxStories = 20): TechmemeStory[] {
  // Story-Cluster: <DIV CLASS="clus"> umschließt eine Meldung samt allen
  // Publikationen, die darüber berichten. An dieser Grenze wird geschnitten.
  const cluster = html.split(/<DIV\s+CLASS\s*=\s*["']?clus/i).slice(1)

  const stories: TechmemeStory[] = []
  for (const block of cluster) {
    if (stories.length >= maxStories) break
    const items = parseItems(block)
    if (items.length === 0) continue

    // Das erste Item ist die Hauptmeldung, sie trägt die Überschrift; die
    // folgenden sind Techmemes „More:"-Block — dieselbe Nachricht anderswo.
    const headline = items.find((i) => i.headline)?.headline
    if (!headline) continue

    const anchor = block.match(/<A\s+NAME\s*=\s*["']?(a\d{6}p\d+)/i)
    stories.push({
      headline,
      permalink: anchor ? `https://www.techmeme.com/${anchor[1].slice(1, 7)}/p${anchor[1].split('p')[1]}` : null,
      sources: items.map((i) => ({ url: i.url, publication: i.publication })),
    })
  }
  return stories
}

interface ParsedItem {
  url: string
  publication: string
  headline: string | null
}

/**
 * Zerlegt einen Cluster in seine Einzelmeldungen.
 *
 * Jede beginnt mit `<CITE><A HREF="…">Autor / Publikation</A>:</CITE>`. Die
 * darin verlinkte Adresse ist nur die STARTSEITE der Publikation — die
 * eigentliche Artikel-URL steht im nächsten Link danach. Wer den CITE-Link
 * nimmt, sammelt Domains statt Artikel.
 *
 * DER ERSTE LINK NACH DEM CITE ENTSCHEIDET — und nur er. Techmeme hängt an
 * viele Cluster einen Diskussionsblock (`DIV CLASS="dbpt"`, „X:"), in dem
 * Handles ebenfalls in `<CITE>` stehen. Deren Links zeigen alle auf x.com und
 * sind damit ausgeschlossen. Eine Suche, die daraufhin WEITERLÄUFT, greift den
 * nächsten erstbesten Link und schreibt einen fremden Artikel unter das Handle.
 * (2026-08-13 gemessen: fünf solcher Fehltreffer je Seitenabruf.)
 */
function parseItems(block: string): ParsedItem[] {
  const citeRe = /<CITE>([\s\S]*?)<\/CITE>/gi
  const out: ParsedItem[] = []
  const seenHosts = new Set<string>()

  let m: RegExpExecArray | null
  while ((m = citeRe.exec(block)) !== null) {
    const publication = cleanText(m[1]).replace(/:$/, '').trim()
    if (!publication) continue

    // Artikel-URL: der ERSTE absolute Link nach dem CITE. Ist er keine
    // Nachrichtenquelle, gehört der Eintrag nicht zu uns — nicht weitersuchen.
    const rest = block.slice(m.index + m[0].length, m.index + m[0].length + 3000)
    const erster = rest.match(/HREF\s*=\s*["']?(https?:\/\/[^"'\s>]+)/i)
    if (!erster) continue
    const url = erster[1].replace(/&amp;/g, '&')
    if (!isNewsSourceUrl(url)) continue

    let host: string
    try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { continue }
    // Eine Publikation je Story — Techmeme verlinkt dieselbe mehrfach.
    if (seenHosts.has(host)) continue
    seenHosts.add(host)

    // Überschrift: der <STRONG>-Text, der zum selben Item gehört.
    const strong = rest.match(/<STRONG[^>]*>([\s\S]*?)<\/STRONG>/i)
    const headline = strong ? cleanText(strong[1]) : null

    out.push({ url, publication, headline: headline && headline.length >= 15 ? headline : null })
  }
  return out
}

function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Lesbarer Publikationsname aus dem Host — „venturebeat.com" → „Venturebeat". */
export function publicationFromHost(host: string): string {
  const base = host.replace(/^www\./, '').split('.')[0]
  return base.charAt(0).toUpperCase() + base.slice(1)
}

/**
 * Wie viele Quellen je Story verarbeitet werden (Betreiber-Vorgabe 2026-08-13:
 * von 5 auf 10 erhöht). Techmeme listet im Schnitt zwölf.
 */
export const SOURCES_PER_STORY = 10

/**
 * Wählt die zu verarbeitenden Quellen einer Story.
 *
 * Techmemes Reihenfolge folgt der PROMINENZ einer Publikation, nicht unserer
 * fachlichen Nähe. Deshalb werden die ausdrücklich gewünschten Häuser
 * (VentureBeat, The New Stack) nach vorn gezogen, wenn sie überhaupt gelistet
 * sind — sonst fielen sie bei einer Story mit fünfzehn Quellen hinten heraus,
 * obwohl sie fachlich näher stehen als mancher Generalist davor.
 *
 * Die übrigen behalten Techmemes Reihenfolge: Sie ist redaktionell begründet
 * und besser als jede Rangfolge, die wir uns selbst ausdenken.
 */
export function selectSources(sources: TechmemeSource[], limit = SOURCES_PER_STORY): TechmemeSource[] {
  const bevorzugt: TechmemeSource[] = []
  const rest: TechmemeSource[] = []
  for (const s of sources) {
    const host = (() => {
      try { return new URL(s.url).hostname } catch { return '' }
    })()
    if (host && isPriorityPublication(host)) bevorzugt.push(s)
    else rest.push(s)
  }
  return [...bevorzugt, ...rest].slice(0, limit)
}

/** Holt die Startseite. Eigener User-Agent mit Kontakt-URL: ein anonymer
 *  Bot-String wird von vielen Seiten pauschal geblockt. */
export async function fetchTechmemeHtml(): Promise<string> {
  const res = await fetch(TECHMEME_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; SynthszrBot/1.0; +https://www.synthszr.com)',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Techmeme nicht erreichbar: HTTP ${res.status}`)
  return res.text()
}

/** Die Top-Stories der Startseite. */
export async function fetchTopStories(maxStories = 20): Promise<TechmemeStory[]> {
  return parseTechmemeHtml(await fetchTechmemeHtml(), maxStories)
}
