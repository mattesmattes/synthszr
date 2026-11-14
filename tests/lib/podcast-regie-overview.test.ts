/**
 * Karte „Tagesregie“ im Podcast Studio (Betreiber 2026-11-15): Nutzung und
 * Sperren je Option, deutsche Bezeichnungen, Details der gespeicherten Folgen.
 */
import { describe, expect, it } from 'vitest'
import { REGIE_AXES } from '@/lib/podcast/regie/catalog'
import { regieAxisStates, sampleRegie, type RegieHistoryEntry } from '@/lib/podcast/regie/sampler'
import { withEntry } from '@/lib/podcast/regie/history'
import { AXIS_NAMES_DE, buildRegieOverview, labelPicks } from '@/lib/podcast/regie/overview'

function history(days: number): RegieHistoryEntry[] {
  let h: RegieHistoryEntry[] = []
  for (let d = 1; d <= days; d++) {
    const date = `2026-12-${String(d).padStart(2, '0')}`
    h = withEntry(h, { date, postId: `post-${d}`, picks: sampleRegie(h, { date, postId: `post-${d}` }).picks })
  }
  return h // neueste zuerst
}

describe('regieAxisStates', () => {
  it('sperrt, was in den letzten Folgen dran war, und zählt die Nutzung', () => {
    const h = history(5)
    const states = regieAxisStates(h)
    const dramaturgy = states.find((s) => s.id === 'dramaturgy')!
    const lastThree = new Set(h.slice(0, 3).map((e) => e.picks.dramaturgy[0]))
    for (const opt of dramaturgy.options) expect(opt.blocked).toBe(lastThree.has(opt.id))
    expect(dramaturgy.options.reduce((n, o) => n + o.uses, 0)).toBe(5)
    // Was gesperrt ist, zieht die Ziehung nicht.
    const next = sampleRegie(h, { date: '2026-12-06', postId: 'post-6' })
    for (const ax of states) {
      const blocked = ax.options.filter((o) => o.blocked).map((o) => o.id)
      for (const id of next.picks[ax.id]) expect(blocked).not.toContain(id)
    }
  })

  it('eine Neu-Erzeugung zum selben Post zählt sich nicht selbst', () => {
    const h = history(2)
    const own = regieAxisStates(h, h[0].postId).find((s) => s.id === 'dramaturgy')!
    expect(own.options.find((o) => o.id === h[0].picks.dramaturgy[0])?.uses).toBe(0)
  })
})

describe('buildRegieOverview', () => {
  it('liefert alle Achsen mit deutschen Namen und Bezeichnungen', () => {
    const overview = buildRegieOverview({ lang: 'en', history: history(3) })
    expect(overview.axes.map((a) => a.id)).toEqual(REGIE_AXES.map((a) => a.id))
    expect(overview.axes.find((a) => a.id === 'devices')?.name).toBe(AXIS_NAMES_DE.devices)
    const devices = overview.axes.find((a) => a.id === 'devices')!
    expect(devices.options.find((o) => o.id === 'nicknames')?.label).toBe('Spitznamen')
    expect(overview.preview).toBeNull()
  })

  it('trennt alte Einträge ohne Details von neuen mit Plan, Fingerabdruck und Textur', () => {
    const [legacy] = history(1)
    const detailed: RegieHistoryEntry = {
      ...sampleRegie([legacy], { date: '2026-12-02', postId: 'neu' }),
      title: 'Nvidia-Drama',
      createdAt: '2026-12-02T06:00:00Z',
      directed: true,
      fill: {
        fight: { story: 'Nvidia', conflict: 'Board versagt?' }, rants: [], quickStories: [], segmentPlan: null,
        devicePlans: [{ device: 'quiz', story: 'Nvidia', idea: 'Zahl abfragen' }],
      },
      worn: { phrases: ['write it down'], shortLines: ['Noted.'], directions: [] },
      texture: { applied: false, problems: ['Zahlen geändert'] },
      echoes: ['the board launched an independent investigation'],
    }
    const overview = buildRegieOverview({ lang: 'en', history: withEntry([legacy], detailed) })
    const [neu, alt] = overview.history
    expect(alt.legacy).toBe(true)
    expect(alt.fill).toBeNull()
    expect(neu.legacy).toBe(false)
    expect(neu.title).toBe('Nvidia-Drama')
    expect(neu.texture).toEqual({ applied: false, problems: ['Zahlen geändert'] })
    expect(neu.echoes).toHaveLength(1)
    expect(neu.picks.dramaturgy?.[0]).toBeTruthy()
  })

  it('zeigt die Vorschau für den ausgewählten Post mit Bezeichnungen', () => {
    const h = history(4)
    const coords = sampleRegie(h, { date: '2026-12-05', postId: 'p5' })
    const overview = buildRegieOverview({ lang: 'de', history: h, preview: { ...coords, title: 'Neuer Post' } })
    expect(overview.preview?.title).toBe('Neuer Post')
    expect(overview.preview?.picks).toEqual(labelPicks(coords.picks))
    expect(overview.lang).toBe('de')
  })

  it('withEntry behält die Zusatzfelder', () => {
    const h = withEntry([], { date: '2026-12-01', postId: 'a', picks: sampleRegie([], { date: '2026-12-01', postId: 'a' }).picks, title: 'T', directed: false })
    expect(h[0].title).toBe('T')
    expect(h[0].directed).toBe(false)
  })
})
