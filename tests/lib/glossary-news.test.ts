
import { describe, expect, it } from 'vitest'

/**
 * Titel-Qualitätsfilter (2026-08-04, an der ersten vollständigen Prod-Seite
 * aufgefallen). Der Block "Aktuelle News" auf /de/glossary/inferenz zeigte als
 * Schlagzeilen: "cut inference costs", "@steph_palazzolo", "SpaceX S-1",
 * "only 15-20%". Das sind Fragmente aus der Link-Extraktion von Newsletter-
 * Quellen (beehiiv/substack), die in daily_repo als source_type='article'
 * liegen — der RPC-Filter auf source_type greift dort also nicht.
 *
 * Ein leerer News-Block ist besser als ein Twitter-Handle als Überschrift:
 * die Seite ist öffentlich und soll ein Lexikon sein.
 */
describe('looksLikeHeadline', () => {
  const ECHTE_FRAGMENTE = ['cut inference costs', '@steph_palazzolo', 'SpaceX S-1', 'only 15-20%']

  it.each(ECHTE_FRAGMENTE)('verwirft das Fragment "%s"', async (title: string) => {
    const { looksLikeHeadline } = await import('@/lib/glossary/news')
    expect(looksLikeHeadline(title)).toBe(false)
  })

  it('behält eine echte Schlagzeile aus demselben Datensatz', async () => {
    const { looksLikeHeadline } = await import('@/lib/glossary/news')
    expect(looksLikeHeadline('Less training, much more inference')).toBe(true)
  })

  it('behält eine typische deutsche Nachrichtenüberschrift', async () => {
    const { looksLikeHeadline } = await import('@/lib/glossary/news')
    expect(looksLikeHeadline('DeepSeek senkt die Preise für Inferenz erneut')).toBe(true)
  })

  it('verwirft leere und Whitespace-Titel', async () => {
    const { looksLikeHeadline } = await import('@/lib/glossary/news')
    expect(looksLikeHeadline('')).toBe(false)
    expect(looksLikeHeadline('   ')).toBe(false)
  })

  it('verwirft einen Hashtag-Titel', async () => {
    const { looksLikeHeadline } = await import('@/lib/glossary/news')
    expect(looksLikeHeadline('#AI #inference #costs today')).toBe(false)
  })
})
