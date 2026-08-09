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
export function insertTakeBarometers(container: HTMLElement): TakeBarometerPortal[] {
  const portals: TakeBarometerPortal[] = []
  const paragraphs = container.querySelectorAll('p')
  let index = 0

  paragraphs.forEach((p) => {
    if (!TAKE_RE.test(p.textContent ?? '')) return
    const found = findAnchor(p)
    const anchor = found?.id ?? `idx:${index}`
    const headline = found?.headline ?? ''
    index++

    // Idempotenz: existiert der Platzhalter schon, nur einsammeln — die
    // Portale müssen bei jedem Prozessorlauf zurückgegeben werden, sonst
    // verlöre ein Re-Render die gemounteten Widgets.
    const existing = p.nextElementSibling
    if (existing instanceof HTMLElement && existing.dataset.takeBarometer) {
      portals.push({ anchor: existing.dataset.takeBarometer, headline, element: existing })
      return
    }

    const slot = document.createElement('div')
    slot.dataset.takeBarometer = anchor
    slot.className = 'take-barometer-slot not-prose'
    p.after(slot)
    portals.push({ anchor, headline, element: slot })
  })

  return portals
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
