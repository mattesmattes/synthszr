// DOM processor: Hide {Company} syntax from rendered content

/**
 * Removes {CompanyName} patterns from visible text.
 * These are used for explicit company tagging but should be hidden from readers.
 */
export function hideExplicitCompanyTags(container: HTMLElement): void {
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null
  )

  const nodesToProcess: { node: Text; matches: RegExpMatchArray[] }[] = []
  let textNode: Text | null

  // Pattern matches {CompanyName} - we'll remove these from display
  const pattern = /\{([^}]+)\}/g

  while ((textNode = walker.nextNode() as Text | null)) {
    const text = textNode.textContent || ''
    const matches = [...text.matchAll(pattern)]
    if (matches.length > 0) {
      nodesToProcess.push({ node: textNode, matches })
    }
  }

  // Process nodes - remove {Company} patterns
  for (const { node, matches } of nodesToProcess) {
    let text = node.textContent || ''
    for (const match of matches) {
      text = text.replace(match[0], '')
    }
    // Clean up extra spaces
    text = text.replace(/\s+/g, ' ').trim()
    node.textContent = text
  }
}
