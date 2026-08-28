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
 * Speicher-Ebene VOR Redis, damit eine warme Function-Instanz nicht fuer jede
 * Seite erneut Redis fragt.
 *
 * Vorher lag die einzige Speicher-Ebene (withTtlCache in terms.ts) HINTER
 * dieser Schicht, also im Loader — dort spart sie nichts mehr, weil Redis
 * bereits geantwortet hat. Eine Begriffsseite kostete drei Redis-Commands
 * (Begriffsliste, Chart-Produkte, Matcher-Liste). Bei 2360 Begriffen x 5
 * Sprachen sind das 35.400 pro Vollcrawl; das Upstash-Kontingent von 500.000
 * Commands im Monat war damit nach 14 Crawls erschoepft — eingetreten am
 * 28.08.2026, seitdem lief alles ungecacht gegen Supabase.
 *
 * 60 Sekunden, nicht die vollen 60 Minuten von Redis: Die Ebenen verketten
 * sich, ein aus Redis geholter Wert kann selbst fast eine Stunde alt sein. Kurz
 * gehalten bleibt der schlimmste Fall bei 1h+1min statt 2h, und die Ersparnis
 * ist praktisch dieselbe — ein Crawler mit 100 Seiten pro Minute braucht damit
 * einen Redis-Zugriff statt 300.
 */
const MEMORY_TTL_MS = 60 * 1000
const memory = new Map<string, { value: unknown; expiresAt: number }>()

function remember(key: string, value: unknown): void {
  memory.set(key, { value, expiresAt: Date.now() + MEMORY_TTL_MS })
}

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
  // Egress erhoeht statt ihn zu senken (Build-Befund 2026-08-20, am 28.08.2026
  // erneut nachgemessen: "couldn't be rendered statically because it used
  // no-store fetch"; /[lang]/glossary faellt von ● auf ƒ).
  //
  // KEHRSEITE, die einmal teuer war: Next legt damit die Upstash-ANTWORTEN im
  // Vercel Data Cache ab — auch die Fehlerantworten. Als das Upstash-Kontingent
  // am 28.08.2026 erschoepft war, bekam die Function die Fehlermeldung danach
  // dauerhaft serviert, mit identischer "Usage: 500000"-Zahl, obwohl Upstash
  // nach dem Plan-Upgrade laengst wieder antwortete. Der Data Cache ueberlebt
  // Deployments; geholfen hat erst `vercel cache purge --type data`.
  //
  // Merkmal fuer die Diagnose: Ein direkter Redis-Zugriff von aussen (Skript,
  // lokal) funktioniert, die Function meldet weiter denselben Fehler mit
  // GLEICHBLEIBENDER Zahl. lib/health/cache-check.ts prueft deshalb mit einem
  // eigenen Client OHNE diese Option und per Schreib-Lese-Roundtrip.
  client = new Redis({ url, token, cache: 'force-cache' })
  return client
}

/**
 * Holt mehrere Schluessel in EINEM Redis-Kommando (MGET) in die Speicher-Ebene.
 *
 * Eine Begriffsseite braucht drei Eintraege: Begriffsliste, Chart-Produkte,
 * Matcher-Liste. Als drei getrennte withSharedCache-Aufrufe sind das drei
 * Kommandos. Vorgewaermt ist es eines — die drei Aufrufe treffen danach den
 * Speicher und fragen Redis nicht mehr.
 *
 * Bewusst KEIN gemeinsamer Schluessel fuer die drei: Der Lexikon-Index und die
 * Sitemap brauchen nur die Begriffsliste. Ein Buendel wuerde ihnen die anderen
 * beiden aufzwingen — mehr Bytes fuer weniger Kommandos, bei 2360 Begriffen ein
 * schlechter Tausch.
 *
 * Reine Optimierung: Jeder Fehler bleibt folgenlos, die Einzelaufrufe holen den
 * Wert dann eben selbst.
 */
export async function prewarmSharedCache(rawKeys: string[]): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  const now = Date.now()
  const keys = rawKeys
    .map((k) => `${NAMESPACE}:${k}`)
    .filter((k) => {
      const mem = memory.get(k)
      return !(mem && mem.expiresAt > now)
    })
  if (keys.length === 0) return

  try {
    const values = await redis.mget<unknown[]>(keys)
    keys.forEach((key, i) => {
      const value = values?.[i]
      // Nur echte Treffer merken. Was in Redis steht, hat isCacheable beim
      // Schreiben bereits passiert — hier ist keine erneute Pruefung noetig.
      if (value !== null && value !== undefined) remember(key, value)
    })
  } catch (err) {
    console.warn('[GlossaryCache] Vorwaermen fehlgeschlagen:', err instanceof Error ? err.message : err)
  }
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

  const mem = memory.get(key)
  if (mem && mem.expiresAt > Date.now()) return mem.value as T

  try {
    const hit = await redis.get<T>(key)
    if (hit !== null && hit !== undefined) {
      if (isCacheable(hit)) remember(key, hit)
      return hit
    }
  } catch (err) {
    console.warn('[GlossaryCache] Lesen fehlgeschlagen, gehe an die DB:', err instanceof Error ? err.message : err)
    return load()
  }

  const value = await load()
  if (isCacheable(value)) {
    remember(key, value)
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
