/**
 * Verfügbarkeits-Prüfung der öffentlichen Seiten.
 *
 * ANLASS (2026-08-25): Ein zu offener pnpm-Override zog nanoid 6 herein
 * (ESM-only), postcss lädt es per require() — jede serverseitig gerenderte
 * Seite starb mit ERR_REQUIRE_ESM. Alle Artikelseiten lieferten 500, und
 * aufgefallen ist es erst, als der Betreiber zufällig eine URL öffnete.
 */

export interface PageResult {
  url: string
  status: number
  ms: number
  error?: string
}

export interface HealthResult {
  healthy: boolean
  checked: number
  failed: PageResult[]
  results: PageResult[]
  checkedAt: string
}

/** 2xx und 3xx zählen als erreichbar; alles andere ist ein Ausfall. */
const isUp = (status: number) => status >= 200 && status < 400

export function evaluateHealth(results: PageResult[]): HealthResult {
  const failed = results.filter((r) => !isUp(r.status))
  return {
    healthy: failed.length === 0,
    checked: results.length,
    failed,
    results,
    checkedAt: new Date().toISOString(),
  }
}

/**
 * Mail nur bei ZUSTANDSWECHSEL.
 *
 * Alle vier Stunden dieselbe Ausfallmeldung wäre nach einem Tag Rauschen, und
 * Rauschen wird ignoriert. Gemeldet wird der Beginn eines Ausfalls und seine
 * Erholung — beides will man wissen, alles dazwischen nicht.
 */
export function shouldNotify(
  current: { healthy: boolean },
  previous: { healthy: boolean } | null,
): boolean {
  if (!previous) return !current.healthy
  return current.healthy !== previous.healthy
}

/**
 * Ruft jede URL einmal ab.
 *
 * `hc=<zeitstempel>` und `cache: 'no-store'` sind NICHT optional: ohne sie
 * beantwortet der Edge-Cache die Frage statt der Funktion. Am 2026-08-25 sahen
 * die Locale-Startseiten deshalb gesund aus (x-vercel-cache: STALE), während
 * die Render-Funktion längst bei jedem Aufruf starb.
 */
export async function checkPages(
  urls: string[],
  opts: { fetchImpl?: typeof fetch; now?: number; timeoutMs?: number } = {},
): Promise<PageResult[]> {
  const doFetch = opts.fetchImpl ?? fetch
  const stamp = opts.now ?? Date.now()
  const timeoutMs = opts.timeoutMs ?? 15_000

  return Promise.all(
    urls.map(async (url): Promise<PageResult> => {
      const sep = url.includes('?') ? '&' : '?'
      const target = `${url}${sep}hc=${stamp}`
      const t0 = Date.now()
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        const res = await doFetch(target, {
          cache: 'no-store',
          redirect: 'follow',
          signal: controller.signal,
          headers: { 'user-agent': 'synthszr-healthcheck' },
        })
        clearTimeout(timer)
        return { url, status: res.status, ms: Date.now() - t0 }
      } catch (err) {
        // Ein Netzwerkfehler ist ein Ausfall, kein Grund den Lauf abzubrechen:
        // sonst verdeckt die erste tote Seite den Zustand aller übrigen.
        return {
          url,
          status: 0,
          ms: Date.now() - t0,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }),
  )
}
