// Task 13: Ghostwriter setzt {lex:}-Tags — pinnt die vier Regeln der
// FACHBEGRIFF-TAGS-Anweisung im Section-System-Prompt (der von writeSection
// UND writeBundleSection versendete Prompt, da BUNDLE_SYSTEM_PROMPT =
// SECTION_SYSTEM_PROMPT + Addendum).
//
// SECTION_SYSTEM_PROMPT ist eine statische Konstante ohne Per-Call-
// Interpolation — ein Mock des Anthropic-SDK würde denselben String nur über
// einen viel schwereren Umweg (Modellauflösung, Retrieval-Mocks) sichtbar
// machen, ohne mehr zu beweisen. Der direkte String-Test prüft exakt den
// Prompt-Text, der bei jedem Section-Call versendet wird.
//
// Grenze: das prüft nur, WAS der Prompt sagt — nicht, ob das Modell sich
// daran hält (Tag-Setzung, Cap-Einhaltung, keine Tags in Überschrift/Take
// sind Modellverhalten und nur gegen echte Läufe beobachtbar).
import { describe, expect, it } from 'vitest'
import { SECTION_SYSTEM_PROMPT, PROOFREADING_PROMPT } from '@/lib/claude/ghostwriter-pipeline'

describe('SECTION_SYSTEM_PROMPT — {lex:}-Direktive', () => {
  it('nennt das exakte Tag-Format {lex:Begriff}', () => {
    expect(SECTION_SYSTEM_PROMPT).toContain('{lex:Begriff}')
  })

  it('verlangt die Markierung bei der ERSTEN Erwähnung', () => {
    expect(SECTION_SYSTEM_PROMPT).toMatch(/ERSTEN Erwähnung/)
  })

  it('deckelt auf maximal 5 Tags im GESAMTEN Artikel', () => {
    expect(SECTION_SYSTEM_PROMPT).toMatch(/[Mm]aximal 5 \{lex:\}-Tags im GESAMTEN Artikel/)
  })

  it('verbietet die Markierung explizit in Überschrift und Synthszr Take', () => {
    expect(SECTION_SYSTEM_PROMPT).toMatch(/NIEMALS in der Überschrift/)
    expect(SECTION_SYSTEM_PROMPT).toMatch(/NIEMALS im Synthszr Take/)
  })

  it('grenzt Firmen-/Produktnamen und Allgemeinbegriffe explizit aus (keine Company-Tag-Dopplung)', () => {
    expect(SECTION_SYSTEM_PROMPT).toMatch(/KEINE Firmennamen, KEINE Produktnamen, KEINE Allgemeinbegriffe/)
  })
})

describe('Proofreading-Erhaltungsliste', () => {
  it('führt {lex:...} neben {Company} als unveränderlich gelistete Markup-Form', () => {
    // Ohne diese Ergänzung würde der ganzheitliche Proofreading-Pass (der auf
    // dem fertigen Artikeltext läuft, nachdem alle Sections geschrieben sind)
    // {lex:}-Tags stillschweigend umschreiben oder entfernen können — er kennt
    // bisher nur {Company} als strukturell bedeutsames Markup.
    const rule9 = PROOFREADING_PROMPT.match(/9\. Markdown-Formatierung \(([^)]+)\)/)
    expect(rule9?.[1]).toContain('{lex:...}')
    expect(rule9?.[1]).toContain('{Company}')
  })
})
