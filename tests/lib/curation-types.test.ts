import { describe, expect, it } from 'vitest'
import { CURATION_ROLES, DEFAULT_CURATION_SETTINGS, RUN_SUMMARY_COLUMNS } from '@/lib/curation/types'

describe('curation types', () => {
  it('kennt genau die vier redaktionellen Rollen (story kommt erst in Phase 2)', () => {
    expect([...CURATION_ROLES]).toEqual(['topic', 'recap', 'deep_dive', 'cover_story'])
  })
  it('Shadow ist per Default AUS — scharf schaltet nur der Betreiber', () => {
    expect(DEFAULT_CURATION_SETTINGS.shadow_enabled).toBe(false)
    expect(DEFAULT_CURATION_SETTINGS.kickoff_utc).toBe('04:25')
    expect(DEFAULT_CURATION_SETTINGS.budget_usd).toBe(4)
    expect(DEFAULT_CURATION_SETTINGS.daily_budget_usd).toBe(12)
  })
  it('die Listenansicht laedt keine schweren JSON-Spalten', () => {
    const cols = RUN_SUMMARY_COLUMNS.split(',').map(s => s.trim())
    for (const heavy of ['pool', 'cards', 'story_keys', 'brief', 'plan', 'critique', 'log']) expect(cols).not.toContain(heavy)
    expect(cols).toContain('metrics')
  })
})
