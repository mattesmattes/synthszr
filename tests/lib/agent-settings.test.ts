/**
 * Settings der Agenten-Takes (Spec v2 2026-10-25): Tageslimit, Schwellen,
 * Abschnittslimit, Stichtag, Not-Aus. Alles im Admin aenderbar, deshalb
 * muss das Mergen gegen Unsinn aus der DB robust sein.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_COMMENT_SETTINGS, mergeAgentCommentSettings, loadAgentCommentSettings } from '@/lib/agents/settings'

describe('mergeAgentCommentSettings', () => {
  it('fuellt fehlende und ungueltige Felder mit Defaults', () => {
    expect(mergeAgentCommentSettings({ daily_cap: 80, relevance_min: 'x', enabled: false }))
      .toEqual({ ...DEFAULT_AGENT_COMMENT_SETTINGS, daily_cap: 80, enabled: false })
    expect(mergeAgentCommentSettings(null)).toEqual(DEFAULT_AGENT_COMMENT_SETTINGS)
  })

  it('klemmt daily_cap auf 0..10000 und laesst Schwellen ausserhalb 0..1 auf dem Default', () => {
    expect(mergeAgentCommentSettings({ daily_cap: -5, relevance_min: 7 }))
      .toMatchObject({ daily_cap: 0, relevance_min: DEFAULT_AGENT_COMMENT_SETTINGS.relevance_min })
    expect(mergeAgentCommentSettings({ daily_cap: 99999 }).daily_cap).toBe(10000)
  })

  it('nimmt feed_since nur als YYYY-MM-DD', () => {
    expect(mergeAgentCommentSettings({ feed_since: '26.10.2026' }).feed_since).toBe(DEFAULT_AGENT_COMMENT_SETTINGS.feed_since)
    expect(mergeAgentCommentSettings({ feed_since: '2026-11-01' }).feed_since).toBe('2026-11-01')
  })
})

describe('loadAgentCommentSettings', () => {
  function client(value: unknown) {
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.maybeSingle = () => Promise.resolve({ data: value === undefined ? null : { value }, error: null })
    return { from: () => chain } as never
  }

  it('liest settings.agent_comments', async () => {
    expect((await loadAgentCommentSettings(client({ daily_cap: 12 }))).daily_cap).toBe(12)
  })

  it('faellt ohne Zeile auf die Defaults', async () => {
    expect(await loadAgentCommentSettings(client(undefined))).toEqual(DEFAULT_AGENT_COMMENT_SETTINGS)
  })
})
