/**
 * DOM processor: insert a placeholder slot before the first "Synthszr Take"
 * paragraph inside the article, so the client-side renderer can mount a
 * <TipPromoBox /> into that slot via a React portal.
 *
 * Returns the inserted element (or null if no Synthszr Take was found).
 */
export function insertTipPromoSlot(container: HTMLElement): HTMLElement | null {
  // Already inserted? (idempotent during re-runs)
  const existing = container.querySelector<HTMLElement>('[data-tip-promo-slot="1"]')
  if (existing) return existing

  // Match any element whose text starts with "Synthszr Take:" (the processor
  // that styles these has not yet wrapped them when we run, so look at plain
  // text content). We fall back to marked-up versions with a data attribute.
  const candidates = Array.from(container.querySelectorAll('p, h2, h3, h4, div'))
  let target: Element | null = null

  for (const el of candidates) {
    const text = (el.textContent || '').trim().toLowerCase()
    if (text.startsWith('synthszr take') || text.startsWith('mattes synthese')) {
      target = el
      break
    }
  }

  if (!target) return null

  const slot = document.createElement('div')
  slot.dataset.tipPromoSlot = '1'
  target.parentElement?.insertBefore(slot, target)
  return slot
}
