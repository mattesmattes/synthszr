/**
 * Format-Erkennung der Chunk-Antworten beim Uebersetzen langer Artikel.
 *
 * PROD-BEFUND 2026-08-21: Der englische Newsletter ging mit halb deutschem Text
 * an 626 Abonnenten. Ursache war NICHT das Timing (die Uebersetzung lag 9 min vor
 * dem Versand fertig vor) und nicht der Versandcode, sondern der Uebersetzer
 * selbst: lange Artikel werden in Bloecke à 15 zerlegt, und der Aufrufer kannte
 * nur zwei Antwortformen — ein nacktes Array und `{content: [...]}`. Lieferte das
 * Modell einen anderen Wrapper, fiel der Chunk STILL auf den deutschen
 * Originaltext zurueck, und die Uebersetzung wurde trotzdem als 'completed'
 * gespeichert. Im ausgelieferten Artikel waren die ersten ~32 Bloecke deutsch und
 * die restlichen 43 englisch.
 *
 * Dass FR, CS und NDS beim SELBEN Artikel durchliefen und 26 andere
 * EN-Uebersetzungen sauber sind, zeigt: es ist kein Sprachproblem, sondern
 * Nichtdeterminismus im Antwortformat. Deshalb wird hier breit erkannt statt
 * kapituliert.
 */
import { describe, expect, it } from 'vitest'
import { extractBlockArray } from '@/lib/i18n/translation-service'

const BLOCKS = [{ type: 'paragraph' }, { type: 'heading' }]

describe('extractBlockArray', () => {
  it('nimmt ein nacktes Array', () => {
    expect(extractBlockArray(BLOCKS)).toEqual(BLOCKS)
  })

  it('packt ein doc-Objekt aus', () => {
    expect(extractBlockArray({ type: 'doc', content: BLOCKS })).toEqual(BLOCKS)
  })

  it('packt auch einen ANDEREN Wrapper aus — der Fall, der den Newsletter zerlegt hat', () => {
    // Genau hier kapitulierte der alte Code und nahm den deutschen Originalblock.
    expect(extractBlockArray({ blocks: BLOCKS })).toEqual(BLOCKS)
    expect(extractBlockArray({ translation: BLOCKS })).toEqual(BLOCKS)
    expect(extractBlockArray({ result: BLOCKS })).toEqual(BLOCKS)
  })

  it('findet das Array auch neben skalaren Feldern', () => {
    expect(extractBlockArray({ language: 'en', chunk: 2, content: BLOCKS })).toEqual(BLOCKS)
  })

  it('gibt null zurueck, wenn gar kein Block-Array da ist', () => {
    expect(extractBlockArray({ error: 'cannot translate' })).toBeNull()
    expect(extractBlockArray('nur text')).toBeNull()
    expect(extractBlockArray(null)).toBeNull()
    expect(extractBlockArray(42)).toBeNull()
  })

  it('nimmt ein leeres Array NICHT als gueltige Uebersetzung', () => {
    // Ein leerer Chunk wuerde den Artikelabschnitt spurlos loeschen — schlimmer
    // als der deutsche Originaltext.
    expect(extractBlockArray([])).toBeNull()
    expect(extractBlockArray({ content: [] })).toBeNull()
  })

  it('ignoriert Arrays, die keine Bloecke enthalten', () => {
    // z. B. {"notes": ["translated ok"]} — ein Hinweis-Array ist kein Inhalt.
    expect(extractBlockArray({ notes: ['translated ok', 'no issues'] })).toBeNull()
  })
})
