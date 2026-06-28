import { createHash } from 'node:crypto'

/** Stabiler Mention-Hash: genau eine Mention pro (Produkt, News). NICHT vom
 *  nicht-deterministischen LLM-Excerpt abhängig (sonst Doppelzählung bei Re-Run). */
export function mentionHash(productId: string): string {
  return createHash('sha1').update(`${productId} primary`).digest('hex')
}
