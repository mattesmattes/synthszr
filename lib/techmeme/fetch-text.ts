/**
 * Den Text eines Artikels beschaffen — Feed zuerst, Crawl danach.
 *
 * WAS DIE MESSUNG AM 2026-08-13 ERGAB (25 Quellen einer echten Startseite):
 *   8  echter Volltext aus dem Feed
 *   5  Feed hatte nur einen Anriss (unter 200 Zeichen)
 *   1  Artikel stand nicht im Feed
 *  11  Publikation hat gar keinen Feed (Reuters, Bloomberg, WSJ, Firmen-Blogs)
 *
 * Der Feed ist damit NICHT der Hauptweg, sondern eine Abkürzung in rund einem
 * Drittel der Fälle. Wer hier auf „Feeds lösen das Problem" baut, bekommt eine
 * Queue voller 150-Zeichen-Anrisse. Der Crawl ist der Normalfall und muss es
 * auch bleiben.
 *
 * Die Crawl-Kaskade ist bereits vorhanden (lib/scraper/article-extractor.ts:
 * Readability, dann markdown.new für Paywalls und JS-Seiten). Sie wird hier
 * genutzt, nicht nachgebaut.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { discoverFeed, hostOf } from '@/lib/techmeme/feed-discovery'
import { parseFeedItems, findEntryForUrl } from '@/lib/techmeme/feed'
import { extractArticleContent, extractViaMarkdownNew } from '@/lib/scraper/article-extractor'
import { safeFetch } from '@/lib/security/ssrf'
import type { FetchMode } from '@/lib/techmeme/queue-items'
import { looksBlocked, stripMarkdownPreamble, capText } from '@/lib/techmeme/text-quality'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Ab wann der Feed-Text ausreicht und kein Crawl mehr nötig ist.
 *
 * Bewusst hoch angesetzt: Bei der Messung lagen die reinen Anrisse zwischen 104
 * und 686 Zeichen, die echten Volltexte bei 2.400 bis 15.800. Eine Schwelle bei
 * 800 hätte theverge.com (686) knapp verfehlt, aber crypto.news (280) als
 * „Volltext" durchgewinkt — 1.500 trennt beide Gruppen sauber.
 */
const FEED_FULLTEXT_MIN = 1500

/** Untergrenze, ab der ein Text überhaupt als Artikel taugt. */
export const USABLE_TEXT_MIN = 400

export interface FetchedText {
  text: string
  title: string | null
  mode: FetchMode
  publishedAt: string | null
}

export interface FetchContext {
  supabase: AdminClient
  /** Feed-Cache des Laufs — wird durchgereicht und fortgeschrieben. */
  feedCache: Record<string, { feedUrl: string | null; checkedAt: string }>
  /** Bereits geholte Feed-Inhalte, je Feed-URL. Eine Story teilt sich Domains. */
  bodies: Map<string, string>
}

const UA = 'Mozilla/5.0 (compatible; SynthszrBot/1.0; +https://www.synthszr.com)'

/** Der Feed-Eintrag zu einer Artikel-Adresse, falls auffindbar. */
async function fromFeed(ctx: FetchContext, url: string): Promise<FetchedText | null> {
  const gefunden = await discoverFeed(ctx.supabase, url, ctx.feedCache)
  ctx.feedCache = gefunden.cache
  if (!gefunden.feedUrl) return null

  let xml = ctx.bodies.get(gefunden.feedUrl)
  if (xml === undefined) {
    try {
      const res = await safeFetch(gefunden.feedUrl, { headers: { 'User-Agent': UA }, timeoutMs: 12_000 })
      if (!res.ok) return null
      xml = await res.text()
      ctx.bodies.set(gefunden.feedUrl, xml)
    } catch {
      return null
    }
  }

  const eintrag = findEntryForUrl(parseFeedItems(xml), url)
  if (!eintrag) return null
  return { text: eintrag.content, title: eintrag.title, mode: 'feed', publishedAt: eintrag.publishedAt }
}

/**
 * Text zu einer Artikel-Adresse.
 *
 * Reihenfolge: Feed (wenn er wirklich Volltext liefert) → Readability →
 * markdown.new → als letzter Rückfall der Feed-Anriss. Der Anriss ist besser
 * als nichts, aber er kommt ZULETZT: Sonst spart sich der Job den Crawl bei
 * genau den Publikationen, die brauchbaren Volltext hätten.
 */
export async function fetchSourceText(ctx: FetchContext, url: string): Promise<FetchedText | null> {
  const feed = await fromFeed(ctx, url).catch(() => null)
  const feedOk = feed && brauchbar(feed.title, feed.text)
  if (feedOk && feed.text.length >= FEED_FULLTEXT_MIN) return veredelt(feed)

  try {
    const gecrawlt = await extractArticleContent(url)
    const text = gecrawlt?.textContent?.trim()
    if (text && brauchbar(gecrawlt?.title ?? null, text)) {
      return veredelt({
        text,
        title: gecrawlt?.title ?? null,
        mode: 'crawl',
        publishedAt: gecrawlt?.publishedDate ? gecrawlt.publishedDate.toISOString() : null,
      })
    }
  } catch (err) {
    console.warn('[Techmeme] Crawl fehlgeschlagen:', hostOf(url), err instanceof Error ? err.message : err)
  }

  try {
    const md = await extractViaMarkdownNew(url)
    if (md) {
      // Erst den Kopf abstreifen, DANN prüfen: Der Metadaten-Kopf von
      // markdown.new trägt den Titel der Abwehrseite als Fließtext mit sich.
      const sauber = stripMarkdownPreamble(md.content)
      if (brauchbar(md.title, sauber)) {
        return veredelt({ text: sauber, title: md.title, mode: 'markdown', publishedAt: null })
      }
      console.warn('[Techmeme] Abwehrseite statt Artikel:', hostOf(url), '|', (md.title ?? '').slice(0, 50))
    }
  } catch { /* letzter Rückfall unten */ }

  if (feedOk) return veredelt(feed)
  return null
}

/**
 * Lang genug UND kein Abwehr-Bildschirm.
 *
 * Die Längenprüfung allein hat im ersten Produktionslauf drei Sperrseiten
 * durchgelassen — sie sind mit über 1.000 Zeichen länger als mancher echte
 * Anriss (siehe lib/techmeme/text-quality.ts).
 */
function brauchbar(title: string | null, text: string): boolean {
  return text.length >= USABLE_TEXT_MIN && !looksBlocked(title, text)
}

/** Obergrenze anwenden, bevor der Text die Queue erreicht. */
function veredelt(t: FetchedText): FetchedText {
  return { ...t, text: capText(t.text) }
}
