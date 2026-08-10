/**
 * Phasen des Artikel-Crawls.
 *
 * BETREIBER-BEFUND 2026-08-10: das Panel meldete "30 von 225 Artikeln gelesen",
 * obwohl der Bestand laengst durchgearbeitet war — offen sein durfte hoechstens
 * der Artikel von heute.
 *
 * Ursache: der Cursor lief NUR abwaerts (`.lt('created_at', cursor)`). War der
 * Bestand einmal durch, blieb er am aeltesten Artikel stehen. Jeder NEUE Artikel
 * ist aber NEUER als dieser Cursor und fiel damit dauerhaft aus der Abfrage. Der
 * einzige Ausweg war "Fortschritt zuruecksetzen" — was den kompletten Bestand
 * erneut las.
 *
 * Deshalb merkt sich der Zustand zusaetzlich `newestRead`, den neuesten je
 * gelesenen Artikel. Ist der Bestand durch (Cursor geloest), liest der naechste
 * Lauf nur noch, was seither dazugekommen ist.
 */
import { describe, expect, it } from 'vitest'
import { crawlPhase } from '@/lib/glossary/crawl'

describe('crawlPhase', () => {
  it('Erstlauf: weder Cursor noch Marke', () => {
    expect(crawlPhase({ cursor: null, newestRead: null })).toBe('erstlauf')
  })

  it('holt auf, solange ein Cursor steht', () => {
    expect(crawlPhase({ cursor: '2026-07-12T03:15:50Z', newestRead: '2026-08-10T06:00:00Z' }))
      .toBe('aufholen')
  })

  it('fuehrt nach, sobald der Bestand durch ist', () => {
    // Genau der Zustand, der vorher unerreichbar war: Cursor geloest, Marke
    // gesetzt — ab hier zaehlen nur noch neue Artikel.
    expect(crawlPhase({ cursor: null, newestRead: '2026-08-10T06:00:00Z' }))
      .toBe('nachfuehren')
  })

  it('behandelt eine fehlende Marke wie einen Erstlauf', () => {
    // Altbestand: Zustaende aus der Zeit vor diesem Feld haben kein newestRead.
    // Sie duerfen nicht in die Nachfuehr-Phase fallen, sonst wuerde der Crawl
    // gar nichts mehr lesen.
    expect(crawlPhase({ cursor: null })).toBe('erstlauf')
  })
})
