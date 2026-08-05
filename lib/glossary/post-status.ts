/**
 * Lexikon-Stand EINES Artikels, für die Preflight-Anzeige vor dem Newsletter.
 *
 * ZWECK: die Begriffserzeugung läuft nach dem Speichern asynchron im Hintergrund
 * (rund eine Minute je Begriff). Ohne Anzeige ist von außen nicht erkennbar, ob
 * sie arbeitet, fertig ist oder stillsteht — genau die Unsicherheit, die beim
 * Batch-Lauf schon einmal wie ein stiller Absturz aussah. Deshalb hier dieselbe
 * Ampel wie bei Übersetzungen und Thumbnails: erkannt / erzeugt / illustriert /
 * verlinkt.
 *
 * Pur und ohne Datenbankzugriff, damit die Regeln testbar bleiben; das Sammeln
 * der Rohdaten macht die Route.
 */

export interface GlossaryPostStatusInput {
  /** Slugs aller im Artikel erkannten Begriffe (Kandidatenliste + verlinkte). */
  detectedSlugs: string[]
  /** Slugs, die als veröffentlichter Begriff existieren. */
  publishedSlugs: string[]
  /** Slugs mit Illustration. */
  withImageSlugs: string[]
  /** Slugs, die im Artikeltext tatsächlich eine glossaryLink-Mark tragen. */
  linkedSlugs: string[]
}

export interface GlossaryPostStatus {
  detected: number
  generated: number
  withImage: number
  linked: number
  /** 'ok' — alles erzeugt, illustriert und verlinkt.
   *  'pending' — Erzeugung läuft noch (es fehlen Begriffe oder Bilder).
   *  'unlinked' — alles erzeugt, aber im Text nicht verlinkt.
   *  'none' — im Artikel wurde kein Begriff erkannt. */
  state: 'ok' | 'pending' | 'unlinked' | 'none'
  /** Fertige Meldung für die Anzeige, deutsch. */
  label: string
}

export function computeGlossaryPostStatus(input: GlossaryPostStatusInput): GlossaryPostStatus {
  const detectedSet = new Set(input.detectedSlugs)
  const detected = detectedSet.size
  // Immer gegen die erkannten Begriffe schneiden: ein veröffentlichter Begriff,
  // der in DIESEM Artikel nicht vorkommt, darf die Quote nicht aufblähen.
  const generated = input.publishedSlugs.filter((s) => detectedSet.has(s)).length
  const withImage = input.withImageSlugs.filter((s) => detectedSet.has(s)).length
  const linked = input.linkedSlugs.filter((s) => detectedSet.has(s)).length

  if (detected === 0) {
    return { detected: 0, generated: 0, withImage: 0, linked: 0, state: 'none',
      label: 'Keine Lexikon-Begriffe im Artikel erkannt' }
  }

  if (generated < detected) {
    // Der wichtigste Fall für den Operator: die Hintergrund-Routine arbeitet noch.
    // Zahlen statt "läuft", damit erkennbar ist, DASS sie vorankommt.
    return { detected, generated, withImage, linked, state: 'pending',
      label: `${generated} von ${detected} Begriffen erzeugt — Rest läuft im Hintergrund` }
  }

  if (withImage < detected) {
    return { detected, generated, withImage, linked, state: 'pending',
      label: `${detected} Begriffe erzeugt, ${detected - withImage} ohne Illustration` }
  }

  if (linked === 0) {
    return { detected, generated, withImage, linked, state: 'unlinked',
      label: `${detected} Begriffe erzeugt, aber keiner im Artikeltext verlinkt` }
  }

  if (linked < detected) {
    // Kein Fehler: GLOSSARY_MAX_PER_ARTICLE deckelt die Marks pro Artikel, und
    // ein Begriff kann durch die Kollisionsregel (Company > Produkt > Begriff)
    // zurückstehen. Deshalb als in Ordnung gemeldet, aber mit Zahl.
    return { detected, generated, withImage, linked, state: 'ok',
      label: `${detected} Begriffe erzeugt, ${linked} im Artikeltext verlinkt` }
  }

  return { detected, generated, withImage, linked, state: 'ok',
    label: `Alle ${detected} Begriffe erzeugt, illustriert und verlinkt` }
}
