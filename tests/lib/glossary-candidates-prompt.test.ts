/**
 * Auswahlkriterium der Kandidaten-Identifikation.
 *
 * BETREIBER-VORGABE 2026-08-08: Das Lexikon soll technische, Finanz- und
 * KI-Fachbegriffe erklären. Allgemeinverständliche deutsche Wörter gehören
 * NICHT hinein.
 *
 * Anlass waren 39 Streichungen von Hand aus einer einzigen Kandidatenliste —
 * darunter „Gabelstapler", „Baugenehmigung", „Grünstreifen", „Stallgeruch",
 * „Eintrittspreis", „Anleihe" und „Wettbewerbsvorteil". Der alte Prompt nannte
 * als Ausschluss nur „KEINE Allgemeinbegriffe, die jeder kennt", und das reichte
 * nachweislich nicht: im Kontext eines Artikels hält das Modell solche Wörter
 * für erklärungswürdig.
 *
 * Zweite Lücke: der Prompt sprach ausschließlich von „KI/Tech". Finanzbegriffe
 * waren gar nicht als Domäne genannt, obwohl das Lexikon sie führt
 * (Investment-Grade-Anleihe, Streubesitz, Cashflow …).
 *
 * Getestet wird der PROMPT-TEXT, nicht das Modellverhalten — ob sich das Modell
 * daran hält, ist nur an echten Läufen zu beobachten. Gleiche Bauart und gleiche
 * Grenze wie tests/lib/ghostwriter-lex-tags.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { buildCandidatesPrompt } from '@/lib/glossary/generate'

const prompt = buildCandidatesPrompt('Beliebiger Artikeltext.', ['inferenz'])

describe('buildCandidatesPrompt — Auswahlkriterium', () => {
  it('nennt alle drei Domänen: Technik, Finanzen, KI', () => {
    expect(prompt).toMatch(/Finanz/)
    expect(prompt).toMatch(/KI/)
    expect(prompt).toMatch(/Tech/)
  })

  it('schliesst allgemeinverstaendliche deutsche Woerter ausdruecklich aus', () => {
    expect(prompt).toMatch(/allgemeinverständlich|Allgemeinsprache/i)
  })

  it('gibt konkrete Negativ-Beispiele statt nur einer abstrakten Regel', () => {
    // Die abstrakte Fassung („keine Allgemeinbegriffe") hat in Prod nicht
    // gegriffen. Beispiele aus den tatsaechlichen Streichungen sind das
    // schaerfste verfuegbare Signal.
    expect(prompt).toMatch(/Gabelstapler/)
    expect(prompt).toMatch(/Baugenehmigung/)
  })

  it('schliesst Ad-hoc-Wortschoepfungen aus dem Artikeltext aus', () => {
    // Zweite Gruppe der Streichungen: „API-Mauern", „Bürokratisches
    // Niemandsland", „Digitalisierungsrendite" — Formulierungen des Autors, die
    // ausserhalb dieses einen Artikels niemand nachschlaegt.
    expect(prompt).toMatch(/Wortschöpfung|Ad-hoc|eigene Formulierung/i)
  })

  it('nennt weiterhin den Test auf fehlendes Vorwissen', () => {
    // Die bestehende Anforderung darf nicht verlorengehen: erklaerungsbeduerftig
    // BLEIBT das Kriterium, es wird nur nach unten abgegrenzt.
    expect(prompt).toMatch(/ohne Vorwissen|Vorwissen/)
  })

  it('behaelt den Ausschluss von Firmen- und Produktnamen', () => {
    expect(prompt).toMatch(/KEINE Firmennamen/)
    expect(prompt).toMatch(/KEINE Produktnamen/)
  })

  it('reicht bekannte Slugs und den Artikeltext weiter', () => {
    expect(prompt).toContain('inferenz')
    expect(prompt).toContain('Beliebiger Artikeltext.')
  })
})
