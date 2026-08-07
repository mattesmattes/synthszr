/**
 * Transiente von endgültigen Fehlschlägen unterscheiden.
 *
 * PROD-BEFUND 2026-08-05:
 *   [Glossary] Begriffs-Generierung für "Feature Engineering" fehlgeschlagen:
 *   Error: 529 {"type":"overloaded_error","message":"Overloaded"}
 *   headers: { 'x-should-retry': 'true', 'retry-after': '0' }
 *
 * Der Crawl markierte den Begriff daraufhin als erledigt und nahm ihn aus der
 * Warteschlange — die Regel dahinter ("ein Name, der zweimal scheitert, würde
 * sonst jeden Lauf teure Calls verbrauchen") ist für INHALTLICHE Fehlschläge
 * richtig, bei einer vorübergehenden Überlast kostet sie den Begriff dauerhaft.
 */
import { describe, expect, it } from 'vitest'
import { isRetryableModelError, isRequestConfigError } from '@/lib/glossary/retryable'

function apiError(status: number, message = 'boom'): Error {
  const e = new Error(`${status} ${message}`) as Error & { status?: number }
  e.status = status
  return e
}

describe('isRetryableModelError', () => {
  it('erkennt 529 Overloaded als wiederholbar', () => {
    expect(isRetryableModelError(apiError(529, 'overloaded_error'))).toBe(true)
  })

  it('erkennt 429 Rate Limit als wiederholbar', () => {
    expect(isRetryableModelError(apiError(429))).toBe(true)
  })

  it('erkennt 500, 502, 503 als wiederholbar', () => {
    for (const s of [500, 502, 503, 504]) {
      expect(isRetryableModelError(apiError(s))).toBe(true)
    }
  })

  it('erkennt 400 NICHT als wiederholbar', () => {
    // Ein fehlerhafter Request wird beim zweiten Versuch genauso scheitern —
    // und die 2026er-Modelle antworten auf temperature+budget_tokens mit 400.
    expect(isRetryableModelError(apiError(400))).toBe(false)
  })

  it('erkennt 401 und 403 NICHT als wiederholbar', () => {
    expect(isRetryableModelError(apiError(401))).toBe(false)
    expect(isRetryableModelError(apiError(403))).toBe(false)
  })

  it('erkennt einen inhaltlichen Fehlschlag NICHT als wiederholbar', () => {
    // Regel 4: unter 400 Wörtern auch nach Nachforderung. Ein zweiter Versuch
    // wäre reine Geldverbrennung.
    expect(isRetryableModelError(new Error('Begriff bleibt unter 400 Wörtern'))).toBe(false)
  })

  it('erkennt Overloaded auch ohne status-Feld, am Text', () => {
    // Fehler, die durch mehrere Schichten gereicht wurden, verlieren das
    // status-Feld und behalten nur die Meldung.
    expect(isRetryableModelError(new Error('529 overloaded_error: Overloaded'))).toBe(true)
  })

  it('erkennt Netzwerkabbrüche als wiederholbar', () => {
    expect(isRetryableModelError(new Error('fetch failed'))).toBe(true)
    expect(isRetryableModelError(new Error('ECONNRESET'))).toBe(true)
  })

  it('verkraftet null und Nicht-Fehler', () => {
    expect(isRetryableModelError(null)).toBe(false)
    expect(isRetryableModelError('irgendwas')).toBe(false)
  })

// PROD-BEFUND 2026-08-07: ein HTTP 400 wegen eines falschen Request-Parameters
// (thinking.type.disabled bei Fable 5) kam mit x-should-retry:false und galt
// deshalb als endgueltiger Fehlschlag DES BEGRIFFS. generateCandidates hakte
// daraufhin 100 einwandfreie Kandidaten als erledigt ab und nahm sie aus der
// Warteschlange — sie waeren ohne manuelles Zuruecksetzen nie wieder erzeugt
// worden. "Nicht wiederholbar" heisst eben nicht "Begriff untauglich".
describe('isRequestConfigError', () => {
  it('erkennt einen 400 invalid_request_error', () => {
    expect(isRequestConfigError({ status: 400, error: { error: { type: 'invalid_request_error' } } })).toBe(true)
  })

  it('erkennt ihn auch, wenn nur die Meldung durchgereicht wurde', () => {
    expect(isRequestConfigError(new Error('400 {"type":"error","error":{"type":"invalid_request_error"}}'))).toBe(true)
  })

  it('haelt eine Ueberlast NICHT fuer einen Konfigurationsfehler', () => {
    expect(isRequestConfigError({ status: 529 })).toBe(false)
  })

  it('haelt einen inhaltlichen Fehlschlag NICHT dafuer — der Begriff bleibt untauglich', () => {
    expect(isRequestConfigError(new Error('Begriff zu kurz nach Regel 4'))).toBe(false)
  })

  it('verkraftet null und Nicht-Fehler', () => {
    expect(isRequestConfigError(null)).toBe(false)
    expect(isRequestConfigError('irgendwas')).toBe(false)
  })
})
})
