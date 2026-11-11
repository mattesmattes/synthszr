/**
 * Erschöpfte Ranking-Jobs (Befund 2026-11-11): vier daily-Jobs vom Juli
 * standen mit attempts = max_attempts noch auf `processing`. claim_ranking_job
 * übersprang sie, schloss sie aber nie, und die Admin-Seite zeigte den
 * jüngsten davon als aktiven Lauf.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isExhaustedJob } from '@/lib/rankings/jobs'

describe('isExhaustedJob', () => {
  it('aktiv und Versuche aufgebraucht', () => {
    expect(isExhaustedJob({ status: 'processing', attempts: 12, max_attempts: 12 })).toBe(true)
    expect(isExhaustedJob({ status: 'pending', attempts: 13, max_attempts: 12 })).toBe(true)
  })

  it('noch Versuche frei oder schon abgeschlossen', () => {
    expect(isExhaustedJob({ status: 'processing', attempts: 5, max_attempts: 12 })).toBe(false)
    expect(isExhaustedJob({ status: 'done', attempts: 12, max_attempts: 12 })).toBe(false)
    expect(isExhaustedJob({ status: 'error', attempts: 12, max_attempts: 12 })).toBe(false)
    expect(isExhaustedJob({ status: 'pending', attempts: null, max_attempts: null })).toBe(false)
  })
})

describe('Einbindung', () => {
  const jobs = readFileSync('lib/rankings/jobs.ts', 'utf-8')
  it('advance schließt erschöpfte Jobs vor dem Claim', () => {
    const advance = jobs.slice(jobs.indexOf('export async function advanceRankingJob'))
    expect(advance.indexOf('await closeExhaustedJobs(supabase)')).toBeLessThan(advance.indexOf("rpc('claim_ranking_job'"))
  })
  it('der Status zeigt keinen erschöpften Job als aktiv', () => {
    expect(jobs).toContain('.find((j) => !isExhaustedJob(j))')
  })
  it('„Lauf starten“ meldet no_job als Hinweis, nicht als Abbruch', () => {
    const page = readFileSync('app/admin/rankings/page.tsx', 'utf-8')
    expect(page).toContain("if (data.result === 'no_job')")
    expect(page).toContain('Heute schon gelaufen')
  })
})
