/**
 * Gebündelte Quellen dürfen weder wegdedupliziert noch angeschnitten werden.
 *
 * BEFUND 2026-08-13: Nachdem der Techmeme-Lauf 48 Quellen zu fünf Themen
 * ausgewählt hatte, hätte die Artikel-Erzeugung sie zweimal zerlegt:
 *
 * 1. `dedupeByTopic` verwirft Meldungen mit Ähnlichkeit ≥ 0,8. Zwölf Quellen zur
 *    selben Meldung sind maximal ähnlich — von jedem Thema hätte GENAU EINE
 *    überlebt. Im Log stünde nur „dropped 43 items (batch-dupe)", kein Fehler.
 *
 * 2. `slice(0, 25)` schneidet nach Punktzahl — mitten durch die Bündel.
 *
 * Beide Male dieselbe Ursache: Sie zählen ITEMS. Ein Bündel ist aber EIN
 * Abschnitt. 48 gebündelte Quellen ergeben fünf Abschnitte, nicht 48.
 */
import { describe, expect, it } from 'vitest'
import { splitBundled, capByUnits, BUNDLE_SOURCES_MAX } from '@/lib/claude/queue-article'

interface Zeile {
  id: string
  total_score: number
  bundle_type?: string | null
  metadata?: Record<string, unknown> | null
}

const q = (id: string, score: number, bundle?: string, story?: string): Zeile => ({
  id,
  total_score: score,
  bundle_type: bundle ?? null,
  metadata: story ? { techmeme_story: story } : null,
})

describe('splitBundled', () => {
  it('trennt gebuendelte von gewoehnlichen Meldungen', () => {
    const zeilen = [q('a', 9, 'topic', 's1'), q('b', 8), q('c', 7, 'topic', 's1')]
    const { bundled, single } = splitBundled(zeilen)
    expect(bundled.map((z) => z.id)).toEqual(['a', 'c'])
    expect(single.map((z) => z.id)).toEqual(['b'])
  })

  it('behandelt alle Buendel-Arten gleich', () => {
    const zeilen = [q('t', 9, 'topic'), q('d', 8, 'deep_dive'), q('r', 7, 'recap'), q('n', 6)]
    expect(splitBundled(zeilen).bundled).toHaveLength(3)
  })

  it('laesst eine Liste ohne Buendel unveraendert', () => {
    const zeilen = [q('a', 9), q('b', 8)]
    expect(splitBundled(zeilen).bundled).toHaveLength(0)
    expect(splitBundled(zeilen).single).toHaveLength(2)
  })
})

describe('capByUnits', () => {
  it('zaehlt ein Buendel als EINE Einheit, nicht als zwoelf', () => {
    // Zwoelf Quellen zu einem Thema ergeben EINEN Abschnitt. Wuerden sie
    // einzeln zaehlen, waere das Limit nach einem Thema erschoepft.
    const zwoelf = Array.from({ length: 12 }, (_, i) => q(`s1-${i}`, 9 - i * 0.1, 'topic', 's1'))
    const drei = Array.from({ length: 3 }, (_, i) => q(`s2-${i}`, 8 - i * 0.1, 'topic', 's2'))
    const einzeln = [q('e1', 7), q('e2', 6)]
    const out = capByUnits([...zwoelf, ...drei, ...einzeln], 4)
    // 2 Buendel + 2 Einzelmeldungen = 4 Einheiten. Zeilen: 5 (vom
    // Zwoelfer-Buendel, gekappt auf BUNDLE_SOURCES_MAX) + 3 + 2 = 10.
    expect(out).toHaveLength(10)
  })

  it('nimmt ein Buendel ganz oder gar nicht — nie halb', () => {
    // Das Einheiten-Limit darf ein Buendel nicht anschneiden. Die
    // Quellen-Obergrenze (BUNDLE_SOURCES_MAX) ist etwas anderes: eine bewusste
    // Beschraenkung je Abschnitt, kein Bruchstueck aus Platzmangel.
    const acht = Array.from({ length: 8 }, (_, i) => q(`s1-${i}`, 9, 'topic', 's1'))
    const out = capByUnits([...acht, q('e', 5)], 1)
    expect(out.every((z) => z.id.startsWith('s1-'))).toBe(true)
    expect(out).toHaveLength(5)
  })

  it('bevorzugt Buendel vor Einzelmeldungen', () => {
    // Die Themen des Tages sind gesetzt; Einzelmeldungen fuellen auf.
    const buendel = [q('b1', 3, 'topic', 's1'), q('b2', 3, 'topic', 's1')]
    const stark = [q('e1', 9), q('e2', 9)]
    const out = capByUnits([...buendel, ...stark], 2)
    expect(out.map((z) => z.id)).toContain('b1')
    expect(out.map((z) => z.id)).toContain('b2')
    expect(out).toHaveLength(3)  // Buendel (2 Zeilen) + eine Einzelmeldung
  })

  it('fuellt mit den staerksten Einzelmeldungen auf', () => {
    const out = capByUnits([q('schwach', 1), q('stark', 9), q('mittel', 5)], 2)
    expect(out.map((z) => z.id)).toEqual(['stark', 'mittel'])
  })

  it('laesst alles durch, wenn das Limit reicht', () => {
    const zeilen = [q('a', 9), q('b', 8)]
    expect(capByUnits(zeilen, 25)).toHaveLength(2)
  })

  it('kommt mit leerer Liste klar', () => {
    expect(capByUnits([], 25)).toEqual([])
  })
})

describe('Quellen je Buendel', () => {
  const zwoelf = Array.from({ length: 12 }, (_, i) =>
    q(`s1-${i}`, 9 - i * 0.1, 'topic', 's1'))

  it('nimmt hoechstens fuenf Quellen je Buendel', () => {
    // Betreiber-Vorgabe 2026-08-13: Ein Leitartikel aus zwoelf Quellen franst
    // aus. Fuenf reichen fuer die Breite, ohne den Abschnitt zu zerfasern.
    expect(BUNDLE_SOURCES_MAX).toBe(5)
    expect(capByUnits(zwoelf, 25)).toHaveLength(5)
  })

  it('nimmt die BESTEN fuenf, nicht die ersten fuenf', () => {
    const gemischt = [q('schwach', 1, 'topic', 's'), ...Array.from({ length: 6 }, (_, i) => q(`gut-${i}`, 9 - i * 0.1, 'topic', 's'))]
    const ids = capByUnits(gemischt, 25).map((z) => z.id)
    expect(ids).not.toContain('schwach')
    expect(ids).toHaveLength(5)
  })

  it('laesst kleinere Buendel unangetastet', () => {
    const drei = Array.from({ length: 3 }, (_, i) => q(`s2-${i}`, 8, 'topic', 's2'))
    expect(capByUnits(drei, 25)).toHaveLength(3)
  })

  it('das Buendel zaehlt weiterhin als EINE Einheit', () => {
    expect(capByUnits([...zwoelf, q('einzel', 1)], 1)).toHaveLength(5)
    expect(capByUnits([...zwoelf, q('einzel', 1)], 2)).toHaveLength(6)
  })
})

// BETREIBER-VORGABE 2026-09-28: Label vor Buendel — alle Items eines Labels
// ergeben EINEN Abschnitt. Die Quellen-Grenze (fuenf je Buendel, 2026-08-13)
// gilt weiter je Techmeme-Story: sie verhindert, dass zwoelf Quellen zur SELBEN
// Meldung den Abschnitt zerfasern — sie darf aber keine andere Story und keine
// von Hand gelabelte Meldung aus dem Abschnitt draengen.
describe('Ein Label, eine Einheit', () => {
  const zwoelf = Array.from({ length: 12 }, (_, i) => q(`s1-${i}`, 9 - i * 0.1, 'topic', 's1'))

  it('zaehlt zwei Stories unter demselben Label als EINE Einheit — je Story die besten fuenf', () => {
    const zweiThemen = [...zwoelf, ...Array.from({ length: 8 }, (_, i) => q(`s2-${i}`, 7, 'topic', 's2'))]
    expect(capByUnits(zweiThemen, 1)).toHaveLength(10)
  })

  it('behaelt eine von Hand gelabelte Meldung ohne Story neben einer grossen Story', () => {
    const ids = capByUnits([...zwoelf, q('evans', 0.5, 'topic')], 1).map((z) => z.id)
    expect(ids).toContain('evans')
    expect(ids).toHaveLength(6)
  })

  it('haelt verschiedene Labels weiterhin als eigene Einheiten auseinander', () => {
    const gemischt = [...zwoelf, q('cover', 5, 'cover_story', 's9')]
    expect(capByUnits(gemischt, 1)).toHaveLength(5)
    expect(capByUnits(gemischt, 2)).toHaveLength(6)
  })
})
