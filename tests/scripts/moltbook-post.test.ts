/**
 * Moltbook-Post für die Agenten-Entdeckung (Welle 2, 2026-11-04): Payload,
 * Erkennung der Verifikationsaufgabe und Antwortformat. Kein Netz.
 */
import { describe, expect, it } from 'vitest'
import { buildPostPayload, formatAnswer, verificationOf, MOLTBOOK_API } from '../../scripts/moltbook-post'

describe('moltbook-post', () => {
  it('spricht nur mit www.moltbook.com (ohne www gehen Header bei der Weiterleitung verloren)', () => {
    expect(MOLTBOOK_API).toBe('https://www.moltbook.com/api/v1')
  })

  it('baut den Payload mit Submolt, Titel und Text samt Quellenkennung', () => {
    const p = buildPostPayload('ai')
    expect(p.submolt_name).toBe('ai')
    expect(p.title.length).toBeLessThanOrEqual(300)
    expect(p.content).toContain('https://www.synthszr.com/agents/skill.md?src=moltbook')
  })

  it('erkennt eine offene Verifikationsaufgabe', () => {
    const v = verificationOf({ post: { id: 'p1', verification_status: 'pending', verification: { verification_code: 'moltbook_verify_x', challenge_text: 'lObStEr', expires_at: '2026-11-04T08:05:00Z', instructions: 'two decimals' } } })
    expect(v).toEqual({ code: 'moltbook_verify_x', challenge: 'lObStEr', expiresAt: '2026-11-04T08:05:00Z', instructions: 'two decimals' })
  })

  it('meldet keine Aufgabe fuer vertrauenswuerdige Agenten', () => {
    expect(verificationOf({ post: { id: 'p1', verification_status: 'verified' } })).toBeNull()
  })

  it('formatiert Antworten mit genau zwei Nachkommastellen', () => {
    expect(formatAnswer('15')).toBe('15.00')
    expect(formatAnswer(' -3,5 ')).toBe('-3.50')
    expect(formatAnswer('84.004')).toBe('84.00')
    expect(formatAnswer('abc')).toBeNull()
  })
})
