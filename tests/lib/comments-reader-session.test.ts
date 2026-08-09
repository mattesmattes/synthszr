/**
 * Reader-Session: der langlebige Kommentar-Cookie.
 *
 * Er ist KOMFORT, kein Sicherheitsanker (Design 2026-08-09): jede
 * Schreibaktion läuft zusätzlich durch Rate-Limit und Moderation. Trotzdem
 * muss die Signatur halten — ein fälschbarer Cookie hieße, beliebige
 * subscriber_ids als Absender ausgeben zu können.
 *
 * Stateless per HMAC statt einer Session-Tabelle: anders als Admin-Sessions
 * (revozierbar, hochprivilegiert) gibt es hier nichts zu revozieren, was nicht
 * ohnehin die Moderation abfängt — und der Newsletter-Versand soll nicht für
 * jeden Leser eine Session-Zeile anlegen.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'

// Der Signierschlüssel wird aus SUPABASE_SERVICE_ROLE_KEY abgeleitet — der ist
// server-only und in jeder Umgebung vorhanden, es braucht keine neue Env-Var.
beforeEach(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key-material')
})

describe('reader session', () => {
  it('rundreist: sealen und wieder öffnen liefert die subscriber_id', async () => {
    const { sealReaderSession, openReaderSession } = await import('@/lib/comments/reader-session')
    const sealed = sealReaderSession('sub-123', new Date(Date.now() + 86400_000))
    expect(openReaderSession(sealed)).toEqual({ subscriberId: 'sub-123' })
  })

  it('lehnt einen manipulierten Wert ab', async () => {
    const { sealReaderSession, openReaderSession } = await import('@/lib/comments/reader-session')
    const sealed = sealReaderSession('sub-123', new Date(Date.now() + 86400_000))
    // Die ID steht base64-kodiert im ersten Segment — genau dort manipulieren.
    // (Erste Testfassung ersetzte 'sub-123' im Klartext und griff ins Leere:
    // der Wert blieb gueltig und der Test fiel um. Die Manipulation muss den
    // tatsaechlich signierten Teil treffen.)
    const parts = sealed.split('.')
    parts[0] = Buffer.from('sub-999', 'utf8').toString('base64url')
    expect(openReaderSession(parts.join('.'))).toBeNull()
  })

  it('lehnt eine nach hinten manipulierte Ablaufzeit ab', async () => {
    const { sealReaderSession, openReaderSession } = await import('@/lib/comments/reader-session')
    const sealed = sealReaderSession('sub-123', new Date(Date.now() - 1000))
    // Abgelaufen — Angreifer schiebt das Ablaufdatum nach hinten.
    const parts = sealed.split('.')
    parts[1] = String(Math.floor(Date.now() / 1000) + 999999)
    expect(openReaderSession(parts.join('.'))).toBeNull()
  })

  it('lehnt einen abgelaufenen Wert ab', async () => {
    const { sealReaderSession, openReaderSession } = await import('@/lib/comments/reader-session')
    const sealed = sealReaderSession('sub-123', new Date(Date.now() - 1000))
    expect(openReaderSession(sealed)).toBeNull()
  })

  it('verkraftet Müll ohne Wurf', async () => {
    const { openReaderSession } = await import('@/lib/comments/reader-session')
    expect(openReaderSession('')).toBeNull()
    expect(openReaderSession('kein.gueltiger.wert')).toBeNull()
    expect(openReaderSession('a')).toBeNull()
  })

  it('verkraftet eine subscriber_id mit Punkt nicht falsch', async () => {
    // Der Separator ist '.', eine UUID enthält keinen — aber die Funktion darf
    // bei unerwartetem Input nicht die falsche ID liefern.
    const { sealReaderSession, openReaderSession } = await import('@/lib/comments/reader-session')
    const sealed = sealReaderSession('id.mit.punkt', new Date(Date.now() + 86400_000))
    const opened = openReaderSession(sealed)
    // Entweder korrekt rundgereist oder abgelehnt — nie eine verstümmelte ID.
    if (opened) expect(opened.subscriberId).toBe('id.mit.punkt')
  })
})
