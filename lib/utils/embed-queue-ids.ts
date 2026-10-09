/**
 * Embed queue item IDs into TipTap H2 headings for stable thumbnail matching
 *
 * Problem: The Ghostwriter generates creative German H2 headlines that differ
 * from the original news titles. When users reorder articles in the editor,
 * thumbnails can't be matched because there's no stable link.
 *
 * Solution: Match H2 headings to queue items by text similarity and embed
 * the queueItemId as an attribute on each H2 node. This ID survives reordering.
 */

interface QueueItem {
  id: string
  title: string
  content?: string | null
}

interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
}

/**
 * Normalize text for comparison (lowercase, remove punctuation)
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\säöüß]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Calculate word overlap score between two texts
 */
function calculateOverlap(a: string, b: string): number {
  const wordsA = new Set(a.split(' ').filter(w => w.length > 2))
  const wordsB = new Set(b.split(' ').filter(w => w.length > 2))

  if (wordsA.size === 0 || wordsB.size === 0) return 0

  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)))
  return intersection.size / Math.min(wordsA.size, wordsB.size)
}

/**
 * Extract text content from a TipTap node
 */
function extractText(node: TiptapNode): string {
  if (node.type === 'text' && node.text) return node.text
  if (node.content) return node.content.map(extractText).join('')
  return ''
}

/**
 * Match H2 heading text to the best queue item
 * Returns the queue item ID if a good match is found, undefined otherwise
 */
function findBestQueueItemMatch(
  headingText: string,
  queueItems: QueueItem[],
  usedIds: Set<string>
): string | undefined {
  const normalizedHeading = normalizeText(headingText)
  let bestMatch: string | undefined
  let bestScore = 0

  for (const item of queueItems) {
    if (usedIds.has(item.id)) continue // Already matched

    // Compare with queue item title
    const normalizedTitle = normalizeText(item.title)
    let score = calculateOverlap(normalizedHeading, normalizedTitle)

    // Also check content if available (for better matching)
    if (item.content) {
      const normalizedContent = normalizeText(item.content.slice(0, 500))
      const contentScore = calculateOverlap(normalizedHeading, normalizedContent)
      score = Math.max(score, contentScore * 0.8) // Content match weighted slightly lower
    }

    // Check for key word matches
    const headingWords = normalizedHeading.split(' ').filter(w => w.length > 4)
    const titleWords = normalizedTitle.split(' ').filter(w => w.length > 4)
    const keyWordMatches = headingWords.filter(w => titleWords.some(tw => tw.includes(w) || w.includes(tw)))
    if (keyWordMatches.length > 0) {
      score = Math.max(score, keyWordMatches.length * 0.25)
    }

    if (score > bestScore && score > 0.15) { // Minimum threshold
      bestScore = score
      bestMatch = item.id
    }
  }

  return bestMatch
}

/**
 * true, wenn das Heading bereits eine verbindliche queueItemId traegt (vom
 * Konverter aus dem data-queue-item-ids-Marker gesetzt, s.
 * lib/utils/markdown-to-tiptap.ts) — dann hat die Text-Heuristik dort nichts
 * mehr zu suchen.
 */
function hasMarkedQueueItemId(node: TiptapNode): boolean {
  const id = node.attrs?.queueItemId
  return typeof id === 'string' && id.length > 0
}

/**
 * Embed queue item IDs into H2 headings in TipTap content
 *
 * This mutates the content in-place and also returns it for convenience.
 *
 * Betreiber-Vorgabe 2026-10-05 (Spec Heading-Marker): Headings, die aus dem
 * Konverter bereits eine queueItemId tragen, werden uebersprungen — der
 * Marker der Pipeline ist verbindlich, die Heuristik nur noch Fallback fuer
 * unmarkierte Headings (Alt-Posts, manuell eingefuegte Abschnitte).
 *
 * @param content - TipTap JSON content (will be mutated)
 * @param queueItems - Array of queue items with id and title
 * @returns The modified content with queueItemId attributes on H2 headings
 */
export function embedQueueItemIds(
  content: Record<string, unknown>,
  queueItems: QueueItem[]
): Record<string, unknown> {
  if (!queueItems || queueItems.length === 0) {
    console.log('[embedQueueItemIds] No queue items provided, skipping')
    return content
  }

  const usedIds = new Set<string>()
  let matchCount = 0

  // Vorlauf VOR dem Matching: IDs markierter Headings — inklusive aller
  // Buendel-Mitglieder aus queueItemIds — gelten als vergeben. Sonst vergibt
  // das Fuzzy-Matching dieselbe ID ein zweites Mal an ein unmarkiertes
  // Heading, z. B. an die Einzelfassung eines Buendels, die denselben Stoff
  // traegt (BEFUND 2026-10-06). Eigener Durchlauf, weil ein markiertes Heading
  // auch NACH einem unmarkierten stehen kann.
  // Bewusst JEDE Heading-Ebene, waehrend traverse nur H2 matcht: der Konverter
  // setzt Marker auf jede Top-Level-Heading-Zeile (HEADING_LINE_RE `#{1,6}` in
  // lib/utils/markdown-to-tiptap.ts). Auch die ID eines markierten H3 gehoert
  // verbindlich diesem Abschnitt und darf an kein unmarkiertes H2 gehen.
  // Leere Eintraege aus queueItemIds ('id-2, ,id-3' oder ein Komma am Ende)
  // fallen weg, die uebrigen werden getrimmt.
  function collectMarkedIds(node: TiptapNode): void {
    if (!node) return

    if (node.type === 'heading' && hasMarkedQueueItemId(node)) {
      usedIds.add(node.attrs!.queueItemId as string)
      const ids = node.attrs?.queueItemIds
      if (typeof ids === 'string') {
        for (const id of ids.split(',')) {
          const trimmed = id.trim()
          if (trimmed) usedIds.add(trimmed)
        }
      }
    }

    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        collectMarkedIds(child)
      }
    }
  }

  function traverse(node: TiptapNode): void {
    if (!node) return

    // Check for H2 heading
    if (node.type === 'heading' && node.attrs?.level === 2) {
      const headingText = extractText(node)
      const lowerText = headingText.toLowerCase()

      // Skip "Mattes Synthese" and "Synthszr Take" headings
      const isTakeHeading = lowerText.includes('mattes synthese') ||
        lowerText.includes("mattes' synthese") ||
        lowerText.includes('synthszr take')

      if (hasMarkedQueueItemId(node)) {
        console.log(`[embedQueueItemIds] H2 "${headingText.slice(0, 40)}..." traegt bereits queue item ${(node.attrs!.queueItemId as string).slice(0, 8)} — uebersprungen`)
      } else if (!isTakeHeading) {
        const queueItemId = findBestQueueItemMatch(headingText, queueItems, usedIds)

        if (queueItemId) {
          // Ensure attrs exists and add queueItemId
          if (!node.attrs) node.attrs = { level: 2 }
          node.attrs.queueItemId = queueItemId
          usedIds.add(queueItemId)
          matchCount++
          console.log(`[embedQueueItemIds] Matched H2 "${headingText.slice(0, 40)}..." → queue item ${queueItemId.slice(0, 8)}`)
        } else {
          console.log(`[embedQueueItemIds] No match for H2 "${headingText.slice(0, 40)}..."`)
        }
      }
    }

    // Recurse into children
    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        traverse(child)
      }
    }
  }

  collectMarkedIds(content as unknown as TiptapNode)
  traverse(content as unknown as TiptapNode)

  console.log(`[embedQueueItemIds] Matched ${matchCount}/${queueItems.length} queue items to H2 headings`)
  return content
}


/**
 * Extract H2 headings with their queueItemId attributes from TipTap content
 * Used for debugging and verification
 */
export function extractH2WithQueueIds(
  content: Record<string, unknown>
): Array<{ heading: string; queueItemId?: string }> {
  const h2s: Array<{ heading: string; queueItemId?: string }> = []

  function traverse(node: TiptapNode): void {
    if (!node) return

    if (node.type === 'heading' && node.attrs?.level === 2) {
      const headingText = extractText(node)
      const lowerText = headingText.toLowerCase()

      if (!lowerText.includes('mattes synthese') &&
          !lowerText.includes("mattes' synthese") &&
          !lowerText.includes('synthszr take')) {
        h2s.push({
          heading: headingText,
          queueItemId: node.attrs?.queueItemId as string | undefined
        })
      }
    }

    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        traverse(child)
      }
    }
  }

  traverse(content as unknown as TiptapNode)
  return h2s
}
