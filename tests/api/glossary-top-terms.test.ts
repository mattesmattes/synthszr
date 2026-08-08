/**
 * Slug-Extraktion für die Top-Begriffe der Lexikon-Statistik.
 *
 * Aus `/de/glossary/long-tail` muss `long-tail` werden, und zwar
 * SPRACHUNABHAENGIG: derselbe Begriff wird unter /de, /en und /fr aufgerufen
 * (in Prod alle drei belegt). Wuerde man nach Pfad statt nach Slug gruppieren,
 * stuende ein Begriff dreimal in der Liste und keiner davon mit seiner echten
 * Zahl — eine Top-40 waere dann nicht die Top-40.
 *
 * Eigener Test, gleiche Begruendung wie bei isGlossaryPath: ein Fehler hier
 * erzeugt eine plausibel aussehende, falsche Rangliste.
 */
import { describe, expect, it } from 'vitest'
import { glossarySlugFromPath } from '@/app/api/admin/stats/glossary-top/route'

describe('glossarySlugFromPath', () => {
  it('zieht den Slug aus einer Begriffsseite', () => {
    expect(glossarySlugFromPath('/de/glossary/long-tail')).toBe('long-tail')
    expect(glossarySlugFromPath('/fr/glossary/pathogen')).toBe('pathogen')
  })

  it('fasst dieselbe Seite ueber Sprachen hinweg zusammen', () => {
    // Der Kern der Gruppierung: gleicher Slug, verschiedene Praefixe.
    expect(glossarySlugFromPath('/de/glossary/transformer'))
      .toBe(glossarySlugFromPath('/en/glossary/transformer'))
  })

  it('ignoriert die Uebersichtsseite — sie ist kein Begriff', () => {
    expect(glossarySlugFromPath('/de/glossary')).toBeNull()
    expect(glossarySlugFromPath('/de/glossary/')).toBeNull()
  })

  it('ignoriert Query und Fragment', () => {
    expect(glossarySlugFromPath('/de/glossary/token?utm_source=nl')).toBe('token')
    expect(glossarySlugFromPath('/de/glossary/token#definition')).toBe('token')
  })

  it('ignoriert die Admin-Ansicht', () => {
    expect(glossarySlugFromPath('/admin/glossary')).toBeNull()
    expect(glossarySlugFromPath('/admin/glossary/token')).toBeNull()
  })

  it('ignoriert Pfade, die nur aehnlich aussehen', () => {
    expect(glossarySlugFromPath('/de/glossaryx/token')).toBeNull()
    expect(glossarySlugFromPath('/de/my-glossary/token')).toBeNull()
  })

  it('verkraftet null, undefined und leeren Pfad', () => {
    expect(glossarySlugFromPath(null)).toBeNull()
    expect(glossarySlugFromPath(undefined)).toBeNull()
    expect(glossarySlugFromPath('')).toBeNull()
  })
})
