// Shared utility functions for TipTap DOM processors

export const SYNTHESE_PATTERNS = [
  /mattes synthese:?/gi,
  /mattes' synthese:?/gi,
  /synthszr take:?/gi,
  /synthszr contra:?/gi,
  /synthszr vote:?/gi,
  /synthszr meent:?/gi,        // NDS (Low German)
  /pohled synthszr:?/gi,       // Czech (actual translation)
  /synthszr říká:?/gi,         // Czech alternative
  /synthszr hodnocení:?/gi,    // Czech alternative
]

export function isInsideHeading(node: Node): boolean {
  let current: Node | null = node
  while (current) {
    if (current instanceof HTMLElement) {
      const tagName = current.tagName.toLowerCase()
      if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
        return true
      }
    }
    current = current.parentNode
  }
  return false
}

export function isSyntheseText(text: string): boolean {
  const lower = text.toLowerCase()
  return lower.includes('mattes synthese') ||
         lower.includes("mattes' synthese") ||
         lower.includes('synthszr take') ||
         lower.includes('synthszr contra') ||
         lower.includes('synthszr vote') ||
         lower.includes('synthszr meent') ||       // NDS
         lower.includes('pohled synthszr') ||      // Czech
         lower.includes('synthszr říká') ||        // Czech alternative
         lower.includes('synthszr hodnocení')      // Czech alternative
}
