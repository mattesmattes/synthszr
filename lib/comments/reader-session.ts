/**
 * Reader-Session: der langlebige Kommentar-Cookie („einmal verifiziert,
 * 90 Tage schreiben").
 *
 * KOMFORT, KEIN SICHERHEITSANKER (Design 2026-08-09): jede Schreibaktion läuft
 * zusätzlich durch Rate-Limit und Moderation. Deshalb stateless per HMAC statt
 * einer Session-Tabelle — anders als Admin-Sessions gibt es hier nichts zu
 * revozieren, was nicht ohnehin die Moderation abfängt, und der Wert trägt
 * keinerlei Privileg außer „darf einen Kommentar zur Prüfung einreichen".
 *
 * Der Signierschlüssel wird per HMAC aus SUPABASE_SERVICE_ROLE_KEY abgeleitet
 * (Domain-Separation über ein festes Label). Das vermeidet eine neue Env-Var,
 * die in Vercel UND lokal gepflegt werden müsste; der Service-Role-Key ist
 * server-only und in jeder Umgebung vorhanden. Server-only-Modul — nie aus
 * einer Client-Komponente importieren.
 */
import { createHmac, timingSafeEqual } from 'crypto'

export const READER_COOKIE_NAME = 'synthszr_reader'
export const READER_SESSION_TTL_SECONDS = 90 * 24 * 60 * 60

function signingKey(): Buffer {
  const material = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  // Ableitung statt Direktnutzung: der abgeleitete Schlüssel ist nutzlos für
  // die Supabase-API, ein Leck des Cookies verrät nichts über den Root-Key.
  return createHmac('sha256', material).update('synthszr-reader-session-v1').digest()
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url')
}

/**
 * Versiegelt eine subscriber_id mit Ablaufzeit. Format:
 * base64url(subscriberId).expiresEpoch.signatur — die ID ist base64-kodiert,
 * damit der Punkt-Separator nie mit ID-Inhalten kollidiert.
 */
export function sealReaderSession(subscriberId: string, expiresAt: Date): string {
  const payload = `${Buffer.from(subscriberId, 'utf8').toString('base64url')}.${Math.floor(expiresAt.getTime() / 1000)}`
  return `${payload}.${sign(payload)}`
}

/** Öffnet einen versiegelten Wert. Null bei Manipulation, Ablauf oder Müll. */
export function openReaderSession(sealed: string): { subscriberId: string } | null {
  const parts = sealed.split('.')
  if (parts.length !== 3) return null
  const [idPart, expPart, sig] = parts
  const payload = `${idPart}.${expPart}`

  const expected = sign(payload)
  // Längen-Check vor timingSafeEqual: die Funktion wirft bei ungleicher Länge.
  const sigBuf = Buffer.from(sig, 'utf8')
  const expBuf = Buffer.from(expected, 'utf8')
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null

  const expires = Number(expPart)
  if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return null

  try {
    return { subscriberId: Buffer.from(idPart, 'base64url').toString('utf8') }
  } catch {
    return null
  }
}
