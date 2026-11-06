/**
 * Folgennummer in der Begrüßung und Jubiläumsfolgen (Betreiber 2026-11-06).
 * Die Nummer ist die Ausgabenummer der Website („synthszr #311 vom
 * Donnerstag, den 05.11.2026“), runde Folgen werden gefeiert.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatUpdateDate, synthszrIssueNumber } from '@/lib/i18n/config'
import { episodeGreetingSuffix, milestoneOf, milestonePromptSection } from '@/lib/podcast/episode-number'

// Lokale Kalenderteile, damit der Test in jeder Zeitzone gilt.
const am = (y: number, m: number, d: number) => new Date(y, m - 1, d, 7, 0, 0)

describe('synthszrIssueNumber', () => {
  it('ist die Nummer, die die Website zeigt', () => {
    expect(synthszrIssueNumber(am(2026, 11, 5))).toBe(311)
    expect(formatUpdateDate(am(2026, 11, 5), 'de')).toBe('synthszr #311 vom Donnerstag, den 05.11.2026')
  })

  it('zählt ab dem 29.12.2025 und wird nie negativ', () => {
    expect(synthszrIssueNumber(am(2025, 12, 29))).toBe(0)
    expect(synthszrIssueNumber(am(2025, 12, 1))).toBe(0)
    expect(synthszrIssueNumber(am(2026, 11, 6))).toBe(312)
  })
})

describe('milestoneOf', () => {
  it('feiert jede 50. Folge, jede 100. ausgiebiger', () => {
    expect(milestoneOf(350)).toBe('round')
    expect(milestoneOf(450)).toBe('round')
    expect(milestoneOf(400)).toBe('big')
    expect(milestoneOf(312)).toBe('none')
    expect(milestoneOf(0)).toBe('none')
    expect(milestoneOf(null)).toBe('none')
  })
})

describe('Begrüßung und Prompt-Abschnitt', () => {
  it('hängt die Nummer an das Datum, ohne Nummer nichts', () => {
    expect(episodeGreetingSuffix(312, 'de')).toBe(', mit Folge 312')
    expect(episodeGreetingSuffix(312, 'en')).toBe(', episode 312')
    expect(episodeGreetingSuffix(null, 'en')).toBe('')
  })

  it('nur runde Folgen bekommen den Jubiläums-Abschnitt', () => {
    expect(milestonePromptSection(312, 'en')).toBe('')
    expect(milestonePromptSection(350, 'en')).toContain('MILESTONE EPISODE')
    expect(milestonePromptSection(350, 'en')).toContain('episode 350')
    expect(milestonePromptSection(350, 'en')).toContain('two to four exchanges')
    expect(milestonePromptSection(400, 'en')).toContain('four to six exchanges')
    expect(milestonePromptSection(350, 'de')).toContain('JUBILÄUMSFOLGE')
    expect(milestonePromptSection(400, 'de')).toContain('großes Jubiläum')
  })

  it('die Route setzt Nummer und Jubiläum in den Prompt ein', () => {
    const route = readFileSync('app/api/podcast/generate-script/route.ts', 'utf-8')
    expect(route).toContain(".replaceAll('{episodeSuffix}', episodeSuffix)")
    expect(route).toContain('milestonePromptSection(publicEpisode, ttsLang)')
    expect(route).toContain('synthszrIssueNumber(postDate)')
  })
})
