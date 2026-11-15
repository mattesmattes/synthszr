/**
 * Episoden-Gedächtnis (Befund 2026-11-15): Die RPC match_podcast_memory liefert
 * running_gags_called_back nicht mit. buildMemoryBrief warf „is not iterable",
 * und jede Skript-Erzeugung lief ohne Gedächtnis.
 */
import { describe, expect, it } from 'vitest'
import { buildMemoryBrief, normalizeMemoryRow, type EpisodeMemoryRow } from '@/lib/podcast/memory'

const recentRow: EpisodeMemoryRow = {
  id: 'r1',
  episode_number: 377,
  recorded_at: '2026-11-14T08:00:00Z',
  topics_covered: ['Nvidia board'],
  host_positions: [{ topic: 'Nvidia', stance: 'The board slept through it' }],
  guest_positions: [],
  running_gags_introduced: ['the carbon slip'],
  running_gags_called_back: ['the export file'],
  key_moments: ['Emma refused to call it a gamble'],
  tone_summary: 'heated',
}

// So sieht eine Zeile aus der RPC aus: ohne running_gags_called_back.
const rpcRow = {
  id: 's1',
  episode_number: 300,
  recorded_at: '2026-09-01T08:00:00Z',
  topics_covered: ['AMD'],
  host_positions: [],
  guest_positions: [],
  running_gags_introduced: ['the bouncer'],
  key_moments: [],
  tone_summary: null,
} as Partial<EpisodeMemoryRow>

describe('normalizeMemoryRow', () => {
  it('füllt fehlende Listen mit leeren Listen und lässt vorhandene stehen', () => {
    const row = normalizeMemoryRow(rpcRow)
    expect(row.running_gags_called_back).toEqual([])
    expect(row.running_gags_introduced).toEqual(['the bouncer'])
    expect(normalizeMemoryRow({ id: 'x', topics_covered: null as unknown as string[] }).topics_covered).toEqual([])
  })
})

describe('buildMemoryBrief mit Zeilen aus der RPC', () => {
  it('wirft nicht und führt die Gags beider Quellen', () => {
    const brief = buildMemoryBrief([recentRow], [normalizeMemoryRow(rpcRow)], { announceAwakening: false, locale: 'en' })
    expect(brief).toContain('the carbon slip')
    expect(brief).toContain('the export file')
    expect(brief).toContain('the bouncer')
  })
})
