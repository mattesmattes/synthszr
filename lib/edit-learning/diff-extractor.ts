/**
 * Sentence-Level Diff Extractor for TipTap Content
 *
 * Extracts individual sentence changes between two TipTap JSON documents
 * for analysis and pattern extraction.
 */

export interface SentenceInfo {
  paragraphIndex: number
  sentenceIndex: number
  text: string
}

export interface SentenceDiff {
  paragraphIndex: number
  sentenceIndex: number
  original: string
  edited: string
  changeType: 'modified' | 'deleted' | 'added'
}

export interface TipTapNode {
  type: string
  content?: TipTapNode[]
  text?: string
  attrs?: Record<string, unknown>
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

/**
 * Extract all sentences from TipTap JSON content with position info
 */
export function extractSentences(content: TipTapNode): SentenceInfo[] {
  const sentences: SentenceInfo[] = []
  let paragraphIndex = 0

  if (!content.content) return sentences

  for (const node of content.content) {
    if (isBlockElement(node)) {
      const text = extractTextFromNode(node).trim()
      if (text) {
        // Split into sentences using German-aware rules
        const nodeSentences = splitIntoSentences(text)
        nodeSentences.forEach((sentence, sentenceIndex) => {
          if (sentence.trim()) {
            sentences.push({
              paragraphIndex,
              sentenceIndex,
              text: sentence.trim(),
            })
          }
        })
      }
      paragraphIndex++
    }
  }

  return sentences
}

/**
 * Extract plain text from a TipTap node recursively
 */
function extractTextFromNode(node: TipTapNode): string {
  if (!node) return ''

  let text = ''

  // Handle text nodes
  if (node.type === 'text' && node.text) {
    text += node.text
  }

  // Handle hard breaks
  if (node.type === 'hardBreak') {
    text += ' '
  }

  // Recursively process content
  if (node.content) {
    for (const child of node.content) {
      text += extractTextFromNode(child)
    }
  }

  return text
}

/**
 * Check if a node is a block-level element
 */
function isBlockElement(node: TipTapNode): boolean {
  const blockTypes = [
    'paragraph',
    'heading',
    'blockquote',
    'listItem',
    'bulletList',
    'orderedList',
    'codeBlock',
  ]
  return blockTypes.includes(node.type)
}

/**
 * Split text into sentences using German-aware rules
 *
 * Handles:
 * - Standard sentence endings (. ! ?)
 * - German abbreviations (z.B., d.h., u.a., etc.)
 * - Quotation marks
 * - Numbers and decimals
 */
function splitIntoSentences(text: string): string[] {
  // German abbreviations that shouldn't end sentences
  const abbreviations = [
    'z\\.B\\.',
    'd\\.h\\.',
    'u\\.a\\.',
    'u\\.A\\.',
    'etc\\.',
    'bzw\\.',
    'ca\\.',
    'vgl\\.',
    'ggf\\.',
    'inkl\\.',
    'max\\.',
    'min\\.',
    'Nr\\.',
    'Dr\\.',
    'Prof\\.',
    'Mrd\\.',
    'Mio\\.',
    'vs\\.',
    'i\\.e\\.',
    'e\\.g\\.',
  ]

  // Replace abbreviations with placeholders
  let processed = text
  const placeholders: string[] = []

  abbreviations.forEach((abbr, i) => {
    const regex = new RegExp(abbr, 'gi')
    processed = processed.replace(regex, (match) => {
      placeholders.push(match)
      return `__ABBR${i}__`
    })
  })

  // Replace decimal numbers
  processed = processed.replace(/(\d)\.(\d)/g, '$1__DOT__$2')

  // Split on sentence boundaries
  // Match: sentence-ending punctuation followed by space and capital letter, or end of string
  const sentenceRegex = /([.!?])\s+(?=[A-ZÄÖÜ])|([.!?])$/g

  const parts: string[] = []
  let lastIndex = 0
  let match

  while ((match = sentenceRegex.exec(processed)) !== null) {
    const end = match.index + match[0].length
    parts.push(processed.slice(lastIndex, end).trim())
    lastIndex = end
  }

  // Add remaining text if any
  if (lastIndex < processed.length) {
    const remaining = processed.slice(lastIndex).trim()
    if (remaining) {
      parts.push(remaining)
    }
  }

  // Restore abbreviations and decimal dots
  return parts.map((part) => {
    let restored = part
    abbreviations.forEach((_, i) => {
      restored = restored.replace(new RegExp(`__ABBR${i}__`, 'g'), placeholders[i] || '')
    })
    restored = restored.replace(/__DOT__/g, '.')
    return restored
  })
}

/**
 * Extract sentence-level diffs between two TipTap documents
 *
 * Uses a combination of:
 * 1. Position-based matching (same paragraph/sentence index)
 * 2. Similarity-based matching (for moved sentences)
 * 3. Levenshtein distance for change detection
 */
export function extractSentenceDiffs(
  before: TipTapNode,
  after: TipTapNode
): SentenceDiff[] {
  const beforeSentences = extractSentences(before)
  const afterSentences = extractSentences(after)

  const diffs: SentenceDiff[] = []
  const matchedAfterIndices = new Set<number>()

  // Phase 1: Match by position and detect modifications
  for (const beforeSent of beforeSentences) {
    // Find matching sentence in after (same position or similar text)
    let bestMatch: { index: number; similarity: number } | null = null

    for (let i = 0; i < afterSentences.length; i++) {
      if (matchedAfterIndices.has(i)) continue

      const afterSent = afterSentences[i]

      // Calculate similarity
      const similarity = calculateSimilarity(beforeSent.text, afterSent.text)

      // Prefer position match with high similarity
      const samePosition =
        beforeSent.paragraphIndex === afterSent.paragraphIndex &&
        beforeSent.sentenceIndex === afterSent.sentenceIndex

      if (samePosition && similarity > 0.3) {
        bestMatch = { index: i, similarity }
        break
      }

      // Otherwise, find best similarity match
      if (similarity > 0.5 && (!bestMatch || similarity > bestMatch.similarity)) {
        bestMatch = { index: i, similarity }
      }
    }

    if (bestMatch) {
      matchedAfterIndices.add(bestMatch.index)
      const afterSent = afterSentences[bestMatch.index]

      // Only record if there's an actual change
      if (bestMatch.similarity < 0.99) {
        diffs.push({
          paragraphIndex: beforeSent.paragraphIndex,
          sentenceIndex: beforeSent.sentenceIndex,
          original: beforeSent.text,
          edited: afterSent.text,
          changeType: 'modified',
        })
      }
    } else {
      // Sentence was deleted
      diffs.push({
        paragraphIndex: beforeSent.paragraphIndex,
        sentenceIndex: beforeSent.sentenceIndex,
        original: beforeSent.text,
        edited: '',
        changeType: 'deleted',
      })
    }
  }

  // Phase 2: Find added sentences
  for (let i = 0; i < afterSentences.length; i++) {
    if (matchedAfterIndices.has(i)) continue

    const afterSent = afterSentences[i]
    diffs.push({
      paragraphIndex: afterSent.paragraphIndex,
      sentenceIndex: afterSent.sentenceIndex,
      original: '',
      edited: afterSent.text,
      changeType: 'added',
    })
  }

  return diffs
}

/**
 * Calculate similarity between two strings using Levenshtein distance
 * Returns value between 0 (completely different) and 1 (identical)
 */
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length === 0 || b.length === 0) return 0

  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase())
  const maxLength = Math.max(a.length, b.length)

  return 1 - distance / maxLength
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/**
 * Filter diffs to only include significant changes
 * Excludes trivial edits like whitespace or punctuation-only changes
 */
export function filterSignificantDiffs(diffs: SentenceDiff[]): SentenceDiff[] {
  return diffs.filter((diff) => {
    // Always include additions and deletions
    if (diff.changeType !== 'modified') return true

    // For modifications, check if it's a significant change
    const normalizedOriginal = normalizeForComparison(diff.original)
    const normalizedEdited = normalizeForComparison(diff.edited)

    // Skip if only whitespace/punctuation changed
    if (normalizedOriginal === normalizedEdited) return false

    // Skip very minor changes (less than 3 character difference in normalized form)
    const distance = levenshteinDistance(normalizedOriginal, normalizedEdited)
    if (distance < 3 && normalizedOriginal.length > 20) return false

    return true
  })
}

/**
 * Normalize text for comparison (remove punctuation, extra whitespace)
 */
function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:'"„""]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Group diffs by type for reporting
 */
export function groupDiffsByType(
  diffs: SentenceDiff[]
): Record<string, SentenceDiff[]> {
  return diffs.reduce(
    (acc, diff) => {
      if (!acc[diff.changeType]) acc[diff.changeType] = []
      acc[diff.changeType].push(diff)
      return acc
    },
    {} as Record<string, SentenceDiff[]>
  )
}
