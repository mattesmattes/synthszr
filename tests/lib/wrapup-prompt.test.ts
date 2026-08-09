/**
 * Der Wrap-up-Prompt.
 *
 * Geprueft wird der PROMPT-TEXT, nicht das Modellverhalten — gleiche Bauart und
 * gleiche Grenze wie tests/lib/ghostwriter-lex-tags.test.ts. Ob sich das Modell
 * an die Vorgaben haelt, ist nur an echten Laeufen zu beobachten.
 */
import { describe, expect, it } from 'vitest'
import { buildWrapupPrompt, WRAPUP_SYSTEM_PROMPT } from '@/lib/wrapup/generate'
import type { WrapupTopic } from '@/lib/wrapup/collect'

const topics: WrapupTopic[] = [
  { weekday: 'Montag', date: '2026-08-03', headline: 'Alibaba stellt Qwen vor', body: 'Text Mo.', postSlug: 'a' },
  { weekday: 'Mittwoch', date: '2026-08-05', headline: 'Weisses Haus setzt auf Geheimhaltung', body: 'Text Mi.', postSlug: 'b' },
]
const prompt = buildWrapupPrompt(topics, '3.–8. August 2026')

describe('buildWrapupPrompt', () => {
  it('enthaelt jeden Wochentag mit seiner Original-Headline', () => {
    expect(prompt).toContain('Montag')
    expect(prompt).toContain('Alibaba stellt Qwen vor')
    expect(prompt).toContain('Mittwoch')
    expect(prompt).toContain('Weisses Haus setzt auf Geheimhaltung')
  })

  it('enthaelt die Volltexte der Abschnitte', () => {
    expect(prompt).toContain('Text Mo.')
    expect(prompt).toContain('Text Mi.')
  })

  it('nennt den Wochen-Zeitraum', () => {
    expect(prompt).toContain('3.–8. August 2026')
  })

  it('gibt die Ueberschriften woertlich vor', () => {
    // Die Form "Wochentag — Original-Headline" ist Betreiber-Vorgabe. Als
    // Aufzaehlung im Prompt statt nur als Regel: das Modell soll nichts
    // umformulieren muessen.
    expect(prompt).toContain('## Montag — Alibaba stellt Qwen vor')
    expect(prompt).toContain('## Mittwoch — Weisses Haus setzt auf Geheimhaltung')
  })

  it('nennt die tatsaechliche Zahl der Nachrichten', () => {
    expect(prompt).toContain('2 Nachrichten')
  })
})

describe('WRAPUP_SYSTEM_PROMPT', () => {
  it('deckelt den Take auf 2-3 Saetze — die Haelfte der 5-7 im Tagesartikel', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/2-3 Sätze/)
  })

  it('verlangt den Vorlauftext von 3-4 Zeilen VOR den Abschnitten', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/3-4 Zeilen/)
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/große Linie/)
  })

  it('verlangt Querbezuege zwischen den Themen', () => {
    // Der eigentliche Zweck des Ein-Aufruf-Designs: ohne diese Anweisung
    // entstuenden sechs unverbundene Zusammenfassungen.
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/QUERBEZÜGE|aufeinander/)
  })

  it('verlangt eine reflektiertere Fassung statt einer Kopie', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/NEU FORMULIERT/)
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/REFLEKTIERTER/)
  })

  it('verbietet erfundene Bezuege ausdruecklich', () => {
    // Die Kehrseite der Querbezugs-Anweisung: ein Modell, das Zusammenhang
    // liefern soll, erfindet ihn notfalls.
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/Erfinde keine Bezüge/)
  })

  it('behaelt die Synthszr-Take-Markierung bei', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toContain('Synthszr Take:')
  })

  it('verbietet Company- und lex-Tags', () => {
    // Der Wrap-up verlinkt ueber die Originalartikel; Tags hier wuerden
    // Ratings und Lexikonseiten doppelt ausloesen.
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/\{Company\}/)
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/\{lex:\}/)
  })
})
