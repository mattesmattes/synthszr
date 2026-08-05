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
