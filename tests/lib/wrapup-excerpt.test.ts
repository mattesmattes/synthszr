/**
 * SEO-Beschreibung des Wochenrueckblicks.
 *
 * Der Tagesartikel legt sie als DREI Bullets ab, je mit "• " davor und durch
 * Zeilenumbrueche getrennt (s. excerptLines in ghostwriter-pipeline.ts). Der
 * Wrap-up muss dasselbe Format erzeugen — sonst sieht seine Beschreibung in der
 * Artikelliste und in den Suchergebnissen anders aus als bei allen anderen
 * Beitraegen.
 */
import { describe, expect, it } from 'vitest'
import { formatExcerpt } from '@/lib/wrapup/assemble'

describe('formatExcerpt', () => {
  it('setzt je Bullet ein Aufzaehlungszeichen und trennt mit Zeilenumbruch', () => {
    expect(formatExcerpt(['Eins', 'Zwei', 'Drei'])).toBe('• Eins\n• Zwei\n• Drei')
  })

  it('verdoppelt ein vorhandenes Aufzaehlungszeichen nicht', () => {
    // Das Modell liefert es manchmal mit — dieselbe Absicherung wie im
    // Tagesartikel.
    expect(formatExcerpt(['• Eins', 'Zwei'])).toBe('• Eins\n• Zwei')
  })

  it('ignoriert leere Eintraege', () => {
    expect(formatExcerpt(['Eins', '', '  ', 'Zwei'])).toBe('• Eins\n• Zwei')
  })

  it('liefert null bei leerer Liste — dann bleibt die Spalte leer statt "•"', () => {
    expect(formatExcerpt([])).toBeNull()
    expect(formatExcerpt(undefined)).toBeNull()
  })
})
