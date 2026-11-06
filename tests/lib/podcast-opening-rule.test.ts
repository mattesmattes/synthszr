/**
 * Begrüßungsregel der Skript-Vorlagen (Betreiber 2026-11-03).
 *
 * BEFUND: Der Fix vom 2026-08-15 („Einstieg und Schluss variieren statt
 * Textbaustein", 773519c5) stellte nur die DEUTSCHE Vorlage um. Die englische
 * schrieb weiter vor, die allererste Zeile MÜSSE exakt die Begrüßung sein,
 * samt fester Sprechanweisung. Seit alle Folgen englisch entstehen (21.10.)
 * und Opus 5.5 die Regel wörtlich befolgt (26.10.), begannen acht von neun
 * Folgen mit derselben Zeile plus „take it back"-Gag; der angehängte
 * EINSTIEG-Modus kam erst danach zum Zug.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const ROUTE = readFileSync('app/api/podcast/generate-script/route.ts', 'utf-8')

/** Die Vorlage als Text: vom Zuweisungs-Backtick bis zum ersten nicht
 *  maskierten Backtick (die Vorlagen enthalten \`…\`-Codeschnipsel). */
function template(name: string): string {
  const m = ROUTE.match(new RegExp(`const ${name} = \`((?:[^\`\\\\]|\\\\.)*)\``))
  if (!m) throw new Error(`${name} nicht gefunden`)
  return m[1]
}

describe('Begrüßungsregel der Skript-Vorlagen', () => {
  it.each([
    ['EN', 'DEFAULT_SCRIPT_PROMPT_EN', 'Hey, Hey and welcome to Synthesizer Daily on {weekday}, {date}{episodeSuffix}!'],
    ['DE', 'DEFAULT_SCRIPT_PROMPT_DE', 'Hey, Hey und Willkommen bei Synthesizer Daily am {weekday}, den {date}{episodeSuffix}!'],
  ])('%s: Wiedererkennungssatz ist Pflicht, aber nicht die erste Zeile', (_, name, greeting) => {
    const t = template(name)
    expect(t).toContain(greeting)
    // Die alte Vorschrift („allererste Zeile MUSS exakt …") darf nicht mehr vorkommen.
    expect(t).not.toMatch(/very first line of the script MUST|allererste Zeile des Skripts MUSS/)
    // Ebenso wenig eine feste Sprechanweisung für die Begrüßungszeile.
    expect(t).not.toMatch(/\[cheerful and warm, genuinely happy, slightly faster pacing\] Hey, Hey/)
    // Stattdessen: Cold Open erwünscht, Begrüßung nachgeschoben, Verweis auf den Einstiegs-Abschnitt.
    expect(t).toMatch(/NOT have to be the first line|NICHT die erste Zeile/)
    expect(t).toMatch(/cold open before it is explicitly welcome|Cold Open davor ist ausdrücklich erwünscht/i)
    expect(t).toMatch(/roughly 30 seconds|etwa 30 Sekunden/)
    expect(t).toMatch(/OPENING OF THIS EPISODE|EINSTIEG DIESER FOLGE/)
  })
})
