/**
 * Tages-Ampel fuer den News-Nachschub im Admin.
 *
 * WARUM ES DAS GIBT (Befund 2026-08-23): Der Newsletter-Abruf lief um 03:46 und
 * sammelte NULL Artikel — die Newsletter kamen an dem Tag erst gegen 07:00. Der
 * Scheduler verbuchte den leeren Lauf als Erfolg (null Artikel sind formal kein
 * Fehler) und sperrte damit jeden weiteren Versuch des Tages. Ohne Quellmaterial
 * fiel die Tagesanalyse aus, und weil die Post-Erzeugung an ihr haengt, entstand
 * kein Artikel. Bemerkt wurde es erst, als der Betreiber den fehlenden Post suchte.
 */

export interface FetchStatusInput {
  /** Eingesammelte Quellartikel heute (daily_repo). */
  articleCount: number
  /** Daraus verarbeitete News heute (news_queue) — die Groesse, die zaehlt. */
  processedCount: number
  lastNewsletterFetch: string | null
  lastWebcrawl: string | null
  now?: Date
  /** Zeitzone des Zeitplans (schedule_config.timezone); Default Berlin.
   *  Befund 2026-11-01: mit Zeitplan Asia/Shanghai lief der Abruf um 04:11
   *  Ortszeit, die Ampel rechnete „heute" in Berlin und meldete „kein Abruf". */
  tz?: string
}

export interface FetchStatus {
  articleCount: number
  processedCount: number
  level: 'gruen' | 'gelb' | 'rot'
  lastFetchLabel: string
  lastWebcrawlLabel: string
  tz: string
}

/**
 * Schwellen, gemessen ueber 11 Tage (verarbeitete News je Tag):
 *   normale Werktage 573-844 (Median 699)
 *   Sonntag 16.08.   297   -> ruhig, aber voellig in Ordnung
 *   22.08.            81   -> der Tag, an dem der Abruf ausfiel
 *
 * GRUEN ab 250: deckt auch ruhige Sonntage ab. Eine hoehere Schwelle haette
 * jeden Sonntag grundlos Alarm geschlagen — eine Ampel, die regelmaessig ohne
 * Anlass warnt, wird ignoriert und ist dann wertlos.
 * GELB ab 50: auffaellig wenig, aber es laeuft etwas.
 * ROT darunter: der Tagesartikel ist in Gefahr.
 */
const GRUEN_AB = 250
const GELB_AB = 50

const DEFAULT_TZ = 'Europe/Berlin'
const dayIn = (d: Date, tz: string) => d.toLocaleDateString('en-CA', { timeZone: tz })

/** „HH:MM" wenn der Zeitpunkt heute (in der Zone) liegt, sonst der Hinweis auf das Fehlen. */
function label(iso: string | null, now: Date, tz: string): string {
  if (!iso) return 'noch kein Abruf heute'
  const d = new Date(iso)
  if (dayIn(d, tz) !== dayIn(now, tz)) return 'noch kein Abruf heute'
  return d.toLocaleTimeString('de-DE', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
}

export function buildFetchStatus(input: FetchStatusInput): FetchStatus {
  const now = input.now ?? new Date()
  const tz = input.tz ?? DEFAULT_TZ
  // Ohne eingesammelte Artikel ist der Tag unabhaengig von allem anderen rot:
  // genau diese Null hat am 2026-08-23 den Artikel gekostet.
  const level: FetchStatus['level'] =
    input.articleCount === 0 ? 'rot'
    : input.processedCount >= GRUEN_AB ? 'gruen'
    : input.processedCount >= GELB_AB ? 'gelb'
    : 'rot'

  return {
    articleCount: input.articleCount,
    processedCount: input.processedCount,
    level,
    lastFetchLabel: label(input.lastNewsletterFetch, now, tz),
    lastWebcrawlLabel: label(input.lastWebcrawl, now, tz),
    tz,
  }
}
