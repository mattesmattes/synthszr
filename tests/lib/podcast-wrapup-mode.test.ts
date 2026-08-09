/**
 * Wochenrueckblick-Modus im Podcast-Studio.
 *
 * Betreiber-Vorgabe 2026-08-09: Bei einem Wochenrueckblick sollen die beiden
 * Stimmen merken, dass es KEINE Tagesnews sind — sie fuehren durch die Tage,
 * stellen Kontexte her und sind reflektierter. Ohne diesen Hinweis arbeiten sie
 * den Rueckblick wie jeden anderen Artikel ab: Thema fuer Thema, ohne den Bogen.
 *
 * Die Erkennung laeuft ueber SLUG UND TITEL, nicht nur eines von beiden: den
 * Slug erzeugt die Wrap-up-Route deterministisch, der Titel folgt dem
 * Betreiber-Muster — aber beide sind im Editor aenderbar. Zwei Wege bedeuten,
 * dass eine Aenderung den Modus nicht still abschaltet.
 */
import { describe, expect, it } from 'vitest'
import { isWeekWrapup, wrapupPromptSection } from '@/lib/podcast/wrapup-mode'

describe('isWeekWrapup', () => {
  it('erkennt den Slug der Wrap-up-Route', () => {
    expect(isWeekWrapup('ai-week-wrap-up-2026-08-03', 'Irgendein Titel')).toBe(true)
  })

  it('erkennt den Titel nach Betreiber-Muster', () => {
    expect(isWeekWrapup('anderer-slug', 'Die AI-Themen der Woche vom 3. bis 9. August 2026')).toBe(true)
  })

  it('erkennt den Titel unabhaengig von Gross-/Kleinschreibung', () => {
    expect(isWeekWrapup('x', 'die ai-themen der woche vom 3. bis 9. august')).toBe(true)
  })

  it('haelt einen normalen Tagesartikel NICHT fuer einen Rueckblick', () => {
    expect(isWeekWrapup('ki-forscher-kreieren-echte-viren', 'KI-Forscher kreieren echte Viren')).toBe(false)
  })

  it('verkraftet fehlenden Slug oder Titel', () => {
    expect(isWeekWrapup(null, null)).toBe(false)
    expect(isWeekWrapup(undefined, undefined)).toBe(false)
    expect(isWeekWrapup('', '')).toBe(false)
  })
})

describe('wrapupPromptSection', () => {
  const de = wrapupPromptSection('de')
  const en = wrapupPromptSection('en')

  it('stellt klar, dass es KEINE Tagesnews sind', () => {
    expect(de).toMatch(/keine? Tagesausgabe|nicht die tägliche/i)
    expect(en).toMatch(/not the daily|no daily/i)
  })

  it('verlangt die Fuehrung durch die Wochentage', () => {
    expect(de).toMatch(/Montag/)
    expect(de).toMatch(/Wochentag|Tag für Tag|durch die Woche/i)
  })

  it('verlangt Kontexte und Bezuege zwischen den Tagen', () => {
    // Umlaute mitdenken: im Text stehen „ZUSAMMENHÄNGE" und „Bezüge".
    expect(de).toMatch(/Zusammenh|Bez[uü]g|Kontext/i)
  })

  it('verlangt eine reflektiertere Haltung', () => {
    expect(de).toMatch(/reflektiert/i)
    expect(en).toMatch(/reflect/i)
  })

  it('liefert Deutsch und Englisch, nicht denselben Text', () => {
    expect(de).not.toBe(en)
    expect(en).not.toMatch(/Wochenrückblick/)
  })
})
