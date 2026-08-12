/**
 * Was NIE ein Lexikon-Begriff werden darf — und was sehr wohl.
 *
 * BETREIBER-VORGABE 2026-08-12, zwei Seiten derselben Medaille:
 * - „Anbieter, Rechner, Büroarbeit, Fehlerbehebung sind keine Fachwörter."
 *   Alle vier standen als offene Kandidaten in der Warteschlange, obwohl der
 *   Prompt Allgemeinwörter längst ausschließt — Modelle befolgen das nicht
 *   zuverlässig, deshalb zusätzlich eine harte Liste.
 * - „Riemann ist ein Kandidat." Die Riemann-Hypothese kam im Artikeltext
 *   prominent vor, war aber weder Begriff noch Kandidat: der Prompt nannte nur
 *   Technik/IT, KI und Finanzen als Domänen. Mathematik fehlte schlicht.
 */
import { describe, expect, it } from 'vitest'
import { isExcludedGlossaryTerm } from '@/lib/data/glossary-exclusions'
import { buildCandidatesPrompt } from '@/lib/glossary/generate'

describe('isExcludedGlossaryTerm', () => {
  it.each(['Anbieter', 'Rechner', 'Büroarbeit', 'Fehlerbehebung'])(
    'sperrt das Allgemeinwort "%s"',
    (wort) => {
      expect(isExcludedGlossaryTerm(wort)).toBe(true)
    },
  )

  it('vergleicht unabhaengig von Schreibweise und Umlaut-Kodierung', () => {
    expect(isExcludedGlossaryTerm('büroarbeit')).toBe(true)
    expect(isExcludedGlossaryTerm('Bueroarbeit')).toBe(true)
    expect(isExcludedGlossaryTerm('Büro-Arbeit')).toBe(true)
    expect(isExcludedGlossaryTerm('  ANBIETER ')).toBe(true)
  })

  it('trifft NUR den ganzen Namen, nicht Zusammensetzungen', () => {
    // Sonst risse „Anbieter" den vorhandenen Fachbegriff mit heraus.
    expect(isExcludedGlossaryTerm('Lock-in (Anbieterbindung)')).toBe(false)
    expect(isExcludedGlossaryTerm('Anbieterbindung')).toBe(false)
  })

  it('laesst echte Fachbegriffe durch', () => {
    for (const t of ['Riemann-Hypothese', 'Mixture of Experts', 'Kubernetes', 'Verbriefung', 'gVisor']) {
      expect(isExcludedGlossaryTerm(t)).toBe(false)
    }
  })
})

describe('buildCandidatesPrompt — Domaenen und Gegenbeispiele', () => {
  const prompt = buildCandidatesPrompt('Artikeltext', [])

  it('nennt Mathematik/Naturwissenschaft als aufzunehmende Domaene', () => {
    expect(prompt).toMatch(/Mathematik/i)
  })

  it('nennt die Riemann-Hypothese als Positivbeispiel', () => {
    // Konkrete Beispiele wirken laut Prompt-Historie deutlich besser als
    // abstrakte Regeln — deshalb steht der gemeldete Fall ausdruecklich drin.
    expect(prompt).toMatch(/Riemann/i)
  })

  it('nennt die vier gemeldeten Allgemeinwoerter als Negativbeispiele', () => {
    for (const wort of ['Anbieter', 'Rechner', 'Büroarbeit', 'Fehlerbehebung']) {
      expect(prompt).toContain(wort)
    }
  })

  it('behaelt die bisherigen Domaenen und Ausschluesse', () => {
    expect(prompt).toMatch(/Technik\/IT/)
    expect(prompt).toMatch(/Finanzen/)
    expect(prompt).toMatch(/Gabelstapler/)
  })
})
