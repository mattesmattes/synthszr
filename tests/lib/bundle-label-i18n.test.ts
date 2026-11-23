import { describe, expect, it } from 'vitest'
import { bundleLabel, isBundleType } from '@/lib/i18n/bundle-labels'

describe('bundleLabel', () => {
  it('de', () => { expect(bundleLabel('topic','de')).toBe('Thema des Tages'); expect(bundleLabel('recap','de')).toBe('Nachlese') })
  it('en', () => { expect(bundleLabel('topic','en')).toBe('Topic of the Day'); expect(bundleLabel('recap','en')).toBe('Recap') })
  it('fällt auf en zurück bei unbekannter locale', () => { expect(bundleLabel('topic','xx')).toBe('Topic of the Day') })
  it('liefert "Long Read" für alle Public-Locales', () => {
    for (const loc of ['de', 'en', 'fr', 'cs', 'nds']) {
      expect(bundleLabel('long_read', loc)).toBe('Long Read')
    }
  })
})

describe('isBundleType', () => {
  it('erkennt gültige Typen inklusive long_read und lehnt ungültige ab', () => {
    expect(isBundleType('long_read')).toBe(true)
    expect(isBundleType('cover_story')).toBe(true)
    expect(isBundleType('invalid')).toBe(false)
    expect(isBundleType(null)).toBe(false)
  })
})
