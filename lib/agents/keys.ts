/**
 * Agenten-Schlüssel. Der Klartext (`sk_agent_` + 32 Byte base64url) erscheint
 * genau einmal in der Register-Antwort; die DB kennt nur den SHA-256 und die
 * ersten acht Zeichen nach dem Präfix (Anzeige im Admin).
 */
import { createHash, randomBytes } from 'node:crypto'

export const AGENT_KEY_PREFIX = 'sk_agent_'

export function hashAgentKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function mintAgentKey(): { raw: string; hash: string; prefix: string } {
  const raw = `${AGENT_KEY_PREFIX}${randomBytes(32).toString('base64url')}`
  return { raw, hash: hashAgentKey(raw), prefix: raw.slice(AGENT_KEY_PREFIX.length, AGENT_KEY_PREFIX.length + 8) }
}

/** `Authorization: Bearer <key>` → key; alles andere null. */
export function bearerFrom(request: { headers: { get(name: string): string | null } }): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return m ? m[1] : null
}
