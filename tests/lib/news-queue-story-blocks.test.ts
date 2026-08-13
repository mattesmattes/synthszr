/**
 * Zusammengehörige Techmeme-Quellen in der Queue-Liste sichtbar machen.
 *
 * BETREIBER-BEFUND 2026-08-13 (Screenshot): Mit aktivem Techmeme-Filter standen
 * vier Cisco-Meldungen auf den Plätzen 1, 3, 4 und 7, dazwischen zwei
 * Bitcoin-Meldungen auf 2 und 5. Dass je vier bzw. zwei davon EINE gebündelte
 * Story sind, war der Liste nicht anzusehen.
 *
 * Ursache: Sortiert wird nach Punktzahl, und die unterscheidet sich innerhalb
 * einer Story um den Rang-Abschlag — gerade genug, dass fremde Meldungen
 * dazwischenrutschen.
 */
import { describe, expect, it } from 'vitest'
import { buildStoryBlocks } from '@/lib/news-queue/story-blocks'

interface Zeile {
  id: string
  total_score: number
  metadata?: Record<string, unknown> | null
}

const news = (id: string, score: number, story?: string, headline?: string): Zeile => ({
  id,
  total_score: score,
  metadata: story ? { techmeme: true, techmeme_story: story, techmeme_headline: headline ?? story } : null,
})

describe('buildStoryBlocks', () => {
  it('haelt die Quellen einer Story zusammen', () => {
    const zeilen = [
      news('cisco-1', 9.0, 'cisco'),
      news('bitcoin-1', 8.8, 'bitcoin'),
      news('cisco-2', 8.6, 'cisco'),
      news('cisco-3', 8.4, 'cisco'),
      news('bitcoin-2', 8.2, 'bitcoin'),
    ]
    expect(buildStoryBlocks(zeilen).map((e) => e.item.id)).toEqual([
      'cisco-1', 'cisco-2', 'cisco-3', 'bitcoin-1', 'bitcoin-2',
    ])
  })

  it('ordnet die Bloecke nach ihrer staerksten Meldung', () => {
    // Sonst laege ein Block mit vielen schwachen Quellen vor einem mit einer
    // sehr starken — die Reihenfolge der Liste soll ihre Aussage behalten.
    const zeilen = [news('b', 5.0, 'zwei'), news('a', 9.0, 'eins'), news('b2', 4.0, 'zwei')]
    expect(buildStoryBlocks(zeilen).map((e) => e.item.id)).toEqual(['a', 'b', 'b2'])
  })

  it('sortiert innerhalb eines Blocks weiter nach Punktzahl', () => {
    const zeilen = [news('schwach', 3.0, 's'), news('stark', 9.0, 's')]
    expect(buildStoryBlocks(zeilen).map((e) => e.item.id)).toEqual(['stark', 'schwach'])
  })

  it('markiert die erste Zeile eines Blocks und nennt seine Groesse', () => {
    const zeilen = [news('a', 9.0, 'cisco', 'Cisco meldet Quartalszahlen'), news('b', 8.0, 'cisco')]
    const blocks = buildStoryBlocks(zeilen)
    expect(blocks[0].blockStart).toBe(true)
    expect(blocks[0].blockSize).toBe(2)
    expect(blocks[0].headline).toBe('Cisco meldet Quartalszahlen')
    expect(blocks[1].blockStart).toBe(false)
    expect(blocks[1].blockSize).toBe(2)
  })

  it('behandelt eine EINZELNE Techmeme-Quelle nicht als Buendel', () => {
    // Eine Ueberschrift „1 Quelle" waere nur Rauschen.
    const blocks = buildStoryBlocks([news('allein', 7.0, 'solo')])
    expect(blocks[0].blockSize).toBe(1)
    expect(blocks[0].blockStart).toBe(false)
  })

  it('laesst Nicht-Techmeme-Meldungen in der Punktzahl-Reihenfolge', () => {
    const zeilen = [
      { id: 'normal-hoch', total_score: 9.5, metadata: null },
      news('story', 9.0, 's'),
      { id: 'normal-tief', total_score: 2.0, metadata: null },
    ]
    const ids = buildStoryBlocks(zeilen).map((e) => e.item.id)
    expect(ids).toEqual(['normal-hoch', 'story', 'normal-tief'])
    expect(buildStoryBlocks(zeilen)[0].blockSize).toBe(1)
  })

  it('kommt mit leerer Liste klar', () => {
    expect(buildStoryBlocks([])).toEqual([])
  })

  it('verwechselt Techmeme-Metadaten ohne Story nicht', () => {
    const ohneStory = [{ id: 'x', total_score: 5, metadata: { techmeme: true } }]
    expect(buildStoryBlocks(ohneStory)[0].blockSize).toBe(1)
  })
})
