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
  /**
   * Läuft für diesen Artikel gerade ein Lexikon-Lauf (Job in 'queued' oder
   * 'processing')?
   *
   * OHNE DIESE ANGABE LÜGT DIE ANZEIGE. Fehlende Begriffe hießen bisher immer
   * „Rest läuft im Hintergrund" — auch dann, wenn gar kein Job existierte.
   * Genau derselbe Fehler war am 2026-08-09 schon einmal für die
   * Illustrationen behoben worden (s. Kommentar bei `images_pending`); für die
   * Begriffe blieb er stehen. Befund 2026-08-17: 14 von 262 Begriffen offen,
   * null aktive Jobs, Spinner drehte.
   */
  runActive?: boolean
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
  /** 'pending' heisst: ein Lauf ARBEITET gerade — die Anzeige darf pollen.
   *  'images_pending' heisst: es fehlt etwas, das der 08:00-Cron nachholt —
   *  gerade laeuft nichts, worauf sich Warten lohnt. Die Unterscheidung ist
   *  nicht kosmetisch: bis zum 2026-08-09 teilten sich beide Faelle 'pending',
   *  und die UI zeigte fuer den zweiten einen Spinner mit 20s-Polling. 284
   *  Begriffe standen so tagelang da, waehrend die Anzeige Arbeit vortaeuschte. */
  state: 'ok' | 'pending' | 'generation_stalled' | 'images_pending' | 'unlinked' | 'none'
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
    const offen = detected - generated
    // NUR wenn wirklich ein Lauf arbeitet, darf hier "läuft" stehen und die
    // Anzeige pollen. Sonst wartet der Operator auf etwas, das nie kommt.
    if (input.runActive) {
      // Zahlen statt "läuft", damit erkennbar ist, DASS es vorankommt.
      return { detected, generated, withImage, linked, state: 'pending',
        label: `${generated} von ${detected} Begriffen erzeugt — Rest läuft im Hintergrund` }
    }
    return { detected, generated, withImage, linked, state: 'generation_stalled',
      label: `${generated} von ${detected} Begriffen erzeugt, ${offen} offen — gerade läuft kein Lauf. Artikel erneut speichern stößt die nächsten an.` }
  }

  if (withImage < detected) {
    // KEIN 'pending': hier arbeitet nichts. Der images-Job wird vom 08:00-Cron
    // angelegt (app/api/cron/glossary-images) — bis dahin bleibt der Stand, wie
    // er ist. Ein Spinner waere eine Falschaussage.
    return { detected, generated, withImage, linked, state: 'images_pending',
      label: `${detected} Begriffe erzeugt, ${detected - withImage} ohne Illustration — wird nachgeholt` }
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
