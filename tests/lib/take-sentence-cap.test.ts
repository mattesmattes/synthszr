/**
 * Der Synthszr Take wird hart auf fünf Sätze gekürzt.
 *
 * BETREIBER-VORGABE 2026-08-14: „Cutte den Take hart auf 5 Sätze, keine 7."
 * Die Prompt-Vorgabe allein reichte nicht — im Bündel-Modus wuchs der Take mit
 * der Länge der Zusammenfassung darüber mit.
 *
 * DIE FALLE IST DIE SATZGRENZE. Ein Punkt beendet im Deutschen nicht zuverlässig
 * einen Satz: „z. B.", „u. a.", „Mio.", „Dr.", „2,5 Mrd." und Ordnungszahlen
 * („2026. Jahr") stehen mitten im Satz. Wer naiv an „. " schneidet, kappt den
 * Take nach einem halben Satz — und das fällt niemandem auf, weil das Ergebnis
 * grammatisch aussieht.
 */
import { describe, expect, it } from 'vitest'
import { splitSentences, capTake, TAKE_MAX_SENTENCES } from '@/lib/claude/take-cap'

describe('splitSentences', () => {
  it('trennt gewoehnliche Saetze', () => {
    expect(splitSentences('Eins. Zwei. Drei.')).toHaveLength(3)
  })

  it('trennt an Frage- und Ausrufezeichen', () => {
    expect(splitSentences('Wirklich? Ja! Sicher.')).toHaveLength(3)
  })

  it('laesst gaengige Abkuerzungen stehen', () => {
    const t = 'Modelle wie z. B. Claude kosten 2,5 Mio. Dollar im Training. Das ist viel.'
    expect(splitSentences(t)).toHaveLength(2)
  })

  it('faellt nicht auf Ordnungszahlen herein', () => {
    const t = 'Am 14. August war es soweit. Danach kam nichts mehr.'
    expect(splitSentences(t)).toHaveLength(2)
  })

  it('behandelt Auslassungspunkte als EIN Satzende', () => {
    expect(splitSentences('Das war es dann wohl … Oder doch nicht.')).toHaveLength(2)
  })

  it('kommt mit leerem Text klar', () => {
    expect(splitSentences('')).toEqual([])
    expect(splitSentences('   ')).toEqual([])
  })
})

describe('capTake', () => {
  const take = (n: number) =>
    'Synthszr Take: ' + Array.from({ length: n }, (_, i) => `Satz Nummer ${i + 1} steht hier.`).join(' ')

  it('kuerzt auf fuenf Saetze', () => {
    expect(TAKE_MAX_SENTENCES).toBe(5)
    const out = capTake(take(8))
    expect(splitSentences(out.replace(/^Synthszr Take:\s*/, ''))).toHaveLength(5)
    expect(out).toContain('Satz Nummer 5')
    expect(out).not.toContain('Satz Nummer 6')
  })

  it('laesst kuerzere Takes unangetastet', () => {
    const drei = take(3)
    expect(capTake(drei)).toBe(drei)
  })

  it('behaelt die Anrede „Synthszr Take:"', () => {
    expect(capTake(take(9)).startsWith('Synthszr Take:')).toBe(true)
  })

  it('ruehrt einen Abschnitt OHNE Take nicht an', () => {
    const nurBericht = 'Eine Zusammenfassung. Mit vielen Saetzen. Und noch mehr. Und mehr. Und mehr. Und mehr. Und mehr.'
    expect(capTake(nurBericht)).toBe(nurBericht)
  })

  it('kuerzt NUR den Take, nicht die Zusammenfassung darueber', () => {
    // Die Zusammenfassung darf im Buendel bis zu 25 Saetze haben — sie ist von
    // der Grenze ausdruecklich nicht betroffen.
    const abschnitt = [
      '## Eine Ueberschrift',
      '',
      Array.from({ length: 12 }, (_, i) => `Bericht ${i + 1}.`).join(' '),
      '',
      take(8),
    ].join('\n')
    const out = capTake(abschnitt)
    expect(out).toContain('Bericht 12.')
    expect(out).not.toContain('Satz Nummer 6')
  })

  it('behaelt Markup hinter dem Take', () => {
    const mitTags = take(7) + '\n\n{Nvidia}'
    const out = capTake(mitTags)
    expect(out).toContain('{Nvidia}')
    expect(out).not.toContain('Satz Nummer 6')
  })

  it('kommt mit fehlerhaftem Eingang klar', () => {
    expect(capTake('')).toBe('')
    expect(capTake('Synthszr Take:')).toBe('Synthszr Take:')
  })
})
