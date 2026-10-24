/**
 * Der Wrap-up-Prompt.
 *
 * Geprueft wird der PROMPT-TEXT, nicht das Modellverhalten — gleiche Bauart und
 * gleiche Grenze wie tests/lib/ghostwriter-lex-tags.test.ts. Ob sich das Modell
 * an die Vorgaben haelt, ist nur an echten Laeufen zu beobachten.
 */
import { describe, expect, it } from 'vitest'
import { buildWrapupPrompt, WRAPUP_SYSTEM_PROMPT, WRAPUP_TOOL } from '@/lib/wrapup/generate'
import type { TopicUpdate } from '@/lib/wrapup/research'
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

// --- Synthszr Update (Spec 2026-10-24) -------------------------------------
// Das Modell bekommt je Thema das Recherche-Ergebnis als Kontext. Bei `major`
// darf es Bericht-Knoten weglassen — dafuer muss es die Knoten mit ihrem
// bodyNodes-Index sehen; textlose Knoten (Bilder) behalten ihren Index, damit
// keepParagraphs auf dieselben Positionen zeigt wie assemble.ts.
const major: TopicUpdate = {
  weekday: 'Montag', updateLevel: 'major',
  summary: 'Alibaba zog das Modell am 14.10. zurück.',
  sources: [{ url: 'https://reuters.com/q', title: 'Reuters', date: '2026-10-14' }],
  searches: 3,
}
const topicsMitKnoten: WrapupTopic[] = topics.map((t) => t.weekday === 'Montag' ? { ...t, bodyNodes: [
  { type: 'paragraph', content: [{ type: 'text', text: 'Text Mo.' }] },
  { type: 'image', attrs: { src: 'x' } },
  { type: 'paragraph', content: [{ type: 'text', text: 'Zweiter Absatz Mo.' }] },
] } : t)

describe('buildWrapupPrompt mit Updates', () => {
  it('markiert Themen ohne Recherche-Ergebnis als "RECHERCHE-UPDATE: keines"', () => {
    expect(buildWrapupPrompt(topics, 'W')).toMatch(/RECHERCHE-UPDATE: keines/)
  })

  it('gibt Stufe, Zusammenfassung und Quellen eines Updates mit', () => {
    const p = buildWrapupPrompt(topicsMitKnoten, 'W', [major])
    expect(p).toContain('Stufe: major')
    expect(p).toContain('zog das Modell am 14.10. zurück')
    expect(p).toContain('https://reuters.com/q')
    expect(p).toContain('(2026-10-14)')
  })

  it('nummeriert bei major die Bericht-Knoten nach bodyNodes-Index und ueberspringt textlose Knoten', () => {
    const p = buildWrapupPrompt(topicsMitKnoten, 'W', [major])
    expect(p).toContain('[0] Text Mo.')
    expect(p).toContain('[2] Zweiter Absatz Mo.')
    expect(p).not.toContain('[1]')
  })

  it('nummeriert bei minor nicht', () => {
    expect(buildWrapupPrompt(topicsMitKnoten, 'W', [{ ...major, updateLevel: 'minor' }])).not.toContain('[0]')
  })
})

describe('WRAPUP_SYSTEM_PROMPT — Updates', () => {
  it('kennt die drei Stufen mit Wortbudgets', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/40 bis 60 Wörter/)
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/bis 120 Wörter/)
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/minor/)
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/major/)
  })

  it('laesst das Update den Take ersetzen und verbietet dessen Vorsilbe', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/ersetzt den Take/)
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/Beginne NICHT mit "Synthszr Update:"/)
  })

  it('bindet Fakten des Updates an die Recherche und verlangt das Urteil ueber den Original-Take', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/RECHERCHE-UPDATE/)
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/gehalten hat/)
  })

  it('regelt keepParagraphs: nur major, Index 0 bleibt, etwa die Haelfte, mindestens zwei', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/keepParagraphs/)
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/NUR bei major/i)
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/\[0\]/)
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/Hälfte/)
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/mindestens zwei/)
  })

  it('laesst das Intro Updates anteasern, aber ohne Updates keinen Teaser', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/höchstens zwei Sätzen/)
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/kein Teaser/)
  })
})

describe('WRAPUP_TOOL', () => {
  it('kennt update und keepParagraphs je Abschnitt, take ist nicht mehr Pflicht', () => {
    const item = WRAPUP_TOOL.input_schema.properties.sections.items
    expect(Object.keys(item.properties)).toEqual(expect.arrayContaining(['take', 'update', 'keepParagraphs']))
    expect(item.required).toEqual(['weekday'])
  })
})
