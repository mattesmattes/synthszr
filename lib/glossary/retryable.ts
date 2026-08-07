/**
 * Unterscheidet vorübergehende von endgültigen Fehlschlägen bei Modell-Aufrufen.
 *
 * WARUM DAS NÖTIG IST (Prod-Befund 2026-08-05): die Begriffs-Erzeugung scheiterte
 * an einem 529 „Overloaded" — mit `x-should-retry: true` und `retry-after: 0`,
 * die API bat also ausdrücklich um Wiederholung. Der Crawl markierte den Begriff
 * daraufhin als erledigt und nahm ihn aus der Warteschlange.
 *
 * Diese Regel ist NICHT falsch, nur zu grob: bei einem inhaltlichen Fehlschlag
 * (zu kurz nach Regel 4, Slug-Kollision) ist ein zweiter Versuch reine
 * Geldverbrennung, und der Begriff muss aus der Schlange. Bei einer
 * vorübergehenden Überlast kostet dieselbe Regel den Begriff dauerhaft — er wird
 * nie wieder versucht, ohne dass es irgendwo auffällt.
 *
 * Deshalb hier die Unterscheidung, statt sie an jeder Aufrufstelle zu erraten.
 */

/** HTTP-Status, bei denen ein zweiter Versuch sinnvoll ist. */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529])

/** Textmuster für Fehler, die ihr status-Feld auf dem Weg verloren haben —
 *  durch mehrere Schichten gereicht bleibt oft nur die Meldung übrig. */
const RETRYABLE_PATTERNS = [
  /\b(429|500|502|503|504|529)\b/,
  /overloaded/i,
  /rate.?limit/i,
  /timeout|timed out/i,
  /fetch failed/i,
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up/i,
]

/**
 * Ein Fehler, der am REQUEST liegt und nicht am Begriff — HTTP 400
 * `invalid_request_error`.
 *
 * PROD-BEFUND 2026-08-07: claude-fable-5 lehnte `thinking.type.disabled` mit 400
 * und `x-should-retry: false` ab. Damit galt der Fehlschlag als endgültig, und
 * generateCandidates hakte 100 einwandfreie Kandidaten als erledigt ab und nahm
 * sie aus der Warteschlange — ohne manuelles Zurücksetzen wären sie nie wieder
 * erzeugt worden.
 *
 * „Nicht wiederholbar" heißt eben nicht „Begriff untauglich". Es gibt drei
 * Kategorien, nicht zwei:
 *
 *   vorübergehend (529, 429, Netz) -> Begriff bleibt, sofort neuer Versuch
 *   Request falsch (400)           -> Begriff bleibt, aber erst nach einem Fix
 *   inhaltlich (zu kurz, Kollision)-> Begriff raus, Wiederholung wäre teuer
 *
 * Der mittlere Fall ist unser Fehler, nicht seiner. Er darf den Kandidaten
 * nichts kosten. Damit ein solcher Lauf trotzdem nicht ewig kreist, greift die
 * bestehende Eskalation: nach zehn Durchgängen ohne Fortschritt gibt der Job
 * auf — mit einer sichtbaren Meldung statt stiller Verluste.
 */
export function isRequestConfigError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false

  const status = (err as { status?: unknown }).status
  if (status === 400) return true

  // Durch mehrere Schichten gereicht bleibt oft nur die Meldung übrig; das SDK
  // stellt ihr den Status voran ("400 {...invalid_request_error...}").
  const message = (err as { message?: unknown }).message
  if (typeof message === 'string') {
    return /invalid_request_error/.test(message) || /^400\b/.test(message)
  }
  return false
}

export function isRetryableModelError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false

  const status = (err as { status?: unknown }).status
  if (typeof status === 'number') {
    // Ein bekannter Status entscheidet allein — auch dann, wenn die Meldung
    // zufällig ein Muster von unten enthält.
    return RETRYABLE_STATUS.has(status)
  }

  const message = (err as { message?: unknown }).message
  if (typeof message !== 'string') return false
  return RETRYABLE_PATTERNS.some((re) => re.test(message))
}
