/**
 * Reduktion des A-Z-Registers in der Seitenspalte.
 *
 * Anlass ist eine Skalierungsfrage, nicht ein Fehler im Bestand: bei heute 17
 * Begriffen ist die Volliste harmlos, bei 500 stehen 500 Links in JEDER
 * Begriffsseite. Das kostet Egress (die Liste wird pro Seite geladen), blaeht das
 * HTML auf und verschiebt fuer Suchmaschinen und Sprachmodelle das Verhaeltnis
 * von Inhalt zu Navigation.
 *
 * Die Volliste bleibt auf /glossary — dort gehoert sie hin, und damit bleibt
 * jeder Begriff fuer Crawler ueber einen Klick erreichbar.
 */
import { describe, expect, it } from 'vitest'
import { buildIndexNav } from '@/lib/glossary/index-nav'

const terms = (...names: string[]) =>
  names.map((n) => ({ slug: n.toLowerCase().replace(/[^a-z0-9]+/g, '-'), canonicalName: n }))

describe('buildIndexNav', () => {
  it('liefert die Anfangsbuchstaben aller Begriffe, eindeutig und sortiert', () => {
    const nav = buildIndexNav(terms('Token', 'Attention', 'CUDA', 'Compute'), 'token')
    expect(nav.letters.map((l) => l.letter)).toEqual(['A', 'C', 'T'])
  })

  it('zaehlt je Buchstabe, damit die Leiste den Bestand zeigt', () => {
    const nav = buildIndexNav(terms('CUDA', 'Compute', 'Token'), 'token')
    expect(nav.letters.find((l) => l.letter === 'C')?.count).toBe(2)
  })

  it('zeigt als Begriffe NUR die Nachbarn des aktuellen Anfangsbuchstabens', () => {
    // Das ist der Kern der Reduktion: statt 500 Links stehen nur die des eigenen
    // Buchstabens da — der Kontext, in dem man sich gerade bewegt.
    const nav = buildIndexNav(terms('CUDA', 'Compute', 'Token', 'Transformer'), 'cuda')
    expect(nav.siblings.map((t) => t.canonicalName)).toEqual(['Compute', 'CUDA'])
  })

  it('behaelt den aktuellen Begriff in der Nachbarliste', () => {
    // Ihn weglassen wuerde die alphabetische Reihe loechrig machen; die
    // Komponente stellt ihn als nicht klickbaren Marker dar.
    const nav = buildIndexNav(terms('CUDA', 'Compute'), 'cuda')
    expect(nav.siblings.some((t) => t.slug === 'cuda')).toBe(true)
  })

  it('sortiert die Nachbarn alphabetisch, unabhaengig von der Eingabereihenfolge', () => {
    const nav = buildIndexNav(terms('Transformer', 'Token', 'Tensor'), 'token')
    expect(nav.siblings.map((t) => t.canonicalName)).toEqual(['Tensor', 'Token', 'Transformer'])
  })

  it('gibt die Gesamtzahl zurueck, fuer den Verweis auf den vollen Index', () => {
    const nav = buildIndexNav(terms('A-Begriff', 'B-Begriff', 'C-Begriff'), 'a-begriff')
    expect(nav.total).toBe(3)
  })

  it('gruppiert Begriffe mit Ziffer oder Sonderzeichen unter #', () => {
    // "3D-Rendering" unter "3" zu fuehren waere eine Gruppe mit einem Eintrag,
    // und die Leiste haette Luecken zwischen den Ziffern.
    const nav = buildIndexNav(terms('3D-Rendering', 'Token'), '3d-rendering')
    expect(nav.letters.map((l) => l.letter)).toEqual(['#', 'T'])
    expect(nav.siblings.map((t) => t.canonicalName)).toEqual(['3D-Rendering'])
  })

  it('stellt # VOR die Buchstaben, nicht dahinter', () => {
    const nav = buildIndexNav(terms('Token', '3D'), 'token')
    expect(nav.letters[0].letter).toBe('#')
  })

  it('faellt auf den ersten Buchstaben zurueck, wenn der Slug unbekannt ist', () => {
    // Kann bei einem Sprachwechsel passieren: der Slug bleibt deutsch, der Name
    // ist uebersetzt. Eine leere Nachbarliste waere hier die schlechtere Antwort.
    const nav = buildIndexNav(terms('Attention', 'Token'), 'gibt-es-nicht')
    expect(nav.siblings.length).toBeGreaterThan(0)
    expect(nav.activeLetter).toBe('A')
  })

  it('nennt den aktiven Buchstaben, damit die Leiste ihn hervorheben kann', () => {
    const nav = buildIndexNav(terms('Attention', 'Token'), 'token')
    expect(nav.activeLetter).toBe('T')
  })

  it('verkraftet eine leere Begriffsliste', () => {
    const nav = buildIndexNav([], 'egal')
    expect(nav).toEqual({ letters: [], siblings: [], total: 0, activeLetter: null })
  })

  it('sortiert Umlaute nach der Locale, nicht nach Codepoint', () => {
    // "Übertragung" gehoert im Deutschen zwischen T und V, nicht hinter Z.
    const nav = buildIndexNav(terms('Zeta', 'Übertragung', 'Token'), 'token', 'de')
    expect(nav.letters.map((l) => l.letter)).toEqual(['T', 'Ü', 'Z'])
  })
})
