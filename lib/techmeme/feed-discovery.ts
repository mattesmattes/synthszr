/**
 * Findet den RSS/Atom-Feed einer Publikation — und merkt sich das Ergebnis.
 *
 * WARUM FEEDS STATT CRAWLING (an 10 Publikationen gemessen, 2026-08-13):
 * Das direkte Abrufen von Artikelseiten gelingt nur in rund der Hälfte der
 * Fälle. 403 (Bot-Schutz), 401, 429 (Rate-Limit) und Paywalls sind der
 * Normalfall, nicht die Ausnahme. Feeds haben diese Hürden nicht — sie sind für
 * maschinelles Lesen gemacht und liefern sauberen Text statt Rohmarkup.
 *
 * DER CACHE IST KEIN LUXUS: Techmeme verlinkt über 170 Publikationen. Ohne
 * gespeichertes Ergebnis führte jeder Lauf dieselbe Suche erneut durch —
 * inklusive der Domains, die gar keinen Feed haben. Deshalb wird auch das
 * NEGATIVE Ergebnis gespeichert.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { knownFeedFor } from '@/lib/techmeme/known-feeds'

type AdminClient = ReturnType<typeof createAdminClient>

const CACHE_KEY = 'techmeme_feed_cache'

/** Wie lange ein Fund gilt. Feeds ziehen selten um. */
const HIT_TTL_DAYS = 30
/** Wie lange ein „kein Feed" gilt — kürzer, damit Nachzügler entdeckt werden. */
const MISS_TTL_DAYS = 7

interface CacheEntry {
  /** null = geprüft, aber kein Feed gefunden. */
  feedUrl: string | null
  checkedAt: string
}

type FeedCache = Record<string, CacheEntry>

/** Übliche Pfade, wenn die Seite keinen `<link rel="alternate">` anbietet. */
const FALLBACK_PATHS = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml']

const UA = 'Mozilla/5.0 (compatible; SynthszrBot/1.0; +https://www.synthszr.com)'

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

async function readCache(supabase: AdminClient): Promise<FeedCache> {
  const { data } = await supabase.from('settings').select('value').eq('key', CACHE_KEY).maybeSingle()
  const raw = (data as { value?: unknown } | null)?.value
  const parsed = typeof raw === 'string' ? safeParse(raw) : raw
  return parsed && typeof parsed === 'object' ? (parsed as FeedCache) : {}
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}

async function writeCache(supabase: AdminClient, cache: FeedCache): Promise<void> {
  const { error } = await supabase
    .from('settings')
    .upsert({ key: CACHE_KEY, value: cache }, { onConflict: 'key' })
  if (error) console.error('[TechmemeFeed] Cache nicht speicherbar:', error.message)
}

function isFresh(entry: CacheEntry): boolean {
  const ttl = (entry.feedUrl ? HIT_TTL_DAYS : MISS_TTL_DAYS) * 24 * 60 * 60 * 1000
  return Date.now() - new Date(entry.checkedAt).getTime() < ttl
}

/** Sieht die Antwort nach einem Feed aus? Content-Type lügt oft, deshalb auch
 *  der Anfang des Körpers. */
function looksLikeFeed(contentType: string | null, body: string): boolean {
  if (contentType && /(rss|atom|xml)/i.test(contentType)) {
    return /<(rss|feed|rdf:RDF)\b/i.test(body)
  }
  return /^\s*<\?xml/.test(body) && /<(rss|feed|rdf:RDF)\b/i.test(body)
}

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return false
    const body = (await res.text()).slice(0, 2000)
    return looksLikeFeed(res.headers.get('content-type'), body)
  } catch {
    return false
  }
}

/** Feed-URL aus dem `<link rel="alternate">` der Startseite. */
export function feedUrlFromHtml(html: string, baseUrl: string): string | null {
  // Attribute case-insensitiv und in beliebiger Reihenfolge — bei Techmeme hat
  // uns genau diese Nachlässigkeit schon einmal 0 Treffer beschert.
  const links = html.match(/<link\b[^>]*>/gi) ?? []
  for (const tag of links) {
    if (!/rel\s*=\s*["']?alternate/i.test(tag)) continue
    if (!/type\s*=\s*["']?application\/(rss|atom)\+xml/i.test(tag)) continue
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i) ?? tag.match(/href\s*=\s*([^\s>]+)/i)
    if (!href) continue
    try {
      return new URL(href[1].replace(/&amp;/g, '&'), baseUrl).toString()
    } catch { /* nächster Kandidat */ }
  }
  return null
}

/**
 * Feed einer Publikation. Nutzt den Cache; sucht nur, wenn nötig.
 *
 * Reihenfolge: erst der ausgewiesene `<link rel="alternate">` (das ist die
 * Angabe der Seite selbst), dann die üblichen Pfade. Umgekehrt landete man bei
 * Seiten, die unter /feed etwas anderes ausliefern.
 */
export async function discoverFeed(
  supabase: AdminClient,
  articleUrl: string,
  cache?: FeedCache,
): Promise<{ feedUrl: string | null; cache: FeedCache; fromCache: boolean }> {
  const host = hostOf(articleUrl)
  const c = cache ?? (await readCache(supabase))
  if (!host) return { feedUrl: null, cache: c, fromCache: false }

  // Fest hinterlegte Adresse zuerst: Sie ist geprueft und umgeht die
  // Entdeckung voellig — genau dort scheitert die dynamische Suche bei den
  // wertvollsten Publikationen (Startseite antwortet mit 401, oder der Feed
  // steht gar nicht erst im HTML).
  const curated = knownFeedFor(host)
  if (curated) return { feedUrl: curated, cache: c, fromCache: true }

  const known = c[host]
  if (known && isFresh(known)) return { feedUrl: known.feedUrl, cache: c, fromCache: true }

  const origin = `https://${host}`
  let found: string | null = null

  try {
    const res = await fetch(origin, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(12_000),
    })
    if (res.ok) {
      const html = (await res.text()).slice(0, 200_000)
      const candidate = feedUrlFromHtml(html, origin)
      if (candidate && await probe(candidate)) found = candidate
    }
  } catch { /* Fallbacks unten */ }

  if (!found) {
    for (const path of FALLBACK_PATHS) {
      const candidate = `${origin}${path}`
      if (await probe(candidate)) { found = candidate; break }
    }
  }

  c[host] = { feedUrl: found, checkedAt: new Date().toISOString() }
  return { feedUrl: found, cache: c, fromCache: false }
}

/** Cache nach einem Lauf zurückschreiben — einmal, nicht je Domain. */
export async function persistFeedCache(supabase: AdminClient, cache: FeedCache): Promise<void> {
  await writeCache(supabase, cache)
}

export async function loadFeedCache(supabase: AdminClient): Promise<FeedCache> {
  return readCache(supabase)
}
