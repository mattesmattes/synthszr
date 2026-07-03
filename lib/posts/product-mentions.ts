/** Findet Chart-Produkte, deren Name im Text vorkommt — mit Wortgrenzen
 *  (Unicode-aware), case-insensitive. Namen < 4 Zeichen werden übersprungen
 *  (zu viele False Positives bei Kurznamen). */
export function findMentionedProducts<T extends { canonicalName: string }>(
  contentText: string,
  products: T[],
  max = 8,
): T[] {
  const text = contentText.toLowerCase()
  const hits: T[] = []
  for (const p of products) {
    if (hits.length >= max) break
    const name = p.canonicalName.toLowerCase()
    if (name.length < 4) continue
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u')
    if (re.test(text)) hits.push(p)
  }
  return hits
}
