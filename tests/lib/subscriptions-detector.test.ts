import { describe, it, expect } from 'vitest'
import { deriveProviderKey, normalizeMonthly, classifyUnsubscribe } from '@/lib/subscriptions/detector'

describe('deriveProviderKey', () => {
  it('normalisiert auf lowercase + trim', () => {
    expect(deriveProviderKey('  Stratechery ')).toBe('stratechery')
    expect(deriveProviderKey('The Information')).toBe('the information')
  })
})

describe('normalizeMonthly', () => {
  it('rechnet Intervalle auf Monat', () => {
    expect(normalizeMonthly(120, 'yearly')).toBeCloseTo(10)
    expect(normalizeMonthly(30, 'quarterly')).toBeCloseTo(10)
    expect(normalizeMonthly(5, 'weekly')).toBeCloseTo(21.67, 1)
    expect(normalizeMonthly(9, 'monthly')).toBe(9)
  })
  it('one_time/unknown → 0 (kein laufender Monatsbeitrag)', () => {
    expect(normalizeMonthly(50, 'one_time')).toBe(0)
    expect(normalizeMonthly(50, 'unknown')).toBe(0)
  })
})

describe('classifyUnsubscribe', () => {
  it('One-Click, wenn List-Unsubscribe-Post gesetzt + https-URL', () => {
    const r = classifyUnsubscribe('<https://x.com/u?abc>', 'List-Unsubscribe=One-Click', 'x.com')
    expect(r.type).toBe('oneclick')
    expect(r.target).toBe('https://x.com/u?abc')
  })
  it('http, wenn nur https-List-Unsubscribe ohne One-Click', () => {
    const r = classifyUnsubscribe('<https://x.com/u?abc>', null, 'x.com')
    expect(r.type).toBe('http')
    expect(r.target).toBe('https://x.com/u?abc')
  })
  it('mailto, wenn List-Unsubscribe mailto ist', () => {
    const r = classifyUnsubscribe('<mailto:unsub@x.com?subject=stop>', null, 'x.com')
    expect(r.type).toBe('mailto')
    expect(r.target).toBe('mailto:unsub@x.com?subject=stop')
  })
  it('login_portal für bekannte Billing-Domains ohne Header', () => {
    const r = classifyUnsubscribe(null, null, 'stripe.com')
    expect(r.type).toBe('login_portal')
  })
  it('unknown, wenn kein Header und keine bekannte Portal-Domain', () => {
    const r = classifyUnsubscribe(null, null, 'randomblog.example')
    expect(r.type).toBe('unknown')
    expect(r.target).toBeNull()
  })
})
