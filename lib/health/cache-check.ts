import { Redis } from '@upstash/redis'

/**
 * Prueft, ob der geteilte Cache (Upstash Redis) noch wirklich arbeitet.
 *
 * Anlass 28.08.2026: Das Kontingent von 500.000 Kommandos im Monat war
 * erschoepft, `withSharedCache` fiel bei jedem Zugriff auf die Datenbank
 * zurueck — und das TAGELANG unbemerkt. Funktional faellt das nicht auf, der
 * Fallback greift sauber; nur der Supabase-Egress steigt still wieder an, gegen
 * den dieser Cache ueberhaupt gebaut wurde. Entdeckt wurde es zufaellig bei der
 * Suche nach einem ganz anderen Fehler.
 *
 * WARUM EIN EIGENER CLIENT OHNE `cache: 'force-cache'`:
 * lib/cache/shared-cache.ts MUSS diese Option setzen, sonst fallen
 * /[lang]/glossary und /sitemap.xml von ISR auf dynamisch (im Build am
 * 28.08.2026 nachgemessen: "couldn't be rendered statically because it used
 * no-store fetch"). Die Option hat aber eine Kehrseite — Next legt die
 * Upstash-ANTWORTEN im Vercel Data Cache ab, auch die Fehlerantworten. Genau
 * das passierte: Nach dem Plan-Upgrade nahm Upstash wieder Kommandos an, die
 * Function bekam trotzdem weiter die eingefrorene Fehlermeldung serviert, mit
 * identischer Zahl. Erst `vercel cache purge --type data` loeste es.
 *
 * Wuerde diese Pruefung denselben Client benutzen, saehe sie dieselbe
 * eingefrorene Antwort und meldete faelschlich "gesund". Die Cron-Route ist
 * ohnehin dynamisch, ein no-store-Fetch stoert dort nicht.
 *
 * WARUM ROUNDTRIP STATT PING: Ein PING beweist nur, dass der Host antwortet.
 * Schreiben und Zuruecklesen deckt zusaetzlich den Fall ab, dass Antworten
 * eingefroren sind — dann kommt etwas anderes zurueck als eben geschrieben.
 *
 * Kosten: zwei Kommandos je Lauf, bei alle vier Stunden rund 360 im Monat.
 */
export interface CacheHealth {
  healthy: boolean
  error?: string
}

const PROBE_KEY = 'health:cache-probe'

export async function checkSharedCache(): Promise<CacheHealth> {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    // Bewusst ungesund: In Produktion ist ein fehlender Cache kein Normalzustand,
    // sondern genau die Stoerung, die hier auffallen soll.
    return { healthy: false, error: 'Upstash nicht konfiguriert' }
  }

  const redis = new Redis({ url, token })
  const marke = `probe-${Date.now()}`

  try {
    await redis.set(PROBE_KEY, marke, { ex: 300 })
  } catch (err) {
    return { healthy: false, error: `Schreiben fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}` }
  }

  let zurueck: unknown
  try {
    zurueck = await redis.get(PROBE_KEY)
  } catch (err) {
    return { healthy: false, error: `Lesen fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}` }
  }

  if (zurueck !== marke) {
    return {
      healthy: false,
      error: `Roundtrip gescheitert: geschrieben "${marke}", zurueckgelesen "${String(zurueck)}" — deutet auf eingefrorene Antworten im Data Cache (vercel cache purge --type data)`,
    }
  }

  return { healthy: true }
}
