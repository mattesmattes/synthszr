// DOM-Prozessor: Platzhalter für das Take-Barometer unter jedem Synthszr Take.
//
// Läuft in der Prozessor-Pipeline des TiptapRenderers NACH der Hydration —
// wie alle Prozessoren idempotent (dataset-Flag), weil processContent bei
// Re-Renders mehrfach laufen kann.

/** Ein gesetzter Platzhalter: `anchor` identifiziert den Take stabil,
 *  `element` ist das Portal-Ziel für die React-Komponente. */
export interface TakeBarometerPortal {
  anchor: string
  /** Text der Abschnitts-H2 — für den „zu: …"-Chip der Kommentarbox. */
  headline: string
  element: HTMLElement
}

/** Ergebnis der Injektion: pro Take ein inline-Barometer UND ein Block darunter
 *  für die Kommentare genau dieses Abschnitts. */
export interface TakeInjectionResult {
  barometers: TakeBarometerPortal[]
  sectionComments: TakeBarometerPortal[]
}

const TAKE_RE = /^\s*(Synthszr Take|Mattes Synthese)\s*:/i

/**
 * Findet jeden Take-Absatz und setzt dahinter einen Portal-Platzhalter.
 *
 * ANKER-STRATEGIE (Design 2026-08-09): die `data-queue-item-id` der nächsten
 * vorangehenden H2 — das ist die einzige stabile ID im Content-Modell; Takes
 * selbst sind nur per Text-Regex erkennbar. Fällt sie (Altbestand, manuelle
 * Posts), greift der Positions-Fallback `idx:N`. Der Index ist gegen
 * Text-Edits stabil genug: er verrutscht nur, wenn Abschnitte ergänzt oder
 * entfernt werden — dann verschieben sich die Zähler auf den Nachbar-Take,
 * was bei einem UI-Signal ohne Markup-Wirkung verkraftbar ist.
 */
export function insertTakeBarometers(container: HTMLElement): TakeInjectionResult {
  const barometers: TakeBarometerPortal[] = []
  const sectionComments: TakeBarometerPortal[] = []
  const paragraphs = container.querySelectorAll('p')
  let index = 0
  // Zählt, wie oft ein Basis-Anker schon vorkam. Im Wochenrückblick können zwei
  // gebündelte News DIESELBE queueItemId tragen — dann teilten sich beide Takes
  // Barometer-Votes UND Kommentare, und der Take erschiene unter dem falschen
  // Abschnitt (Betreiber-Befund 2026-08-10). Erst-Vorkommen behält den bloßen
  // Anker (bestehende Daten matchen weiter), 2.+ bekommt ein #n-Suffix.
  const seen = new Map<string, number>()

  paragraphs.forEach((p) => {
    if (!TAKE_RE.test(p.textContent ?? '')) return
    const found = findAnchor(p)
    const base = found?.id ?? `idx:${index}`
    const headline = found?.headline ?? ''
    index++
    const occ = (seen.get(base) ?? 0) + 1
    seen.set(base, occ)
    // URL-sicheres Trennzeichen (~), falls der Anker je in eine Query wandert.
    const anchor = occ > 1 ? `${base}~${occ}` : base

    // --- Inline-Barometer INNERHALB des Take-Absatzes (hinter dem letzten Satz).
    // <span>, damit es gültiges HTML im <p> bleibt. Idempotent über das
    // dataset-Flag: bei Re-Läufen nur einsammeln.
    const existingBar = p.querySelector(':scope > [data-take-barometer]')
    if (existingBar instanceof HTMLElement && existingBar.dataset.takeBarometer) {
      barometers.push({ anchor: existingBar.dataset.takeBarometer, headline, element: existingBar })
    } else {
      const slot = document.createElement('span')
      slot.dataset.takeBarometer = anchor
      slot.className = 'take-barometer-slot'
      p.appendChild(slot)
      barometers.push({ anchor, headline, element: slot })
    }

    // --- Kommentar-BLOCK direkt UNTER dem Take-Absatz. Zeigt die Takes genau
    // dieses Abschnitts (Betreiber-Wunsch: direkt am News-Artikel, nicht
    // gepoolt am Seitenende). <div> als Block, per p.after() als Geschwister.
    const existingComments = p.nextElementSibling
    if (existingComments instanceof HTMLElement && existingComments.dataset.sectionComments) {
      sectionComments.push({ anchor: existingComments.dataset.sectionComments, headline, element: existingComments })
    } else {
      const cslot = document.createElement('div')
      cslot.dataset.sectionComments = anchor
      cslot.className = 'section-comments-slot not-prose'
      p.after(cslot)
      sectionComments.push({ anchor, headline, element: cslot })
    }
  })

  return { barometers, sectionComments }
}

/** Nächste vorangehende Überschrift — über Geschwister aufwärts. Liefert die
 *  queueItemId (stabiler Anker) und den Text (für den Kommentar-Chip). Eine
 *  Überschrift OHNE queueItemId beendet die Suche nicht: erst die nächste mit
 *  ID zählt als Anker, der Text kommt trotzdem von der nächstgelegenen. */
function findAnchor(p: Element): { id: string | null; headline: string } | null {
  let node: Element | null = p
  let headline = ''
  while (node) {
    node = node.previousElementSibling
    if (node && /^H[1-6]$/.test(node.tagName)) {
      if (!headline) headline = (node.textContent ?? '').trim()
      const id = node.getAttribute('data-queue-item-id')
      if (id) return { id, headline }
    }
  }
  return headline ? { id: null, headline } : null
}
