/**
 * Filter-Pillen der News-Queue (Betreiber-Vorgabe 2026-10-05): Ist keine Pille
 * aktiv, zeigt „Pending" nur den REST — Meldungen, die keine der Pillen trifft.
 * Wer eine OpenAI-Pille angelegt hat, soll ohne Auswahl keine OpenAI-Meldungen
 * mehr in der Liste sehen; die findet er über die Pille selbst.
 */
import { describe, expect, it } from 'vitest'
import { filterByTags } from '@/lib/news-queue/tag-filter'

type Item = { id: string; text: string }
const items: Item[] = [
  { id: 'openai', text: 'OpenAI launches GPT-6' },
  { id: 'broadcom', text: 'Broadcom raises debt for Anthropic chips' },
  { id: 'techpresso', text: 'HyperGuide reasoning paper | Techpresso' },
  { id: 'servicenow', text: 'We built an AI agent for ServiceNow' },
  { id: 'evals', text: 'AI Evals in Practice | ByteByteGo' },
]
const haystackOf = (i: Item) => i.text
const labels = ['OpenAI', 'Anthropic', 'Techpresso']
const ids = (xs: Item[]) => xs.map((x) => x.id)

describe('filterByTags', () => {
  it('zeigt mit aktiver Pille nur deren Treffer', () => {
    expect(ids(filterByTags(items, { activeLabel: 'Anthropic', allLabels: labels, restMode: true, haystackOf }))).toEqual(['broadcom'])
  })

  it('zeigt ohne aktive Pille im Rest-Modus nur Meldungen, die keine Pille trifft', () => {
    expect(ids(filterByTags(items, { activeLabel: null, allLabels: labels, restMode: true, haystackOf }))).toEqual(['servicenow', 'evals'])
  })

  it('zeigt ohne aktive Pille und ohne Rest-Modus alles (Selected, Used …)', () => {
    expect(filterByTags(items, { activeLabel: null, allLabels: labels, restMode: false, haystackOf })).toHaveLength(5)
  })

  it('vergleicht ohne Groß-/Kleinschreibung und ohne Randleerzeichen', () => {
    expect(ids(filterByTags(items, { activeLabel: null, allLabels: ['  openai ', 'TECHPRESSO'], restMode: true, haystackOf })))
      .toEqual(['broadcom', 'servicenow', 'evals'])
  })

  it('lässt leere Pillen-Namen außen vor — sonst träfe die Suche jede Meldung', () => {
    expect(filterByTags(items, { activeLabel: null, allLabels: ['', '   '], restMode: true, haystackOf })).toHaveLength(5)
  })

  it('zeigt ohne angelegte Pillen alles, auch im Rest-Modus', () => {
    expect(filterByTags(items, { activeLabel: null, allLabels: [], restMode: true, haystackOf })).toHaveLength(5)
  })
})
