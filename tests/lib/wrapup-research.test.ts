/**
 * Update-Recherche des Wochenrueckblicks (Spec 2026-10-24).
 *
 * Geprueft werden Prompt-Text und die Nachbearbeitung der Modellantwort — nicht
 * das Modellverhalten. Der entscheidende Teil ist die Quellen-Pruefung: ein
 * Update zaehlt nur mit einer Quelle, die NACH dem Tagesartikel datiert ist.
 * Ohne diese Schranke wuerde das Modell die Original-Nachricht aus einem
 * anderen Medium als „Entwicklung" melden.
 */
import { describe, expect, it } from 'vitest'
import { buildResearchPrompt, parseResearchResponse, researchTopicUpdate, noUpdate } from '@/lib/wrapup/research'
import type { WrapupTopic } from '@/lib/wrapup/collect'

const topic: WrapupTopic = {
  weekday: 'Dienstag', date: '2026-10-13', headline: 'OpenAI kauft Chips', body: 'Bericht.',
  takeText: 'Synthszr Take: Alt.', headingNode: null, bodyNodes: [], postSlug: 'di',
}

describe('buildResearchPrompt', () => {
  const p = buildResearchPrompt(topic, '2026-10-25')

  it('nennt Headline, Artikeldatum und Stichtag', () => {
    expect(p).toContain('OpenAI kauft Chips')
    expect(p).toContain('2026-10-13')
    expect(p).toContain('2026-10-25')
  })

  it('verlangt Quellen NACH dem Artikeldatum und das Datumsformat YYYY-MM-DD', () => {
    expect(p).toMatch(/NACH dem 2026-10-13/)
    expect(p).toContain('YYYY-MM-DD')
  })

  it('macht none zum Normalfall und verlangt das Tool report_update', () => {
    expect(p).toMatch(/Normalfall/)
    expect(p).toContain('report_update')
  })

  it('gibt Bericht und Original-Take als Kontext mit', () => {
    expect(p).toContain('Bericht.')
    expect(p).toContain('Alt.')
  })

  it('verlangt Primaerquellen und schliesst Aggregator-Redirects und Digest-Seiten aus', () => {
    // Trockenlauf 2026-10-24: das Modell lieferte einen news.google.com-Redirect
    // und ein GitHub-"AI Daily Digest"-Issue als Beleg.
    expect(p).toMatch(/news\.google\.com/)
    expect(p).toMatch(/Digest/)
    expect(p).toMatch(/Primärquelle/)
  })
})

describe('parseResearchResponse', () => {
  const ok = {
    updateLevel: 'major',
    summary: 'Nvidia <cite index="1">reagierte</cite> am 15.10.',
    sources: [
      { url: 'https://reuters.com/a', title: 'Reuters', date: '2026-10-15' },
      { url: 'https://ft.com/b', title: 'FT', date: '2026-10-16' },
    ],
  }

  it('behaelt eine belegte Stufe mit datierten Quellen und entfernt cite-Markup', () => {
    const r = parseResearchResponse(ok, '2026-10-13', '2026-10-25')
    expect(r.updateLevel).toBe('major')
    expect(r.sources).toHaveLength(2)
    expect(r.summary).toBe('Nvidia reagierte am 15.10.')
  })

  it('verwirft Quellen auf/vor dem Artikeldatum, nach dem Stichtag, ohne Datum oder ohne http-URL', () => {
    const r = parseResearchResponse({ ...ok, sources: [
      { url: 'https://a.de', title: 'a', date: '2026-10-13' },
      { url: 'https://b.de', title: 'b', date: '2026-10-26' },
      { url: 'https://c.de', title: 'c' },
      { url: 'ftp://d.de', title: 'd', date: '2026-10-14' },
      { url: 'https://e.de', title: 'e', date: '2026-10-14' },
    ] }, '2026-10-13', '2026-10-25')
    expect(r.sources.map((s) => s.title)).toEqual(['e'])
  })

  it('faellt auf none zurueck, wenn keine gueltige Quelle bleibt', () => {
    const r = parseResearchResponse(
      { ...ok, sources: [{ url: 'https://a.de', title: 'a', date: '2026-10-01' }] },
      '2026-10-13', '2026-10-25',
    )
    expect(r).toEqual({ updateLevel: 'none', summary: '', sources: [] })
  })

  it('liefert none bei unbrauchbarer Antwort und bei Stufe none trotz Quellen', () => {
    expect(parseResearchResponse(null, '2026-10-13', '2026-10-25').updateLevel).toBe('none')
    expect(parseResearchResponse({ ...ok, updateLevel: 'none' }, '2026-10-13', '2026-10-25'))
      .toEqual({ updateLevel: 'none', summary: '', sources: [] })
  })
})

describe('researchTopicUpdate', () => {
  it('ergibt none, wenn der Aufruf scheitert — der Wrap-Up darf daran nicht haengen', async () => {
    const client = { messages: { create: async () => { throw new Error('overloaded') } } }
    const r = await researchTopicUpdate(topic, { model: 'claude-sonnet-5', asOfDate: '2026-10-25', client })
    expect(r).toEqual(noUpdate('Dienstag'))
  })

  it('liest den report_update-Block und zaehlt die Web-Suchen', async () => {
    const client = { messages: { create: async () => ({
      content: [
        { type: 'server_tool_use', name: 'web_search', input: { query: 'x' } },
        { type: 'tool_use', name: 'report_update', input: {
          updateLevel: 'minor', summary: 'Neu.',
          sources: [{ url: 'https://r.de', title: 'R', date: '2026-10-14' }],
        } },
      ],
      usage: { input_tokens: 1, output_tokens: 1, server_tool_use: { web_search_requests: 3 } },
    }) } }
    const r = await researchTopicUpdate(topic, { model: 'claude-sonnet-5', asOfDate: '2026-10-25', client })
    expect(r.updateLevel).toBe('minor')
    expect(r.searches).toBe(3)
    expect(r.weekday).toBe('Dienstag')
  })
})
