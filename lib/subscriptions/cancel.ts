import type { UnsubscribeType } from '@/lib/subscriptions/types'
import { safeFetch } from '@/lib/security/ssrf'

/**
 * Führt einen serverseitigen Auto-Unsubscribe aus — NUR für 'oneclick' (POST) und
 * 'http' (GET). Andere Typen (mailto/login_portal/unknown) werden im Browser des
 * Nutzers erledigt und geben hier ok=false zurück (kein serverseitiger Request).
 */
const FETCH_TIMEOUT_MS = 15_000

const defaultSafeFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  return safeFetch(url, { ...init, timeoutMs: FETCH_TIMEOUT_MS })
}

export async function executeAutoUnsubscribe(
  type: UnsubscribeType,
  target: string,
  fetchFn: typeof fetch = defaultSafeFetch,
): Promise<{ ok: boolean; detail: string }> {
  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return { ok: false, detail: 'Ungültige Ziel-URL' }
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, detail: 'Nur https-Ziel-URLs erlaubt' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    if (type === 'oneclick') {
      const res = await fetchFn(parsed.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
        signal: controller.signal,
      })
      return { ok: res.ok, detail: `POST ${res.status}` }
    }
    if (type === 'http') {
      const res = await fetchFn(parsed.toString(), { method: 'GET', signal: controller.signal })
      return { ok: res.ok, detail: `GET ${res.status}` }
    }
    return { ok: false, detail: `Typ ${type} nicht serverseitig kündbar` }
  } catch (e) {
    const isAbort = e instanceof Error && e.name === 'AbortError'
    return { ok: false, detail: isAbort ? 'Timeout/Request abgebrochen' : (e instanceof Error ? e.message : 'Request-Fehler') }
  } finally {
    clearTimeout(timer)
  }
}
