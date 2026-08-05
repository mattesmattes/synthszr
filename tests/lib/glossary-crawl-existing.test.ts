/**
 * Kandidaten aussortieren, die es als Begriff schon GIBT.
 *
 * Anlass ist ein Prod-Log (2026-08-05):
 *   glossary_terms insert failed: duplicate key value violates unique
 *   constraint "glossary_terms_slug_key"  —  "Advanced Encryption Standard"
 *
 * Der Kandidatenfilter prüfte nur die crawl-eigene `generated`-Liste, nicht den
 * Bestand. Begriffe, die NACH der Extraktion auf anderem Weg entstanden sind
 * (Freigabe beim Artikel-Speichern), blieben in der Warteschlange. Der Text wurde
 * dann voll erzeugt — zwei Opus-Aufrufe, rund 60s — und erst der Insert scheiterte.
 */
import { describe, expect, it } from 'vitest'
import { partitionByExisting } from '@/lib/glossary/crawl'

describe('partitionByExisting', () => {
  const queue: Array<[string, number]> = [
    ['Advanced Encryption Standard', 1],
    ['Superintelligenz', 4],
  ]

  it('sortiert Kandidaten aus, deren Slug schon existiert', () => {
    const r = partitionByExisting(queue, new Set(['advanced-encryption-standard']))
    expect(r.toGenerate.map(([n]) => n)).toEqual(['Superintelligenz'])
    expect(r.alreadyExisting).toEqual(['Advanced Encryption Standard'])
  })

  it('lässt alles durch, wenn nichts existiert', () => {
    const r = partitionByExisting(queue, new Set())
    expect(r.toGenerate).toHaveLength(2)
    expect(r.alreadyExisting).toEqual([])
  })

  it('vergleicht über den SLUG, nicht über den Anzeigenamen', () => {
    // In der Tabelle steht der Slug; der Kandidat trägt den Anzeigenamen.
    const r = partitionByExisting([['Mixture of Experts', 2]], new Set(['mixture-of-experts']))
    expect(r.toGenerate).toHaveLength(0)
  })

  it('behandelt zwei Kandidaten mit demselben Slug nur einmal', () => {
    // "Advanced Encryption Standard" und "advanced encryption standard" ergeben
    // denselben Slug — der zweite würde am Unique-Constraint scheitern.
    const r = partitionByExisting(
      [['Advanced Encryption Standard', 1], ['advanced encryption standard', 1]],
      new Set(),
    )
    expect(r.toGenerate).toHaveLength(1)
    expect(r.alreadyExisting).toEqual(['advanced encryption standard'])
  })

  it('verkraftet eine leere Warteschlange', () => {
    expect(partitionByExisting([], new Set())).toEqual({ toGenerate: [], alreadyExisting: [] })
  })
})
