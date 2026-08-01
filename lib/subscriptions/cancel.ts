import type { UnsubscribeType } from '@/lib/subscriptions/types'

/**
 * Führt einen serverseitigen Auto-Unsubscribe aus — NUR für 'oneclick' (POST) und
 * 'http' (GET). Andere Typen (mailto/login_portal/unknown) werden im Browser des
 * Nutzers erledigt und geben hier ok=false zurück (kein serverseitiger Request).
 */
export async function executeAutoUnsubscribe(
  type: UnsubscribeType,
  target: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; detail: string }> {
  try {
    if (type === 'oneclick') {
      const res = await fetchFn(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      })
      return { ok: res.ok, detail: `POST ${res.status}` }
    }
    if (type === 'http') {
      const res = await fetchFn(target, { method: 'GET' })
      return { ok: res.ok, detail: `GET ${res.status}` }
    }
    return { ok: false, detail: `Typ ${type} nicht serverseitig kündbar` }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'Request-Fehler' }
  }
}
