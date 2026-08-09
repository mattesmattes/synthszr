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
  { weekday: 'Montag', date: '2026-08-03', headline: 'Alibaba stellt Qwen vor', body: 'Text Mo.',
    takeText: 'Synthszr Take: Langer Original-Take Mo.', headingNode: null, bodyNodes: [], postSlug: 'a' },
  { weekday: 'Mittwoch', date: '2026-08-05', headline: 'Weisses Haus setzt auf Geheimhaltung', body: 'Text Mi.',
    takeText: 'Synthszr Take: Langer Original-Take Mi.', headingNode: null, bodyNodes: [], postSlug: 'b' },
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

  it('gibt die Wochentage vor, auf die sich die Antwort beziehen muss', () => {
    // Die Ueberschriften baut die Route aus den Original-Knoten — das Modell
    // liefert nur Takes und Bezuege und muss sie ueber den Wochentag zuordnen.
    expect(prompt).toContain('Montag, Mittwoch')
  })

  it('gibt den urspruenglichen Take als Kontext mit', () => {
    // Ohne ihn schriebe das Modell einen NEUEN Take statt einer gekuerzten
    // Fassung — der Kern soll erhalten bleiben.
    expect(prompt).toContain('Langer Original-Take Mo.')
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

  it('kennt den Bezugs-Absatz als eigenes Feld', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/bridge/)
  })

  it('stellt klar, dass die Berichte NICHT umgeschrieben werden', () => {
    // Kern der Korrektur: der Bericht wird uebernommen, damit Quellenlinks und
    // Lexikon-Verlinkungen erhalten bleiben.
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/unverändert übernommen/)
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/kürzt sie NICHT/)
  })

  it('macht den fehlenden Bezug zum Normalfall, nicht zur Ausnahme', () => {
    // Ein Modell, das Zusammenhang liefern soll, erfindet ihn sonst.
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/ERFINDE KEINE BEZÜGE/)
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/Normalfall/)
  })

  it('verbietet die Take-Vorsilbe in der Modellantwort', () => {
    // Die Markierung setzt die Route deterministisch — sonst stuende sie
    // doppelt da, wenn das Modell sie mitliefert.
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/Beginne NICHT mit "Synthszr Take:"/)
  })

  it('verbietet Company- und lex-Tags', () => {
    // Der Wrap-up verlinkt ueber die Originalartikel; Tags hier wuerden
    // Ratings und Lexikonseiten doppelt ausloesen.
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/\{Company\}/)
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/\{lex:\}/)
  })

  // Betreiber-Hinweis 2026-08-09: die SEO-Beschreibung fehlte. Der Tagesartikel
  // erzeugt sie als DREI Bullets à max 65 Zeichen (plan.excerptBullets in
  // ghostwriter-pipeline.ts) — der Wrap-up muss dasselbe Format liefern, sonst
  // sieht die Beschreibung in der Artikelliste anders aus als bei allen anderen.
  it('verlangt drei Excerpt-Bullets fuer die SEO-Beschreibung', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/excerptBullets/)
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/[Dd]rei|3 /)
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/65 Zeichen/)
  })
})
