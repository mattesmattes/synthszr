/**
 * Stufe 1 der Take-Reform (2026-10-19): Form über Wortbudget statt Satzzahl.
 * Befund aus 183 veröffentlichten Takes: p50 drei Sätze à 24 Wörter, 16 % der
 * Sätze über 30 Wörter, 81 % Doppelpunkt-Pointe — „GENAU 5 Sätze" erzeugte
 * wenige lange Schachtelsätze. Pinnt die neuen Formregeln am versendeten
 * Prompt (Muster: ghostwriter-lex-tags.test.ts).
 */
import { describe, expect, it } from 'vitest'
import { SECTION_SYSTEM_PROMPT, buildBundleSystemPrompt } from '@/lib/claude/ghostwriter-pipeline'

describe('SECTION_SYSTEM_PROMPT — Form des Takes', () => {
  it('verlangt 50 bis 75 Woerter und sonst nichts zur Satzstruktur (Betreiber 2026-10-20)', () => {
    expect(SECTION_SYSTEM_PROMPT).toMatch(/50 bis 75 Wörter/)
    expect(SECTION_SYSTEM_PROMPT).toMatch(/Satzzahl und Rhythmus sind frei/)
    // Betreiber 2026-10-21: Der Abschnitts-Prompt traegt nur noch einen kompakten Entwurfs-Block;
    // die ausfuehrlichen Take-Verbote liegen im Take-Durchgang (take-pass.ts) und im Lektorat.
    expect(SECTION_SYSTEM_PROMPT).toMatch(/SYNTHSZR TAKE \(Entwurf/)
    expect(SECTION_SYSTEM_PROMPT).toMatch(/Analysten-Flughöhe/)
    expect(SECTION_SYSTEM_PROMPT).not.toMatch(/INHALTLICHE VERBOTE|KONTRAST-KONSTRUKTIONEN|SELF-CHECK VOR ABGABE|SCHREIBSTIL:|FORM DES TAKES|MATTES-MUSTER/)
    expect(SECTION_SYSTEM_PROMPT).not.toMatch(/drei bis vier Sätze|Kein Satz über|unter acht Wörtern|Höchstens EIN Doppelpunkt|Nie drei lange Sätze/)
  })

  it('verlangt die fuenf Saetze nirgends mehr', () => {
    expect(SECTION_SYSTEM_PROMPT).not.toMatch(/GENAU 5/)
    expect(SECTION_SYSTEM_PROMPT).not.toMatch(/fünf Sätzen/)
  })
})

describe('Buendel-Prompt — Take-Form', () => {
  it('haelt den Take auch im Buendel auf dem Wortbudget und nennt keine fuenf Saetze', () => {
    const p = buildBundleSystemPrompt('topic')
    expect(p).toMatch(/50 bis 75 Wörter/)
    expect(p).not.toMatch(/drei bis vier Sätze/)
    expect(p).not.toMatch(/(^|[^0-9])5 Sätze/)   // „25 Sätze" der Zusammenfassung bleibt erlaubt
    expect(p).not.toMatch(/fünf Sätzen/)
  })
})
