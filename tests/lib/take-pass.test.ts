/**
 * Stufe 4 der Take-Reform (2026-10-19): eigener Take-Durchgang mit
 * deterministischer Prüfung. Der Abschnitts-Aufruf schreibt Überschrift und
 * Zusammenfassung; der Take entsteht in einem zweiten Aufruf aus der fertigen
 * Zusammenfassung, dem Blickwinkel und den Vorbildern, wird geprüft
 * (Wortbudget, Satzlängen, belegte Zahlen, Prognose nur mit Prüfstein,
 * verbotene Auftakte) und bei Verstoß genau einmal gezielt umgeschrieben.
 */
import { describe, expect, it, vi } from 'vitest'
import { TAKE_SYSTEM_PROMPT, buildTakeUserPrompt, validateTake, replaceTake, writeTake, summaryForTakePass } from '@/lib/claude/take-pass'

const FACTS = 'Nvidia kauft Hugging Face für 12,9 Milliarden Dollar. Die Plattform hat 41 Prozent Download-Anteil bei offenen Modellen. Der Abschluss ist für das erste Quartal geplant.'
const GOOD = 'Nvidia zahlt 12,9 Milliarden Dollar für Distribution, nicht für Modelle. Wer Gewichte verteilt, bestimmt die Standardlaufzeit, und die liegt künftig auf CUDA. AMD und die Cloud-Kataloge verlieren zuerst. Der Prüfstein kommt im ersten Quartal: Fällt der Anteil fremder Checkpoints unter 41 Prozent, ist der Kauf aufgegangen.'

describe('validateTake', () => {
  it('nimmt einen Take in Zielform an', () => {
    expect(validateTake(GOOD, FACTS)).toEqual({ ok: true, problems: [] })
  })

  it('meldet Wortbudget und Satzzahl', () => {
    const lang = Array.from({ length: 6 }, (_, i) => `Satz ${i + 1} mit einigen weiteren Worten und zusätzlichen Füllungen und der Zahl 41 Prozent darin, wirklich.`).join(' ')
    const r = validateTake(lang, FACTS)
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/Wörter/)
    expect(r.problems.join(' ')).toMatch(/Sätze/)
  })

  it('meldet Schachtelsaetze, fehlenden kurzen Satz und zu viele Doppelpunkte', () => {
    const t = 'Nvidia zahlt 12,9 Milliarden Dollar, und das ist eine Summe, die zeigt, wie sehr der Konzern die Distribution offener Modelle inzwischen als strategischen Engpass begreift: Distribution: das ist der Hebel. Der zweite Satz ist ebenfalls lang genug, um die Grenze von fünfundzwanzig Wörtern deutlich zu reißen, weil er einfach nicht aufhören will. Dritter Satz mit 41 Prozent und mehreren Wörtern dazu.'
    const r = validateTake(t, FACTS)
    expect(r.problems.join(' ')).toMatch(/über 25 Wörter/)
    expect(r.problems.join(' ')).toMatch(/unter 8 Wörtern/)
    expect(r.problems.join(' ')).toMatch(/Doppelpunkt/)
  })

  it('meldet Zahlen ohne Beleg in Zusammenfassung oder Quelle', () => {
    const r = validateTake('Nvidia zahlt 30 Milliarden Dollar. Das ist zu viel. Der Prüfstein kommt im ersten Quartal mit 41 Prozent.', FACTS)
    expect(r.problems.join(' ')).toMatch(/Zahl ohne Beleg: 30/)
  })

  it('meldet Prognosen ohne Datum oder Messgroesse', () => {
    const r = validateTake('Nvidia kauft Distribution für 12,9 Milliarden Dollar. Das wird den Markt verändern. Kurz gesagt. Alle werden folgen.', FACTS)
    expect(r.problems.join(' ')).toMatch(/Prognose ohne Prüfstein/)
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

  it('System-Prompt traegt Form, Skelett und Verbote und verlangt nur den Absatz', () => {
    expect(TAKE_SYSTEM_PROMPT).toMatch(/50 bis 75 Wörter/)
    expect(TAKE_SYSTEM_PROMPT).toMatch(/MECHANISMUS/)
    expect(TAKE_SYSTEM_PROMPT).toMatch(/PRÜFSTEIN/)
    expect(TAKE_SYSTEM_PROMPT).toMatch(/Das ist kein X, sondern Y/)
    expect(TAKE_SYSTEM_PROMPT).toMatch(/ohne "Synthszr Take:"/)
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

