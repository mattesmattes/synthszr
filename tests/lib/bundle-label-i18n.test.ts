import { describe, expect, it } from 'vitest'
import { bundleLabel } from '@/lib/i18n/bundle-labels'

describe('bundleLabel', () => {
  it('de', () => { expect(bundleLabel('topic','de')).toBe('Thema des Tages'); expect(bundleLabel('recap','de')).toBe('Nachlese') })
  it('en', () => { expect(bundleLabel('topic','en')).toBe('Topic of the Day'); expect(bundleLabel('recap','en')).toBe('Recap') })
  it('fällt auf en zurück bei unbekannter locale', () => { expect(bundleLabel('topic','xx')).toBe('Topic of the Day') })
})
