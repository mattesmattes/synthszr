/**
 * Aus dem Feed einer Publikation den EINEN Artikel holen, auf den Techmeme zeigt.
 *
 * BETREIBER-VORGABE: Nicht der ganze Feed wandert in die Queue, sondern
 * ausschließlich die von Techmeme referenzierte Meldung. Der Feed ist hier nur
 * das Lesegerät für einen bekannten Artikel — keine zweite Entdeckungsquelle.
 *
 * DER KNACKPUNKT IST DER URL-VERGLEICH, nicht das XML. Techmeme und der Feed
 * derselben Publikation nennen dieselbe Meldung fast nie zeichengleich:
 * Tracking-Parameter, „www.", ein Schrägstrich am Ende, http statt https. Ein
 * Vergleich mit === fände deshalb fast nie etwas — und der Job fiele
 * stillschweigend immer auf den teureren Crawl zurück, ohne dass es auffiele.
 *
 * Eigener Parser statt Bibliothek: gebraucht werden vier Felder aus zwei
 * Formaten. Eine Abhängigkeit dafür wäre mehr Wartung als Nutzen.
 */
import { htmlToPlainText } from '@/lib/utils/html-to-text'

export interface FeedItem {
  title: string
  url: string
  /** Fließtext, kein Markup. content:encoded, sonst description. */
  content: string
  /** ISO-Zeitstempel, wenn der Feed einen nennt. */
  publishedAt: string | null
}

/**
 * Parameter, die den Artikel NICHT bestimmen, sondern nur seine Herkunft
 * vermerken. Bewusst eine Sperrliste und keine Erlaubnisliste: Viele
 * Nachrichtenseiten adressieren ihre Artikel über `?id=` oder `?p=`. Wer alle
 * Parameter wegwirft, macht aus sämtlichen Artikeln solcher Seiten dieselbe
 * URL — der Abgleich träfe dann den falschen Artikel.
 */
const TRACKING_PARAMS = [
  'ref', 'source', 'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'igshid', 'cmpid',
  'ncid', 'sh', 'taid', 'guccounter', 'guce_referrer', 'at_medium', 'at_campaign',
  '__twitter_impression', 'smid', 'partner', 'via', 'CMP', 'cmp',
]

/** XML-Entities auflösen. `&amp;` ZULETZT, sonst wird aus `&amp;lt;` ein „<". */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
}

/** Inhalt eines Elements — CDATA-Hülle abgestreift, Entities aufgelöst. */
function tagContent(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i')
  const m = block.match(re)
  if (!m) return null
  const raw = m[1]
  const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)
  // In CDATA steht bereits echtes Markup, Entities wären dort Text.
  return cdata ? cdata[1] : decodeXmlEntities(raw)
}

/**
 * Die Artikel-Adresse eines Eintrags.
 *
 * RSS schreibt sie als Elementtext (`<link>https://…</link>`), Atom dagegen ins
 * href-ATTRIBUT (`<link rel="alternate" href="…"/>`) — dort ist der Elementtext
 * leer. Wer nur eine der beiden Formen liest, bekommt bei der anderen nichts.
 */
function linkOf(block: string): string | null {
  const text = tagContent(block, 'link')
  if (text && /^https?:\/\//i.test(text.trim())) return text.trim()

  // Atom: bevorzugt rel="alternate", sonst der erste Link ohne rel.
  const links = block.match(/<link\b[^>]*\/?>/gi) ?? []
  const alternate = links.find((l) => /rel\s*=\s*["']?alternate/i.test(l))
  for (const tag of [alternate, ...links]) {
    if (!tag) continue
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)
    if (href && /^https?:\/\//i.test(href[1])) return decodeXmlEntities(href[1])
  }
  return null
}

function dateOf(block: string): string | null {
  const raw = tagContent(block, 'pubDate') ?? tagContent(block, 'updated') ?? tagContent(block, 'published')
  if (!raw) return null
  const d = new Date(raw.trim())
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function parseFeedItems(xml: string): FeedItem[] {
  if (!xml) return []

  const blocks = [
    ...(xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []),
    ...(xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? []),
  ]

  const out: FeedItem[] = []
  for (const block of blocks) {
    const url = linkOf(block)
    const title = tagContent(block, 'title')
    if (!url || !title) continue

    // content:encoded ist der VOLLTEXT, description meist nur der Anriss.
    const body =
      tagContent(block, 'content:encoded') ??
      tagContent(block, 'content') ??
      tagContent(block, 'description') ??
      tagContent(block, 'summary') ??
      ''

    out.push({
      title: htmlToPlainText(title).trim(),
      url,
      content: htmlToPlainText(body),
      publishedAt: dateOf(block),
    })
  }
  return out
}

/**
 * Vergleichsform einer Artikel-Adresse: Protokoll, „www.", Schrägstrich am Ende
 * und Tracking-Parameter fallen weg, alles Übrige bleibt.
 */
export function normalizeArticleUrl(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const path = u.pathname.replace(/\/+$/, '').toLowerCase()

    const params = [...u.searchParams.entries()]
      .filter(([k]) => !k.toLowerCase().startsWith('utm_') && !TRACKING_PARAMS.includes(k))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)

    return `${host}${path}${params.length ? `?${params.join('&')}` : ''}`
  } catch {
    return url
  }
}

/**
 * Kürzestes Slug, das noch für einen Artikel steht.
 *
 * Der Slug-Abgleich ist der zweite Anlauf, wenn die Adressen auseinandergehen
 * (Techmeme zeigt etwa auf die AMP-Fassung). Kurze Segmente wie „de", „en" oder
 * „news" tauchen auf jeder Seite auf — als Treffer wären sie Zufall, nicht
 * Übereinstimmung.
 */
const MIN_SLUG_LENGTH = 8

function slugOf(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean)
    const last = segments[segments.length - 1]?.replace(/\.(html?|amp|php)$/i, '')
    return last && last.length >= MIN_SLUG_LENGTH ? last.toLowerCase() : null
  } catch {
    return null
  }
}

/**
 * Der Feed-Eintrag zur gesuchten Adresse — oder null.
 *
 * NULL IST EIN ERGEBNIS, kein Mangel: Ein „nimm sonst den ersten Eintrag"
 * lieferte eine FREMDE Meldung unter der richtigen Überschrift. Der Aufrufer
 * fällt bei null auf den Crawl zurück; das ist teurer, aber richtig.
 */
export function findEntryForUrl(items: FeedItem[], articleUrl: string): FeedItem | null {
  const ziel = normalizeArticleUrl(articleUrl)
  const exakt = items.find((i) => normalizeArticleUrl(i.url) === ziel)
  if (exakt) return exakt

  const zielSlug = slugOf(articleUrl)
  if (!zielSlug) return null
  return items.find((i) => slugOf(i.url) === zielSlug) ?? null
}
