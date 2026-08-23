/**
 * Tages-Fetchstand fuer das Banner im Admin.
 *
 * WARUM ES DAS GIBT (Befund 2026-08-23, Sonntag): Der Newsletter-Abruf lief um
 * 03:46 und sammelte NULL Artikel. Der Scheduler verbuchte das als Erfolg —
 * `if (fetchResult.success) markTaskRun(...)`, und null Artikel sind formal kein
 * Fehler. Danach sperrte hasRunToday jeden weiteren Versuch fuer den restlichen
 * Tag. Ohne Quellmaterial scheiterte die Tagesanalyse, und weil die
 * Post-Erzeugung an ihr haengt (results.postGeneration =
 * 'skipped_dependency_failed'), entstand kein Artikel. Bemerkt wurde es erst,
 * als der Betreiber den fehlenden Post suchte.
 *
 * Die Trennung von Zahl und Bewertung steckt hier, damit sie pruefbar ist: NULL
 * gesammelte Artikel ist der Warnfall, nicht eine unauffaellige Null.
 */
export interface FetchStatusInput {
  articleCount: number
  lastNewsletterFetch: string | null
  lastWebcrawl: string | null
  now?: Date
}

export interface FetchStatus {
  articleCount: number
  level: 'ok' | 'warn'
  lastFetchLabel: string
  lastWebcrawlLabel: string
}

const TZ = 'Europe/Berlin'
const dayIn = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })

/** „HH:MM" wenn der Zeitpunkt heute liegt, sonst der Hinweis auf das Fehlen. */
function label(iso: string | null, now: Date): string {
  if (!iso) return 'noch kein Abruf heute'
  const d = new Date(iso)
  if (dayIn(d) !== dayIn(now)) return 'noch kein Abruf heute'
  return d.toLocaleTimeString('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
}

export function buildFetchStatus(input: FetchStatusInput): FetchStatus {
  const now = input.now ?? new Date()
  return {
    articleCount: input.articleCount,
    // Nur die Menge entscheidet: ein Abruf, der nichts einsammelt, ist genau der
    // Fall, der den Tagesartikel gekostet hat.
    level: input.articleCount > 0 ? 'ok' : 'warn',
    lastFetchLabel: label(input.lastNewsletterFetch, now),
    lastWebcrawlLabel: label(input.lastWebcrawl, now),
  }
}
