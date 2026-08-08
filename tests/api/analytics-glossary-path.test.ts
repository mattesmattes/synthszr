/**
 * Pfad-Erkennung der Lexikon-Aufrufe für die Statistik-Seite.
 *
 * Eigener Test, weil genau hier die stillen Fehler sitzen: eine zu weite Regex
 * zählt fremde Seiten mit, eine zu enge zählt die Detailseiten nicht — und
 * beides fällt an einer Zahl im Dashboard nicht auf. Dieselbe Sorgfalt wie bei
 * isRankingsPath, dessen Kommentar in der Route ausdrücklich „aber nicht
 * /de/xrankings" festhält.
 *
 * Gemessen an Prod (2026-08-08, 30 Tage): 1.760 der 19.974 Page-Views liegen
 * unter /glossary, verteilt über alle Sprachpräfixe (/de, /en, /fr …).
 */
import { describe, expect, it } from 'vitest'
import { isGlossaryPath } from '@/app/api/admin/analytics/stats/route'

describe('isGlossaryPath', () => {
  it('erkennt die Lexikon-Übersicht in jeder Sprache', () => {
    expect(isGlossaryPath('/de/glossary')).toBe(true)
    expect(isGlossaryPath('/en/glossary')).toBe(true)
  })

  it('erkennt Begriffsseiten', () => {
    // Genau die Form, die in Prod dominiert.
    expect(isGlossaryPath('/de/glossary/long-tail')).toBe(true)
    expect(isGlossaryPath('/fr/glossary/pathogen')).toBe(true)
    expect(isGlossaryPath('/de/glossary/aktivierung-neuronales-netz')).toBe(true)
  })

  it('erkennt einen abschliessenden Slash', () => {
    expect(isGlossaryPath('/de/glossary/')).toBe(true)
  })

  it('zaehlt KEINE Pfade, die nur so anfangen oder enden', () => {
    expect(isGlossaryPath('/de/xglossary')).toBe(false)
    expect(isGlossaryPath('/de/glossaryx')).toBe(false)
    expect(isGlossaryPath('/de/my-glossary-notes')).toBe(false)
  })

  it('zaehlt die Admin-Ansicht nicht als Nutzung der Website', () => {
    // /admin/glossary ist das Redaktionswerkzeug — es gehoert nicht in eine
    // Statistik ueber die Leser-Nutzung. Der Betreiber wuerde sich sonst selbst
    // in die Zahlen schreiben.
    expect(isGlossaryPath('/admin/glossary')).toBe(false)
  })

  it('verkraftet null und leeren Pfad', () => {
    expect(isGlossaryPath(null)).toBe(false)
    expect(isGlossaryPath(undefined)).toBe(false)
    expect(isGlossaryPath('')).toBe(false)
  })
})
