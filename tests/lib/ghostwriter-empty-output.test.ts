/**
 * PROD-BEFUND 2026-08-07: Der Tages-Artikel
 * "ki-wird-billiger-im-bauen-teurer-im-kontrollieren-…" erschien OHNE sein
 * Hauptthema. Fünf als "Thema des Tages" markierte Quellen (KI entwirft Viren)
 * waren korrekt in der Pipeline — im Job-State stand als erster Abschnitt aber
 * nur `"\n\n"`.
 *
 * Ursache war nicht die Bündel-Logik: callModelNonStreaming lieferte für den
 * Bündel-Call einen LEEREN String zurück, und der lief still durch die ganze
 * Nachbearbeitung bis in den gespeicherten Artikel. Der Betreiber sah einen
 * fertigen Artikel, dem das wichtigste Thema fehlte — ohne Fehler, ohne Log.
 *
 * Diese Tests pinnen, dass eine leere Modellantwort als Fehler behandelt wird.
 * Sichtbar scheitern ist hier zwingend besser: die Pipeline ersetzt einen
 * fehlgeschlagenen Abschnitt durch "*Fehler: …*" (s. Aufrufer), das fällt beim
 * Gegenlesen sofort auf.
 */
import { describe, expect, it } from 'vitest'
import { assertNonEmptyModelOutput } from '@/lib/claude/ghostwriter-pipeline'

describe('assertNonEmptyModelOutput', () => {
  it('reicht normalen Text unverändert durch', () => {
    expect(assertNonEmptyModelOutput('## Überschrift\n\nText.', 'bundle')).toBe('## Überschrift\n\nText.')
  })

  it('wirft bei leerem String', () => {
    expect(() => assertNonEmptyModelOutput('', 'bundle')).toThrow(/leere Antwort/i)
  })

  it('wirft bei reinem Whitespace — genau die Form, die in Prod ankam', () => {
    expect(() => assertNonEmptyModelOutput('\n\n', 'bundle')).toThrow(/leere Antwort/i)
  })

  it('nennt den Aufrufer, damit im Artikel steht, WELCHER Abschnitt fehlt', () => {
    expect(() => assertNonEmptyModelOutput('', 'Bündel "Thema des Tages"')).toThrow(/Bündel "Thema des Tages"/)
  })

  it('nennt den stop_reason, wenn bekannt — unterscheidet Budget-Ende von Verweigerung', () => {
    expect(() => assertNonEmptyModelOutput('', 'bundle', 'max_tokens')).toThrow(/max_tokens/)
  })

  // An Prod gemessen 2026-08-07: der Buendel-Call fuer die fuenf Quellen zum
  // Thema "KI entwirft Viren" kommt mit stop_reason='refusal' und 0 Zeichen
  // Text zurueck — reproduzierbar, waehrend derselbe Aufruf bei anderen Themen
  // 3348 Zeichen liefert. Das ist kein Budget- und kein Bug-Fall, sondern eine
  // inhaltliche Entscheidung des Modells. Sie braucht eine Meldung, die man
  // ohne Kenntnis der API-Interna versteht.
  describe('Verweigerung', () => {
    it('benennt eine Verweigerung als solche statt als "leere Antwort"', () => {
      expect(() => assertNonEmptyModelOutput('', 'Bündel', 'refusal'))
        .toThrow(/verweigert/i)
    })

    it('sagt dazu, was zu tun ist — der Abschnitt landet so im Artikel', () => {
      expect(() => assertNonEmptyModelOutput('', 'Bündel', 'refusal'))
        .toThrow(/manuell|von Hand/i)
    })

    it('meldet eine Verweigerung auch dann, wenn das Modell noch etwas Text geliefert hat', () => {
      // Ein angefangener und dann abgebrochener Abschnitt ist schlimmer als
      // gar keiner: er sieht vollstaendig aus.
      expect(() => assertNonEmptyModelOutput('## Überschrift\n\nHalber Satz', 'Bündel', 'refusal'))
        .toThrow(/verweigert/i)
    })
  })
})
