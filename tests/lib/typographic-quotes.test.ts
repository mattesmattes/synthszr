/**
 * Typografische Anführungszeichen je Sprache.
 *
 * Anlass: die Modelle liefern durchgängig gerade `"…"`. Im Deutschen sind das
 * Zollzeichen — richtig ist „…".
 */
import { describe, expect, it } from 'vitest'
import { typographicQuotes as q } from '@/lib/typography/quotes'

describe('typographicQuotes', () => {
  it('setzt im Deutschen „…"', () => {
    expect(q('Er nannte es "Fortschritt".', 'de')).toBe('Er nannte es „Fortschritt“.')
  })

  it('macht aus einem doppelten Leerzeichen der Übersetzung genau eines', () => {
    // PROD-BEFUND 2026-09-20 (Newsletter FR): die Übersetzung liefert bereits
    // «\u00A0 mot\u00A0 » — also NBSP UND normales Leerzeichen. Der Normalisierer
    // nahm nur EINES davon weg, das Guillemet bekam sein eigenes dazu, und im
    // Ergebnis stand eine doppelt breite Lücke: «\u202F mot.
    expect(q('Trump crée une «\u00A0 AI Force\u00A0 ».', 'fr')).toBe('Trump crée une «\u202fAI Force\u202f».')
  })

  it('räumt auch mehrere normale Leerzeichen innen auf', () => {
    expect(q('Il a dit «   oui   ».', 'fr')).toBe('Il a dit «\u202foui\u202f».')
  })

  it('lässt das Leerzeichen VOR dem öffnenden Guillemet stehen', () => {
    // Es gehört zum vorangehenden Wort, nicht zum Zitat.
    expect(q('Il a dit "oui".', 'fr')).toBe('Il a dit «\u202foui\u202f».')
  })

  it('frisst im Deutschen NICHT das Leerzeichen vor »…«', () => {
    // PROD-BEFUND 2026-09-20: die alte, sprachunabhängige Guillemet-Regel nahm
    // das Leerzeichen davor mit — aus „Buchs »CODE CRASH«" wurde „Buchs„CODE
    // CRASH\u201C". Nur im Französischen gehört das Leerzeichen zum Zitatzeichen.
    expect(q('Autor des Buchs »CODE CRASH«.', 'de')).toBe('Autor des Buchs „CODE CRASH“.')
  })

  it('setzt im Englischen “…”', () => {
    expect(q('He called it "progress".', 'en')).toBe('He called it “progress”.')
  })

  it('setzt im Französischen «…» mit schmalem geschütztem Leerzeichen', () => {
    // U+202F (espace fine insécable), nicht das normale Leerzeichen — so verlangt
    // es die französische Typografie, und nur so bricht die Zeile nicht zwischen
    // Zeichen und Wort.
    expect(q('Il a dit "oui".', 'fr')).toBe('Il a dit «\u202foui\u202f».')
  })

  it('nutzt für Niederdeutsch und Tschechisch die deutsche Form', () => {
    expect(q('Dat hett he "seggt".', 'nds')).toContain('„')
    expect(q('Řekl "ano".', 'cs')).toContain('„')
  })

  it('fällt bei unbekannter Sprache auf Deutsch zurück', () => {
    expect(q('Test "x".', 'it')).toBe('Test „x“.')
  })

  it('lässt ein UNPAARIGES Zeichen unangetastet', () => {
    // 24" ist ein Zollmaß, kein Zitatbeginn. Ein halb ersetztes Paar wäre
    // schlimmer als keins.
    expect(q('Der Bildschirm ist 24" groß.', 'de')).toBe('Der Bildschirm ist 24" groß.')
  })

  it('behandelt zwei Zitate im selben Satz getrennt', () => {
    expect(q('"A" und "B".', 'de')).toBe('„A“ und „B“.')
  })

  it('rührt Text ohne Anführungszeichen nicht an', () => {
    const s = 'Ein Satz ohne alles.'
    expect(q(s, 'de')).toBe(s)
  })

  it('setzt den typografischen Apostroph zwischen Buchstaben', () => {
    expect(q("Nvidia's Chips", 'en')).toBe('Nvidia’s Chips')
    expect(q("don't", 'en')).toBe('don’t')
  })

  it('lässt ein einfaches Anführungszeichen am Wortrand stehen', () => {
    // Sonst würde aus 'so' ein kaputtes Gemisch.
    expect(q("Er sagte 'so' dazu.", 'de')).toBe("Er sagte 'so' dazu.")
  })

  it('verkraftet leeren Text', () => {
    expect(q('', 'de')).toBe('')
  })
})
