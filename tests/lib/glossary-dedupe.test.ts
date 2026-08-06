/**
 * Reine Entscheidungslogik aus scripts/dedupe-glossary-terms.ts, ausgelagert
 * nach lib/glossary/dedupe.ts, damit sie ohne echte DB-Verbindung testbar ist.
 *
 * Betreiber-Befund 2026-08-06 (nach dem ersten Dry-Run): das urspruengliche
 * Kriterium (mehr Inhalt gewinnt) waehlte in zwei der vier Paare ausgerechnet
 * den Slug, auf den KEIN Artikel verlinkte - "evals" (3972 Zeichen) gewann
 * gegen "eval" (3699 Zeichen), obwohl 30 Artikel auf "eval" verlinkten und nur
 * 8 auf "evals". Das Umbiegen von 30 glossaryLink-Marks fuer ~250 Zeichen
 * Unterschied steht in keinem Verhaeltnis zum jederzeit ruecknehmbaren
 * hidden-Status. Kriterium jetzt: Verlinkungen vor Inhalt vor Alter.
 */
import { describe, expect, it } from 'vitest'
import { decidePair, type DedupeRow } from '@/lib/glossary/dedupe'

function row(over: Partial<DedupeRow> & { slug: string }): DedupeRow {
  return {
    id: over.slug,
    canonical_name: over.canonical_name ?? over.slug,
    aliases: over.aliases ?? [],
    summary: over.summary ?? '',
    body: over.body ?? { type: 'doc', content: [] },
    created_at: over.created_at ?? '2026-01-01T00:00:00Z',
    ...over,
  }
}

describe('decidePair', () => {
  it('waehlt den staerker verlinkten Begriff, auch wenn er weniger Inhalt hat', () => {
    // Genau der Prod-Fall: eval hat mehr Links, evals mehr Zeichen.
    const eval_ = row({ slug: 'eval', summary: 'kurz' })
    const evals = row({ slug: 'evals', summary: 'ein deutlich laengerer Text mit sehr viel mehr Inhalt' })
    const d = decidePair([eval_, evals], new Map([['eval', 30], ['evals', 8]]))
    expect(d.winner.slug).toBe('eval')
    expect(d.losers.map((l) => l.slug)).toEqual(['evals'])
    expect(d.decidingCriterion).toBe('Verlinkungen')
  })

  it('faellt bei GLEICHEN Verlinkungszahlen auf die Inhaltslaenge zurueck', () => {
    const a = row({ slug: 'leveraged-etf', summary: 'kurz' })
    const b = row({ slug: 'leveraged-etfs', summary: 'ein deutlich laengerer Text mit sehr viel mehr Inhalt als der andere' })
    const d = decidePair([a, b], new Map([['leveraged-etf', 0], ['leveraged-etfs', 0]]))
    expect(d.winner.slug).toBe('leveraged-etfs')
    expect(d.decidingCriterion).toBe('Inhaltslaenge')
  })

  it('faellt bei GLEICHEN Verlinkungszahlen UND GLEICHER Inhaltslaenge auf das Alter zurueck (aelter gewinnt)', () => {
    const older = row({ slug: 'a', summary: 'xxxx', created_at: '2026-01-01T00:00:00Z' })
    const newer = row({ slug: 'b', summary: 'xxxx', created_at: '2026-02-01T00:00:00Z' })
    const d = decidePair([newer, older], new Map([['a', 2], ['b', 2]]))
    expect(d.winner.slug).toBe('a')
    expect(d.decidingCriterion).toBe('Alter')
  })

  it('bleibt bei den unveraenderten Paaren ohne Verlinkungen beim Inhalts-Kriterium (Leveraged ETF, Time Series Foundation Model)', () => {
    const model = row({ slug: 'time-series-foundation-model', summary: 'a'.repeat(4722) })
    const models = row({ slug: 'time-series-foundation-models', summary: 'a'.repeat(4377) })
    const d = decidePair([model, models], new Map([['time-series-foundation-model', 0], ['time-series-foundation-models', 0]]))
    expect(d.winner.slug).toBe('time-series-foundation-model')
    expect(d.decidingCriterion).toBe('Inhaltslaenge')
  })

  it('behandelt eine fehlende Verlinkungszahl als 0', () => {
    const a = row({ slug: 'a', summary: 'x'.repeat(100) })
    const b = row({ slug: 'b', summary: 'x'.repeat(10) })
    const d = decidePair([a, b], new Map([['b', 5]])) // 'a' fehlt in der Map
    expect(d.winner.slug).toBe('b')
    expect(d.decidingCriterion).toBe('Verlinkungen')
  })

  it('reasoning nennt Verlinkungszahl, Inhaltslaenge und Erstellungsdatum je Zeile', () => {
    const eval_ = row({ slug: 'eval', canonical_name: 'Eval', summary: 'kurz' })
    const evals = row({ slug: 'evals', canonical_name: 'Evals', summary: 'laenger als kurz' })
    const d = decidePair([eval_, evals], new Map([['eval', 30], ['evals', 8]]))
    expect(d.reasoning[0]).toContain('GEWINNER')
    expect(d.reasoning[0]).toContain('eval')
    expect(d.reasoning[0]).toContain('30')
    expect(d.reasoning[1]).toContain('evals')
    expect(d.reasoning[1]).toContain('8')
  })
})
