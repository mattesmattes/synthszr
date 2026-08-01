import type { UnsubscribeType } from '@/lib/subscriptions/types'

/**
 * Führt einen serverseitigen Auto-Unsubscribe aus — NUR für 'oneclick' (POST) und
 * 'http' (GET). Andere Typen (mailto/login_portal/unknown) werden im Browser des
 * Nutzers erledigt und geben hier ok=false zurück (kein serverseitiger Request).
 */
const FETCH_TIMEOUT_MS = 15_000

export async function executeAutoUnsubscribe(
  type: UnsubscribeType,
  target: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; detail: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    if (type === 'oneclick') {
      const res = await fetchFn(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
        signal: controller.signal,
      })
      return { ok: res.ok, detail: `POST ${res.status}` }
    }
    if (type === 'http') {
      const res = await fetchFn(target, { method: 'GET', signal: controller.signal })
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
