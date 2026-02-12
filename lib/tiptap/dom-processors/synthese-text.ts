// DOM processor: Style "Mattes Synthese" / "Synthszr Take" text

import { SYNTHESE_PATTERNS, isInsideHeading, isSyntheseText } from './utils'

/**
 * Process "Mattes Synthese" or "Synthszr Take" text to add styling classes.
 * Finds these markers in headings, bold elements, and plain text,
 * then highlights the last sentence of containing paragraphs.
 */
export function processMattesSyntheseText(container: HTMLElement): void {
  // First check headings
  const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6')
  headings.forEach((heading) => {
    const text = heading.textContent || ''
    if (isSyntheseText(text)) {
      heading.classList.add('mattes-synthese-heading')
    }
  })

  // Helper to highlight last sentence in a paragraph
  const highlightLastSentence = (paragraph: Element) => {
    if (paragraph.classList.contains('synthszr-last-sentence-processed')) return
    paragraph.classList.add('synthszr-last-sentence-processed')

    // Get all text content, find last sentence boundary
    const fullText = paragraph.textContent || ''
    // Find last ". " that's followed by a capital letter (start of new sentence)
    const sentenceEndRegex = /\.\s+(?=[A-ZÄÖÜ])/g
    let lastSentenceStart = 0
    let match
    while ((match = sentenceEndRegex.exec(fullText)) !== null) {
      lastSentenceStart = match.index + match[0].length
    }

    if (lastSentenceStart === 0) return // No sentence boundary found

    // Walk through text nodes to find and wrap the last sentence
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, null)
    let charCount = 0
    const nodesToWrap: Array<{ node: Text; start: number; end: number }> = []

    let textNode: Text | null
    while ((textNode = walker.nextNode() as Text | null)) {
      const nodeText = textNode.textContent || ''
      const nodeStart = charCount
      const nodeEnd = charCount + nodeText.length

      if (nodeEnd > lastSentenceStart && nodeStart < fullText.length) {
        const wrapStart = Math.max(0, lastSentenceStart - nodeStart)
        const wrapEnd = nodeText.length
        if (wrapStart < wrapEnd) {
          nodesToWrap.push({ node: textNode, start: wrapStart, end: wrapEnd })
        }
      }
      charCount = nodeEnd
    }

    // Wrap the text nodes
    for (const { node, start, end } of nodesToWrap) {
      const text = node.textContent || ''
      if (start === 0 && end === text.length) {
        // Wrap entire node
        const wrapper = document.createElement('span')
        wrapper.className = 'synthszr-last-sentence'
        node.parentNode?.insertBefore(wrapper, node)
        wrapper.appendChild(node)
      } else {
        // Split and wrap partial
        const before = text.slice(0, start)
        const toWrap = text.slice(start, end)
        const after = text.slice(end)

        const parent = node.parentNode
        if (parent) {
          if (before) {
            parent.insertBefore(document.createTextNode(before), node)
          }
          const wrapper = document.createElement('span')
          wrapper.className = 'synthszr-last-sentence'
          wrapper.textContent = toWrap
          parent.insertBefore(wrapper, node)
          if (after) {
            parent.insertBefore(document.createTextNode(after), node)
          }
          parent.removeChild(node)
        }
      }
    }
  }

  // Then check bold/strong elements
  const strongElements = container.querySelectorAll('strong, b')
  strongElements.forEach((strong) => {
    const text = strong.textContent || ''
    if (isSyntheseText(text)) {
      strong.classList.add('mattes-synthese')
      // Find parent paragraph and highlight last sentence
      let parent: Element | null = strong.parentElement
      while (parent && parent.tagName !== 'P' && parent !== container) {
        parent = parent.parentElement
      }
      if (parent && parent.tagName === 'P') {
        highlightLastSentence(parent)
      }
    }
  })

  // Also check for plain text "Synthszr Take:" that's not already in a styled element
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null
  )

  const nodesToProcess: { node: Text; pattern: RegExp; match: RegExpExecArray }[] = []
  let textNode: Text | null
  while ((textNode = walker.nextNode() as Text | null)) {
    const text = textNode.textContent || ''
    // Skip if parent is already styled or is a heading
    const parent = textNode.parentElement
    if (parent?.classList.contains('mattes-synthese') ||
        parent?.classList.contains('mattes-synthese-heading') ||
        parent?.tagName === 'STRONG' ||
        parent?.tagName === 'B' ||
        isInsideHeading(textNode)) {
      continue
    }

    for (const pattern of SYNTHESE_PATTERNS) {
      pattern.lastIndex = 0
      const match = pattern.exec(text)
      if (match) {
        nodesToProcess.push({ node: textNode, pattern, match })
        break
      }
    }
  }

  // Process nodes (wrap "Synthszr Take:" or "Synthszr Vote:" in styled span)
  for (const { node, match } of nodesToProcess) {
    const text = node.textContent || ''
    const before = text.slice(0, match.index)
    const matchedText = match[0]
    const after = text.slice(match.index + matchedText.length)

    const beforeNode = document.createTextNode(before)
    const styledSpan = document.createElement('span')
    styledSpan.className = 'mattes-synthese font-bold'
    styledSpan.textContent = matchedText
    const afterNode = document.createTextNode(after)

    const parent = node.parentNode
    if (parent) {
      parent.insertBefore(beforeNode, node)
      parent.insertBefore(styledSpan, node)
      parent.insertBefore(afterNode, node)
      parent.removeChild(node)

      // Find parent paragraph and highlight last sentence
      let paragraph: Element | null = parent as Element
      while (paragraph && paragraph.tagName !== 'P' && paragraph !== container) {
        paragraph = paragraph.parentElement
      }
      if (paragraph && paragraph.tagName === 'P') {
        highlightLastSentence(paragraph)
      }
    }
  }
}
