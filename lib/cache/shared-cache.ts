import { Redis } from '@upstash/redis'

/**
 * Instanzuebergreifende Cache-Schicht (Upstash Redis, REST) vor Voll-Katalog-Scans.
 *
 * Genutzt von den Lese-Pfaden des Lexikons (lib/glossary/terms.ts) und der
 * Produkt-Charts (lib/rankings/leaderboard.ts). Beide holten ihren gesamten
 * Katalog bei JEDEM Seitenrender neu aus der DB.
 *
 * WARUM ZUSAETZLICH ZUM TTL-CACHE IN terms.ts: der dortige `withTtlCache` ist
 * eine modulweite `Map` und lebt damit pro Function-Instanz. Next deployt jede
 * Route als eigene Function, und Instanzen starten kalt und werden recycelt —
 * Artikelseite, Begriffsseite, Lexikon-Index und Sitemap haben je einen eigenen,
 * anfangs leeren Cache. Deshalb blieb der Supabase-Egress nach seiner
 * Einfuehrung (2026-08-19) unveraendert bei 50-125 GB/Tag; gemessen kostet ein
 * Fehltreffer 1,18 MB (getMatcherTerms 463 KB + getPublishedTermList 710 KB bei
 * 2178 Begriffen). Redis liegt ausserhalb der Instanz und wird von allen geteilt.
 *
 * NUR FUER LESE-PFADE. Die Schreib-/Job-Pfade (confirm, crawl, translate,
 * backfill, article-jobs, jobs/advance, wrapup) duerfen diese Schicht NICHT
 * benutzen: `lib/glossary/confirm.ts` holt die Matcher-Liste bewusst DIREKT NACH
 * dem Publish-Update, damit der frisch bestaetigte Begriff darin vorkommt (s.
 * Kommentar dort). Ein wirksamer, geteilter Cache wuerde genau diesen Regelfall
 * zuverlaessig brechen — der neue Begriff bliebe eine Stunde lang unverlinkt.
 * Der In-Memory-Cache bricht ihn heute schon, aber nur sporadisch, weil er kaum
 * trifft; wirksam gemacht waere daraus ein verlaesslicher Fehler.
 *
 * Credential-Namen wie in lib/rate-limit.ts: die Vercel-Upstash-Integration legt
 * KV_REST_API_*, ein direktes Upstash-Projekt UPSTASH_REDIS_REST_* an.
 */

const TTL_SECONDS = 60 * 60

/**
 * Schluessel-Namensraum je Umgebung. Ohne ihn schreiben lokale Entwicklung,
 * Preview-Deployments und Tests in DIESELBEN Schluessel wie Produktion — alle
 * lesen .env.local bzw. dieselbe Upstash-Instanz.
 *
 * Das ist nicht theoretisch: am 2026-08-20 hat ein Testlauf (der Supabase mockt)
 * `glossary:v1:matcher:de` mit einem einzigen Fixture-Begriff ueberschrieben,
 * wo 2187 stehen. Ein geteilter Cache verteilt so ein Teilergebnis an ALLE
 * Instanzen und ueberlebt Deployments — der alte In-Memory-Cache haette den
 * Schaden auf eine Instanz begrenzt. tests/setup.ts entfernt die Credentials
 * inzwischen zusaetzlich; dieser Namensraum ist die zweite, strukturelle Sperre.
 */
const NAMESPACE = process.env.VERCEL_ENV || 'local'

let client: Redis | null = null
let missingConfigLogged = false

function getRedis(): Redis | null {
  if (client) return client
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    if (!missingConfigLogged) {
      missingConfigLogged = true
      // Kein Fehler: ohne Upstash laeuft alles wie vorher, nur ohne den
      // geteilten Cache. Lokal und in Tests ist das der Normalfall.
      if (process.env.NODE_ENV === 'production') {
        console.warn('[GlossaryCache] Upstash nicht konfiguriert — Begriffslisten laufen ungecacht gegen die DB.')
      }
    }
    return null
  }
  // cache: der Upstash-Client fetcht per Default mit `no-store`. In Next macht
  // ein no-store-Fetch die umgebende Route DYNAMISCH — /[lang]/glossary und
  // /sitemap.xml fielen dadurch von ISR auf Rendern-pro-Request zurueck, was den
  // Egress erhoeht statt ihn zu senken (Build-Befund 2026-08-20).
  client = new Redis({ url, token, cache: 'force-cache' })
  return client
}

/**
 * Liefert den Wert aus Redis, sonst aus `load()` — und schreibt ihn dann zurueck.
 *
 * Jeder Redis-Fehler faellt still auf `load()` durch: ein gestoerter Cache darf
 * den Lesepfad nicht mitreissen. Nur Werte, die `isCacheable` passieren, werden
 * festgeschrieben — sonst wuerde ein transienter Lesefehler (`null`) oder eine
 * leere Liste fuer die volle TTL zementiert. Dieselbe Regel gilt schon fuer den
 * TTL-Cache in terms.ts.
 */
export async function withSharedCache<T>(
  rawKey: string,
  load: () => Promise<T>,
  isCacheable: (value: T) => boolean = (v) => v !== null,
): Promise<T> {
  const redis = getRedis()
  if (!redis) return load()

  const key = `${NAMESPACE}:${rawKey}`
  try {
    const hit = await redis.get<T>(key)
    if (hit !== null && hit !== undefined) return hit
  } catch (err) {
    console.warn('[GlossaryCache] Lesen fehlgeschlagen, gehe an die DB:', err instanceof Error ? err.message : err)
    return load()
  }

  const value = await load()
  if (isCacheable(value)) {
    try {
      await redis.set(key, value, { ex: TTL_SECONDS })
    } catch (err) {
      // Ergebnis steht schon fest — ein fehlgeschlagenes Zurueckschreiben kostet
      // nur den naechsten Fehltreffer, nicht diese Antwort.
      console.warn('[GlossaryCache] Schreiben fehlgeschlagen:', err instanceof Error ? err.message : err)
    }
  }
  return value
}
