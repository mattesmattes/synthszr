/**
 * Dialogregeln des Podcast-Skripts (Betreiber 2026-10-21).
 *
 * BEFUND: Die in Admin → Audio gespeicherten „Style rules" erreichten den
 * Generator nie (kein Aufrufer schickt customPrompt). Die eingebauten Prompts
 * arbeiteten mit Quoten (mind. 8× overlapping, 4 Falschstarts, 3 Studio-
 * Momente) und empfahlen Direktiv-Tags ([beat], [sip]), die die TTS-Stufe
 * löscht, ohne Stille zu erzeugen. Die neuen Regeln verlangen nur, was die
 * Kette hörbar macht, und liegen in lib/podcast/dialogue-style.ts.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DIALOGUE_STYLE_RULES_DE, DIALOGUE_STYLE_RULES_EN } from '@/lib/podcast/dialogue-style'

const ROUTE = readFileSync('app/api/podcast/generate-script/route.ts', 'utf-8')

describe('DIALOGUE_STYLE_RULES', () => {
  it.each([
    ['EN', DIALOGUE_STYLE_RULES_EN],
    ['DE', DIALOGUE_STYLE_RULES_DE],
  ])('%s: verlangt nur Hoerbares — (overlapping), Drei-Punkte-Abbruch, keine Pausen-Tags, keine Quoten', (_, rules) => {
    expect(rules).toContain('(overlapping)')
    expect(rules).toMatch(/\.\.\./)
    expect(rules).toMatch(/\[beat\]/) // wird als Verbot genannt …
    expect(rules).not.toMatch(/\[short pause\]|\[paper rustle\]|\[sip\]/) // … die restlichen toten Tags tauchen gar nicht erst auf
    expect(rules).not.toMatch(/at least \d+×|mind\. \d+×|exactly \d+|exakt \d+/i)
    expect(rules).toMatch(/Studio moments happen in speech|Studio-Momente passieren im Sprechen/) // Betreiber-Nachfrage 2026-10-21: gesprochene Studio-Momente bleiben
  })

  it('EN: Reaktionen als eigene Kurzzeilen, Gast in Ich-Form, kein Markdown im Sprechtext', () => {
    expect(DIALOGUE_STYLE_RULES_EN).toMatch(/one to three words/)
    expect(DIALOGUE_STYLE_RULES_EN).toMatch(/first person/)
    expect(DIALOGUE_STYLE_RULES_EN).toMatch(/no asterisks/)
    expect(DIALOGUE_STYLE_RULES_EN).not.toMatch(/\{weekday\}|\{date\}/) // Begrüßung regeln die Einstiegs-Modi, nicht das Beispiel
  })

  it('DE: gesprochener Text deutsch, Sprechanweisungen englisch', () => {
    expect(DIALOGUE_STYLE_RULES_DE).toMatch(/Ich-Form/)
    expect(DIALOGUE_STYLE_RULES_DE).toMatch(/\[dry, unconvinced, slow\]/)
    expect(DIALOGUE_STYLE_RULES_DE).not.toMatch(/\{weekday\}|\{date\}/)
  })
})

describe('generate-script Route — eingebaute Prompts', () => {
  it('bindet die Regeln in beide Vorlagen ein', () => {
    expect(ROUTE).toContain('${DIALOGUE_STYLE_RULES_EN}')
    expect(ROUTE).toContain('${DIALOGUE_STYLE_RULES_DE}')
  })

  it('traegt keine Quoten mehr fuer Overlapping, Falschstarts und Studio-Momente', () => {
    expect(ROUTE).not.toMatch(/at least 8×|mind\. 8×/)
    expect(ROUTE).not.toMatch(/False starts \(at least|Falschstarts \(mind\./)
    expect(ROUTE).not.toMatch(/Studio moments \(at least|Studio-Momente \(mind\./)
    expect(ROUTE).not.toMatch(/□ At least \d+× `\(overlapping\)`|□ Mind\. \d+× `\(overlapping\)`/)
  })

  it('empfiehlt keine toten Direktiv-Tags mehr', () => {
    expect(ROUTE).not.toMatch(/\*\*Directive Tags|\*\*Direktiv-Tags/)
    expect(ROUTE).not.toMatch(/\[beat\] — brief thinking pause|\[beat\] — kurze Denkpause/)
  })

  it('behaelt Struktur-Regeln: Intermezzo, Artikel-Marker, Missverstaendnisse, Meinungsverschiedenheiten', () => {
    expect(ROUTE).toMatch(/\[INTERMEZZO\]/)
    expect(ROUTE).toMatch(/\[ARTICLE N\]/)
    expect(ROUTE).toMatch(/Exactly 3 misunderstandings/)
    expect(ROUTE).toMatch(/Exakt 2 echte Meinungsverschiedenheiten/)
  })
})
