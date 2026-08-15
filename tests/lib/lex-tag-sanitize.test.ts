/**
 * Welche {lex:}-Tags im Artikel bleiben.
 *
 * BETREIBER-BEFUND 2026-08-15 an einem echten Post: 24 Tags, obwohl der Prompt
 * hoechstens 5 erlaubt — darunter ein kaputter ({lex:"}) und viel
 * Wirtschaftsvokabular (Go-to-Market, Underwriting, Restricted Stock Units).
 *
 * Gefehlt hat ausgerechnet "SAO", der Name eines RL-Verfahrens: genau die Sorte
 * Begriff, fuer die das Lexikon da ist. Wenn die Obergrenze nicht greift, tagged
 * das Modell BREIT statt gezielt und trifft die naheliegenden statt der
 * erklaerungsbeduerftigen.
 *
 * Eine blosse Kappung auf die ersten fuenf haette das nicht behoben — sie
 * haette die falschen behalten. Deshalb wird PRIORISIERT.
 */
import { describe, expect, it } from 'vitest'
import { sanitizeLexTags, lexTagScore, MAX_LEX_TAGS } from '@/lib/glossary/lex-tags'

describe('lexTagScore', () => {
  it('bevorzugt Abkuerzungen und Verfahrensnamen', () => {
    expect(lexTagScore('SAO')).toBeGreaterThan(lexTagScore('Go-to-Market'))
    expect(lexTagScore('RLHF')).toBeGreaterThan(lexTagScore('Underwriting'))
  })

  it('bevorzugt CamelCase-Eigennamen von Verfahren und Frameworks', () => {
    expect(lexTagScore('IndexShare')).toBeGreaterThan(lexTagScore('Restricted Stock Units'))
  })

  it('stuft gaengiges Wirtschaftsvokabular ab', () => {
    for (const w of ['Go-to-Market', 'Underwriting', 'Restricted Stock Units', 'Shadowban'])
      expect(lexTagScore(w)).toBeLessThan(lexTagScore('SAO'))
  })

  it('haelt echte KI-Fachbegriffe ueber Wirtschaftsvokabular', () => {
    expect(lexTagScore('Post-Training')).toBeGreaterThan(lexTagScore('Go-to-Market'))
  })
})

describe('sanitizeLexTags', () => {
  it('verwirft kaputte Tags', () => {
    // {lex:"} stand so im Artikel — ein Anfuehrungszeichen als "Begriff".
    const out = sanitizeLexTags('Text {lex:"} und {lex:SAO} hier.')
    expect(out).not.toContain('{lex:"}')
    expect(out).toContain('{lex:SAO}')
  })

  it('verwirft leere und einzelne Satzzeichen', () => {
    const out = sanitizeLexTags('a {lex:} b {lex:,} c {lex:SAO} d')
    expect((out.match(/\{lex:/g) || []).length).toBe(1)
  })

  it('kappt auf die Obergrenze', () => {
    const viele = Array.from({ length: 24 }, (_, i) => `{lex:Begriff${i}}`).join(' ')
    expect((sanitizeLexTags(viele).match(/\{lex:/g) || []).length).toBe(MAX_LEX_TAGS)
  })

  it('behaelt beim Kappen die FACHLICH staerksten, nicht die ersten', () => {
    // Der eigentliche Fix: SAO steht hinten, muss aber ueberleben.
    const text = ['{lex:Go-to-Market}','{lex:Underwriting}','{lex:Restricted Stock Units}',
      '{lex:Shadowban}','{lex:Onboarding}','{lex:SAO}','{lex:IndexShare}'].join(' ')
    const out = sanitizeLexTags(text)
    expect(out).toContain('{lex:SAO}')
    expect(out).toContain('{lex:IndexShare}')
  })

  it('laesst einen Text mit wenigen Tags unveraendert', () => {
    const t = 'Ein {lex:Post-Training} und ein {lex:SAO}.'
    expect(sanitizeLexTags(t)).toBe(t)
  })

  it('behaelt die Reihenfolge im Text', () => {
    const t = '{lex:SAO} dann {lex:IndexShare}'
    const out = sanitizeLexTags(t)
    expect(out.indexOf('SAO')).toBeLessThan(out.indexOf('IndexShare'))
  })

  it('kommt mit Text ohne Tags klar', () => {
    expect(sanitizeLexTags('Nur Text.')).toBe('Nur Text.')
    expect(sanitizeLexTags('')).toBe('')
  })
})
