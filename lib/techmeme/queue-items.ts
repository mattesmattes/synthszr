/**
 * Aus einer Techmeme-Quelle wird ein Eintrag der News-Queue.
 *
 * BETREIBER-ENTSCHEIDUNG 2026-08-13: EIN EINTRAG JE QUELLE, nicht je Story.
 * Damit landen bis zu zehn Einträge zur selben Meldung in der Queue — gewollt,
 * weil der vorhandene Bündelungs-Mechanismus („Thema des Tages" / „Nachlese")
 * genau auf mehreren Einträgen desselben Themas arbeitet.
 *
 * Daraus folgt die wichtigste Anforderung an diese Datei: Jeder Eintrag muss
 * seine STORY-ZUGEHÖRIGKEIT mitbringen. Ohne sie steht in der Queue ein Dutzend
 * Artikel, denen niemand mehr ansieht, dass sie dieselbe Meldung behandeln.
 *
 * Der Herkunfts-Marker ist ebenfalls nötig und nicht ableitbar: In `news_queue`
 * trägt `source_identifier` die Domain des ORIGINALARTIKELS — der Aggregator
 * wird beim Queueing bewusst wegnormalisiert (lib/news-queue/service.ts,
 * AGGREGATOR_EMAILS). Nach dem Schreiben ist „kam von Techmeme" sonst nirgends
 * mehr abzulesen.
 */
import type { TechmemeStory, TechmemeSource } from '@/lib/techmeme/client'
import { normalizeArticleUrl } from '@/lib/techmeme/feed'
import { curationScore } from '@/lib/techmeme/scoring'

/** Wie der Text beschafft wurde — für die spätere Auswertung der Strecke. */
export type FetchMode = 'feed' | 'crawl' | 'markdown'

/**
 * Der Publikationsname aus Techmemes „Autor / Publikation".
 *
 * Ungeteilt landete in der Queue eine Quelle namens „Patrick Howell O'Neill /
 * Bloomberg" — und die Quellenverteilung zählte jeden Autor als eigenes Haus.
 */
export function publicationLabel(raw: string): string {
  const teile = raw.split('/').map((t) => t.trim()).filter(Boolean)
  return teile.length > 0 ? teile[teile.length - 1] : raw.trim()
}

/**
 * Stabiler Schlüssel einer Story.
 *
 * Bewusst aus der Überschrift und nicht aus dem Permalink: Techmeme vergibt
 * Permalinks je Seitenposition, dieselbe Meldung bekommt über den Tag hinweg
 * eine andere. Die Überschrift bleibt.
 */
export function storyKeyFor(story: TechmemeStory): string {
  return story.headline
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

export interface QueueItemInput {
  story: TechmemeStory
  source: TechmemeSource
  /** Position in Techmemes Reihenfolge — 0 ist die Hauptmeldung. */
  rank: number
  /** Position der Story auf der Startseite, 0 = ganz oben. */
  storyIndex: number
  /** Wie viele Stories die Startseite hatte. */
  totalStories: number
  text: string
  /** Titel, wie die Publikation selbst ihn nennt. */
  title: string | null
  mode: FetchMode
  publishedAt: string | null
  /** Gehört die Story zu den Themen des Tages? */
  istThema?: boolean
}

export interface TechmemeQueueItem {
  title: string
  excerpt: string
  content: string
  sourceUrl: string
  sourceEmail: null
  /** Techmeme nennt die Publikation im Klartext — sonst stünde in der Queue
   *  nur die Domain. */
  sourceDisplayName: string
  /** 'topic' für die obersten Stories des Tages, sonst nichts. */
  bundleType: 'topic' | null
  /** Themen starten direkt auf 'selected' — Betreiber-Vorgabe „vollautomatisch
   *  bis in den Post". */
  status: 'pending' | 'selected'
  emailReceivedAt: string | null
  contentLength: number
  /**
   * Techmemes Kuration als Bewertung — alle drei Felder bekommen denselben
   * Wert.
   *
   * Die Felder trennen drei Dimensionen, die die eigene Synthese-Pipeline
   * getrennt ermittelt. Für Techmeme haben wir nur EIN Urteil, und es auf drei
   * Dimensionen aufzuteilen täuschte eine Genauigkeit vor, die es nicht gibt.
   * Gleiche Werte ergeben in der Formel
   * (synthesis*0.4 + relevance*0.3 + uniqueness*0.3) genau diesen Wert.
   */
  synthesisScore: number
  relevanceScore: number
  uniquenessScore: number
  metadata: Record<string, unknown>
}

const EXCERPT_LENGTH = 400

export function buildQueueItem(input: QueueItemInput): TechmemeQueueItem {
  const { story, source, rank, storyIndex, totalStories, text, title, mode, publishedAt, istThema } = input
  const publikation = publicationLabel(source.publication)

  // Die BREITE zaehlt alle Quellen der Story, nicht nur die verarbeiteten:
  // Wie viele Haeuser berichten, ist Techmemes Urteil — dass wir davon zehn
  // lesen, ist unsere Begrenzung und sagt ueber die Meldung nichts aus.
  const score = curationScore({ storyIndex, totalStories, sourceCount: story.sources.length, rank })

  // Der Titel der Publikation ist genauer als Techmemes Zusammenfassung —
  // Techmeme formuliert Überschriften um. Fehlt er, ist Techmemes besser als
  // gar keiner.
  const überschrift = (title && title.trim().length >= 15 ? title.trim() : story.headline)

  return {
    title: überschrift,
    excerpt: text.slice(0, EXCERPT_LENGTH).trim(),
    content: text,
    sourceUrl: source.url,
    sourceEmail: null,
    sourceDisplayName: publikation,
    bundleType: istThema ? 'topic' : null,
    status: istThema ? 'selected' : 'pending',
    emailReceivedAt: publishedAt,
    contentLength: text.length,
    synthesisScore: score,
    relevanceScore: score,
    uniquenessScore: score,
    metadata: {
      techmeme: true,
      techmeme_story: storyKeyFor(story),
      techmeme_headline: story.headline,
      techmeme_permalink: story.permalink,
      techmeme_rank: rank,
      techmeme_story_index: storyIndex,
      techmeme_source_count: story.sources.length,
      techmeme_curation_score: score,
      techmeme_publication: publikation,
      fetch_mode: mode,
    },
  }
}

/**
 * Quellen, die noch nicht in der Queue stehen.
 *
 * Techmeme-Stories bleiben über Stunden auf der Startseite. Ohne diesen Abgleich
 * legte jeder Lauf dieselben Artikel erneut an — und weil der Vergleich
 * NORMALISIERT läuft, hilft er auch dann, wenn Techmeme die Adresse beim
 * nächsten Mal mit anderem Parameter verlinkt.
 */
export function filterKnownSources(sources: TechmemeSource[], knownUrls: string[]): TechmemeSource[] {
  const bekannt = new Set(knownUrls.map(normalizeArticleUrl))
  const out: TechmemeSource[] = []
  for (const s of sources) {
    const key = normalizeArticleUrl(s.url)
    if (bekannt.has(key)) continue
    bekannt.add(key)
    out.push(s)
  }
  return out
}
