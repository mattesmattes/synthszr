import { describe, it, expect } from 'vitest'
import { deriveProviderKey, normalizeMonthly, classifyUnsubscribe, buildDetectPrompt, parseDetectResponse } from '@/lib/subscriptions/detector'

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
  it('login_portal auch für echte Subdomain, NICHT für Namens-Suffix', () => {
    expect(classifyUnsubscribe(null, null, 'billing.stripe.com').type).toBe('login_portal')
    expect(classifyUnsubscribe(null, null, 'evilstripe.com').type).toBe('unknown')
    expect(classifyUnsubscribe(null, null, 'mygoogle.com').type).toBe('unknown')
  })
  it('unknown, wenn kein Header und keine bekannte Portal-Domain', () => {
    const r = classifyUnsubscribe(null, null, 'randomblog.example')
    expect(r.type).toBe('unknown')
    expect(r.target).toBeNull()
  })
})

describe('buildDetectPrompt', () => {
  it('nummeriert die Mails und nennt Absender + Betreff', () => {
    const prompt = buildDetectPrompt([{ from: 'Stratechery <a@stratechery.com>', subject: 'Receipt', snippet: '$12' }])
    expect(prompt).toContain('0.')
    expect(prompt).toContain('stratechery.com')
    expect(prompt).toContain('Receipt')
  })
})

describe('parseDetectResponse', () => {
  it('nimmt nur gültige Indizes mit isPaid=true', () => {
    const raw = { results: [
      { index: 0, is_paid: true, provider_name: 'Stratechery', amount: 12, currency: 'USD', interval: 'monthly', confidence: 0.9 },
      { index: 5, is_paid: true, provider_name: 'X', amount: 1, currency: 'USD', interval: 'monthly', confidence: 0.9 }, // out of range
    ] }
    const m = parseDetectResponse(raw, 1)
    expect(m.size).toBe(1)
    expect(m.get(0)?.providerName).toBe('Stratechery')
  })
  it('ignoriert ungültige interval-Werte → unknown', () => {
    const raw = { results: [{ index: 0, is_paid: true, provider_name: 'X', amount: 5, currency: 'EUR', interval: 'bogus', confidence: 0.5 }] }
    const m = parseDetectResponse(raw, 1)
    expect(m.get(0)?.interval).toBe('unknown')
  })
})
