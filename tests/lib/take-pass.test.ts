/**
 * Stufe 4 der Take-Reform (2026-10-19): eigener Take-Durchgang mit
 * deterministischer Prüfung. Der Abschnitts-Aufruf schreibt Überschrift und
 * Zusammenfassung; der Take entsteht in einem zweiten Aufruf aus der fertigen
 * Zusammenfassung, dem Blickwinkel und den Vorbildern, wird geprüft
 * (Wortbudget, belegte Zahlen, verbotene Auftakte; Skelett- und Prognose-Regel
 * am 2026-10-20 auf Betreiber-Wunsch gestrichen) und bei Verstoß genau einmal
 * gezielt umgeschrieben.
 */
import { describe, expect, it, vi } from 'vitest'
import { TAKE_SYSTEM_PROMPT, buildTakeUserPrompt, validateTake, replaceTake, writeTake, summaryForTakePass } from '@/lib/claude/take-pass'
import { MATTES_VOICE_RULES } from '@/lib/claude/mattes-voice'

const FACTS = 'Nvidia kauft Hugging Face für 12,9 Milliarden Dollar. Die Plattform hat 41 Prozent Download-Anteil bei offenen Modellen. Der Abschluss ist für das erste Quartal geplant.'
const GOOD = 'Nvidia zahlt 12,9 Milliarden Dollar für Distribution, nicht für Modelle. Wer Gewichte verteilt, bestimmt die Standardlaufzeit, und die liegt künftig auf CUDA. AMD und die Cloud-Kataloge verlieren zuerst. Im ersten Quartal zeigt sich, ob es aufgeht: Fällt der Anteil fremder Checkpoints unter 41 Prozent, hat Nvidia die Distribution gekauft.'

const FLOWING = 'Nvidia zahlt 12,9 Milliarden Dollar für Distribution, nicht für Modelle. Wer Gewichte verteilt, bestimmt die Standardlaufzeit, und die liegt künftig auf CUDA. Verlierer sind AMD und die Cloud-Anbieter mit eigenen Modell-Katalogen, wahrscheinlich schon im ersten Quartal. Ob der Kauf aufgeht, zeigt sich am Anteil fremder Checkpoints: fällt er unter 41 Prozent, hat Nvidia die Distribution gekauft.'

describe('validateTake', () => {
  it('nimmt einen Take in Zielform an', () => {
    expect(validateTake(GOOD, FACTS)).toEqual({ ok: true, problems: [] })
  })

  it('macht keine Vorgaben zum Satzbau (Betreiber 2026-10-20): fliessend, sechs kurze oder drei lange Saetze sind gleich gueltig', () => {
    expect(validateTake(FLOWING, FACTS)).toEqual({ ok: true, problems: [] })
    const kurz = 'Nvidia kauft Distribution. 12,9 Milliarden Dollar dafür. AMD verliert zuerst. Die Cloud-Kataloge mit eigenen Modellen auch. Im ersten Quartal zeigt sich mehr. Fällt der Anteil fremder Checkpoints unter 41 Prozent, hat es sich gelohnt, wahrscheinlich sogar schneller als die Käufer selbst erwarten, und genau das ist der Punkt.'
    expect(validateTake(kurz, FACTS)).toEqual({ ok: true, problems: [] })
    const lang = (n: number) => `Satz ${n} führt eine Beobachtung über die Distribution von Modellgewichten ausführlich aus, nennt 41 Prozent und bleibt dabei im Budget: so geht das.`
    expect(validateTake(`${lang(1)} ${lang(2)} ${lang(3)}`, FACTS).problems.filter((x) => /Sätze|lange|Doppelpunkt|Satz über/.test(x))).toEqual([])
  })

  it('kennt kein Skelett mehr: „Prüfstein" als Wort ist kein Fehler (Betreiber 2026-10-20)', () => {
    const r = validateTake('Nvidia zahlt 12,9 Milliarden Dollar für Distribution. AMD verliert zuerst, wahrscheinlich schon im ersten Quartal. Prüfstein ist der Anteil fremder Checkpoints: Fällt er unter 41 Prozent, hat sich der Kauf gelohnt.', FACTS)
    expect(r.problems.join(' ')).not.toMatch(/Skelett-Wort/)
  })

  it('meldet nur das Wortbudget, keine Satzzahl', () => {
    const lang = Array.from({ length: 6 }, (_, i) => `Satz ${i + 1} mit einigen weiteren Worten und zusätzlichen Füllungen und der Zahl 41 Prozent darin, wirklich.`).join(' ')
    const r = validateTake(lang, FACTS)
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/zu lang: \d+ Wörter/)
    expect(r.problems.join(' ')).not.toMatch(/Sätze/)
    expect(validateTake('Zu kurz mit 41 Prozent.', FACTS).problems.join(' ')).toMatch(/zu kurz/)
  })

  it('meldet Zahlen ohne Beleg in Zusammenfassung oder Quelle', () => {
    const r = validateTake('Nvidia zahlt 30 Milliarden Dollar. Das ist zu viel. Der Anteil fremder Checkpoints entscheidet im ersten Quartal mit 41 Prozent.', FACTS)
    expect(r.problems.join(' ')).toMatch(/Zahl ohne Beleg: 30/)
  })

  it('prueft Prognosen nicht mehr (Prüfstein-Regel mit dem Skelett gestrichen, 2026-10-20)', () => {
    const r = validateTake('Nvidia kauft Distribution für 12,9 Milliarden Dollar. Das wird den Markt verändern. Kurz gesagt. Alle werden folgen.', FACTS)
    expect(r.problems.join(' ')).not.toMatch(/Prognose/)
  })

  it('meldet verbotene Auftakte und die Wer-Schlussfigur', () => {
    const r = validateTake('Der eigentliche Hebel ist Distribution. Nvidia zahlt dafür 12,9 Milliarden Dollar. Das reicht. Wer jetzt noch auf AMD setzt, verliert im ersten Quartal.', FACTS)
    expect(r.problems.join(' ')).toMatch(/Auftakt/)
    expect(r.problems.join(' ')).toMatch(/Wer/)
  })
})

describe('replaceTake', () => {
  it('ersetzt nur den Take-Absatz und laesst Markup danach stehen', () => {
    const section = '## Titel\n\nBericht.\n\n{Nvidia} → [Quelle](https://x)\n\n**Synthszr Take:** Alter Take. Noch einer.\n\n<!-- marker -->'
    const out = replaceTake(section, 'Neuer Take. Zweiter Satz.')
    expect(out).toContain('**Synthszr Take:** Neuer Take. Zweiter Satz.')
    expect(out).not.toContain('Alter Take')
    expect(out).toContain('<!-- marker -->')
    expect(out).toContain('{Nvidia} → [Quelle](https://x)')
  })

  it('laesst einen Abschnitt ohne Take-Marker unveraendert', () => {
    expect(replaceTake('## Titel\n\nBericht.', 'x')).toBe('## Titel\n\nBericht.')
  })
})

describe('buildTakeUserPrompt / TAKE_SYSTEM_PROMPT', () => {
  it('enthaelt Zusammenfassung, Blickwinkel, Vorbilder und Quellenauszug', () => {
    const u = buildTakeUserPrompt({ heading: 'H', summary: 'Zusammenfassung S.', sourceExcerpt: 'Quelle Q.', takeAngle: 'Engpass: X', exemplarsBlock: 'SO SCHREIBT MATTES', mattesBlock: 'MATTES-KONTEXT' })
    for (const needle of ['H', 'Zusammenfassung S.', 'Quelle Q.', 'Engpass: X', 'SO SCHREIBT MATTES', 'MATTES-KONTEXT']) expect(u).toContain(needle)
  })

  it('System-Prompt traegt Form und Verbote, aber kein Skelett und keine Quellmaterial-Sicherheit (Betreiber 2026-10-20)', () => {
    expect(TAKE_SYSTEM_PROMPT).toMatch(/50 bis 75 Wörter/)
    expect(TAKE_SYSTEM_PROMPT).not.toMatch(/SKELETT|MECHANISMUS|PRÜFSTEIN|QUELLMATERIAL-SICHERHEIT/)
    expect(TAKE_SYSTEM_PROMPT).toMatch(/Das ist kein X, sondern Y/)
    expect(TAKE_SYSTEM_PROMPT).toMatch(/ohne "Synthszr Take:"/)
  })

  it('System-Prompt traegt die Stimme aus dem Skill mattes-schreibe und keine Stakkato-Vorgaben (2026-10-20)', () => {
    expect(TAKE_SYSTEM_PROMPT).toContain(MATTES_VOICE_RULES)
    for (const needle of ['Humor durch Präzision', 'Einschübe in Klammern', 'Der große Fehler (FATAL)']) {
      expect(TAKE_SYSTEM_PROMPT).toContain(needle)
    }
    // Vom Betreiber am 2026-10-20 aus dem Take-Prompt gestrichen:
    expect(TAKE_SYSTEM_PROMPT).not.toMatch(/Natürliche Verkürzungen|Satzlänge variieren|Nie drei lange Sätze|Konkret sein, nicht abstrakt|Cotti Coffee|Unsicherheit klar markieren|So klingt es richtig|So nicht:|Schnell-Check/)
    expect(TAKE_SYSTEM_PROMPT).not.toMatch(/unter acht Wörtern|Kein Satz über|drei bis vier Sätzen|Höchstens EIN Doppelpunkt/)
    expect(TAKE_SYSTEM_PROMPT).toMatch(/Satzbau, Satzzahl und Rhythmus sind frei/)
  })
})

describe('writeTake', () => {
  it('nimmt einen gueltigen Take ohne Korrekturlauf', async () => {
    const call = vi.fn(async () => GOOD)
    const r = await writeTake({ heading: 'H', summary: FACTS, sourceExcerpt: '' }, { call })
    expect(r.take).toBe(GOOD)
    expect(r.attempts).toBe(1)
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('schreibt bei Verstoss genau einmal mit den konkreten Problemen um', async () => {
    const bad = 'Der eigentliche Hebel ist Distribution. Nvidia zahlt dafür 30 Milliarden Dollar. Das reicht.'
    const call = vi.fn(async (user: string) => (user.includes('KORREKTUR') ? GOOD : bad))
    const r = await writeTake({ heading: 'H', summary: FACTS, sourceExcerpt: '' }, { call })
    expect(call).toHaveBeenCalledTimes(2)
    const second = call.mock.calls[1][0] as string
    expect(second).toContain('KORREKTUR')
    expect(second).toMatch(/Auftakt/)
    expect(second).toMatch(/Zahl ohne Beleg: 30/)
    expect(r.take).toBe(GOOD)
    expect(r.attempts).toBe(2)
  })

  it('behaelt nach zwei Fehlversuchen die Fassung mit weniger Problemen', async () => {
    const worse = 'Der eigentliche Hebel ist Distribution. Nvidia zahlt dafür 30 Milliarden Dollar. Das wird alles ändern.'
    const better = 'Nvidia zahlt 12,9 Milliarden Dollar für Distribution. Das wird alles ändern. Kurz. Noch ein Satz mit 41 Prozent.'
    const call = vi.fn(async (user: string) => (user.includes('KORREKTUR') ? better : worse))
    const r = await writeTake({ heading: 'H', summary: FACTS, sourceExcerpt: '' }, { call })
    expect(r.take).toBe(better)
    expect(r.problems.length).toBeGreaterThan(0)
  })

  it('wirft nicht, wenn der Modellaufruf scheitert — liefert null', async () => {
    const call = vi.fn(async () => { throw new Error('Modell weg') })
    const r = await writeTake({ heading: 'H', summary: FACTS, sourceExcerpt: '' }, { call })
    expect(r.take).toBeNull()
  })
})

describe('summaryForTakePass', () => {
  it('liefert nur den Bericht: ohne Ueberschrift, Tag-/Quellenzeile, Links, Kommentare und Take', () => {
    const section = '## Titel <!-- data-queue-item-ids:a -->\n\nErster Absatz des Berichts.\n\nZweiter Absatz.\n\n{Nvidia} {AMD} → [Reuters](https://r.example)\n\n**Synthszr Take:** Alter Take.'
    expect(summaryForTakePass(section)).toBe('Erster Absatz des Berichts.\n\nZweiter Absatz.')
  })

  it('kommt ohne Take-Marker aus', () => {
    expect(summaryForTakePass('## T\n\nNur Bericht.')).toBe('Nur Bericht.')
  })
})

