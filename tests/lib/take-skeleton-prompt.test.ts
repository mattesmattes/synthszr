/**
 * Stufe 2 der Take-Reform (2026-10-19): analytisches Skelett im Abschnitts-
 * Prompt (Mechanismus → Konsequenz → Prüfstein) und ein definiertes Menü der
 * Blickwinkel im Planungs-Prompt. Befund: 39 % der Takes enden in Prognosen
 * ohne Prüfstein, nur 22 % der Schlusssätze tragen eine Zahl, und der Auftakt
 * „Der/Die eigentliche …" entging dem bestehenden Verbot.
 */
import { describe, expect, it } from 'vitest'
import { SECTION_SYSTEM_PROMPT, TAKE_ANGLE_RULES, TAKE_ANGLE_TYPES } from '@/lib/claude/ghostwriter-pipeline'

describe('SECTION_SYSTEM_PROMPT — analytisches Skelett', () => {
  it('verlangt Mechanismus, Konsequenz und Pruefstein', () => {
    expect(SECTION_SYSTEM_PROMPT).toMatch(/MECHANISMUS/)
    expect(SECTION_SYSTEM_PROMPT).toMatch(/KONSEQUENZ/)
    expect(SECTION_SYSTEM_PROMPT).toMatch(/PRÜFSTEIN/)
  })

  it('erlaubt Prognosen nur mit Datum oder Messgroesse', () => {
    expect(SECTION_SYSTEM_PROMPT).toMatch(/Prognose[^.]*nur mit[^.]*(Datum|Messgröße)/)
  })

  it('verbietet den Auftakt „Der/Die/Das eigentliche …"', () => {
    expect(SECTION_SYSTEM_PROMPT).toMatch(/Der\/Die\/Das eigentliche/)
  })
})

describe('Planungs-Prompt — Blickwinkel-Menü', () => {
  it('definiert sieben Winkeltypen mit Praefix', () => {
    expect(TAKE_ANGLE_TYPES).toEqual(['Anreiz', 'Stückkosten', 'Engpass', 'Zweitrundeneffekt', 'Präzedenz', 'Verlierer', 'Prüfstein'])
    for (const t of TAKE_ANGLE_TYPES) expect(TAKE_ANGLE_RULES).toContain(`${t}:`)
  })

  it('verlangt, dass jeder takeAngle mit einem Typ beginnt und kein Typ den Artikel dominiert', () => {
    expect(TAKE_ANGLE_RULES).toMatch(/beginnt mit GENAU EINEM dieser Typen/)
    expect(TAKE_ANGLE_RULES).toMatch(/höchstens zweimal/)
  })
})
