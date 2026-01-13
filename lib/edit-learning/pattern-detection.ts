/**
 * Pattern Detection in Generated Text
 *
 * Finds where learned patterns were applied in generated content
 * and returns positions for inline highlighting.
 */

import type { LearnedPattern } from './retrieval'

export interface DetectedPatternMatch {
  patternId: string
  pattern: LearnedPattern
  // Position in plain text
  textStart: number
  textEnd: number
  matchedText: string
  // Position in TipTap structure
  paragraphIndex: number
  charStartInParagraph: number
  charEndInParagraph: number
}

interface TipTapNode {
  type: string
  content?: TipTapNode[]
  text?: string
  attrs?: Record<string, unknown>
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

/**
 * Detect where patterns were applied in generated TipTap content
 *
 * @param content TipTap JSON content
 * @param patterns Patterns that were used during generation
 * @returns Array of detected matches with positions
 */
export function detectPatternsInContent(
  content: TipTapNode,
  patterns: LearnedPattern[]
): DetectedPatternMatch[] {
  const matches: DetectedPatternMatch[] = []

  if (!content.content || patterns.length === 0) return matches

  // Process each paragraph
  let paragraphIndex = 0

  for (const node of content.content) {
    if (isBlockElement(node)) {
      const paragraphText = extractTextFromNode(node)

      // Check each pattern for matches in this paragraph
      for (const pattern of patterns) {
        const patternMatches = findPatternInText(paragraphText, pattern)

        for (const match of patternMatches) {
          matches.push({
            patternId: pattern.id,
            pattern,
            textStart: match.start,
            textEnd: match.end,
            matchedText: match.text,
            paragraphIndex,
            charStartInParagraph: match.start,
            charEndInParagraph: match.end,
          })
        }
      }

      paragraphIndex++
    }
  }

  return matches
}

/**
 * Find pattern matches in a text string
 */
function findPatternInText(
  text: string,
  pattern: LearnedPattern
): Array<{ start: number; end: number; text: string }> {
  const matches: Array<{ start: number; end: number; text: string }> = []

  // For replacement patterns, look for the preferred_form
  if (pattern.pattern_type === 'replacement' && pattern.preferred_form) {
    const searchTerm = pattern.preferred_form.toLowerCase()
    const textLower = text.toLowerCase()

    let pos = 0
    while (pos < textLower.length) {
      const foundIndex = textLower.indexOf(searchTerm, pos)
      if (foundIndex === -1) break

      // Check word boundaries
      const beforeOk =
        foundIndex === 0 || !isWordChar(textLower[foundIndex - 1])
      const afterOk =
        foundIndex + searchTerm.length >= textLower.length ||
        !isWordChar(textLower[foundIndex + searchTerm.length])

      if (beforeOk && afterOk) {
        matches.push({
          start: foundIndex,
          end: foundIndex + searchTerm.length,
          text: text.slice(foundIndex, foundIndex + searchTerm.length),
        })
      }

      pos = foundIndex + 1
    }
  }

  // For trigger-based patterns, use the trigger regex
  if (pattern.trigger_pattern) {
    try {
      const regex = new RegExp(pattern.trigger_pattern, 'gi')
      let match

      while ((match = regex.exec(text)) !== null) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
        })
      }
    } catch {
      // Invalid regex, skip
    }
  }

  return matches
}

function isWordChar(char: string): boolean {
  return /[\wäöüß]/i.test(char)
}

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

function extractTextFromNode(node: TipTapNode): string {
  if (!node) return ''

  let text = ''

  if (node.type === 'text' && node.text) {
    text += node.text
  }

  if (node.type === 'hardBreak') {
    text += ' '
  }

  if (node.content) {
    for (const child of node.content) {
      text += extractTextFromNode(child)
    }
  }

  return text
}

/**
 * Convert detected matches to TipTap decoration format
 * Returns positions relative to the document for highlighting
 */
export function matchesToDecorations(
  content: TipTapNode,
  matches: DetectedPatternMatch[]
): Array<{
  from: number
  to: number
  patternId: string
  pattern: LearnedPattern
  matchedText: string
}> {
  if (!content.content) return []

  const decorations: Array<{
    from: number
    to: number
    patternId: string
    pattern: LearnedPattern
    matchedText: string
  }> = []

  // Calculate absolute positions by walking through the document
  let absolutePos = 1 // TipTap positions start at 1
  let paragraphIndex = 0

  for (const node of content.content) {
    if (isBlockElement(node)) {
      const paragraphText = extractTextFromNode(node)

      // Find matches in this paragraph
      const paragraphMatches = matches.filter(
        (m) => m.paragraphIndex === paragraphIndex
      )

      for (const match of paragraphMatches) {
        decorations.push({
          from: absolutePos + match.charStartInParagraph,
          to: absolutePos + match.charEndInParagraph,
          patternId: match.patternId,
          pattern: match.pattern,
          matchedText: match.matchedText,
        })
      }

      // Move position past this paragraph (+1 for the paragraph node itself, +1 for newline)
      absolutePos += paragraphText.length + 2
      paragraphIndex++
    }
  }

  return decorations
}

/**
 * Store detected patterns in the database
 */
export async function storeAppliedPatterns(
  postId: string,
  matches: DetectedPatternMatch[],
  supabase: { from: (table: string) => { insert: (data: unknown) => Promise<{ error: unknown }> } }
): Promise<void> {
  if (matches.length === 0) return

  const records = matches.map((m) => ({
    post_id: postId,
    pattern_id: m.patternId,
    paragraph_index: m.paragraphIndex,
    char_start: m.charStartInParagraph,
    char_end: m.charEndInParagraph,
    actually_written: m.matchedText,
    would_have_written: m.pattern.original_form || null,
  }))

  const { error } = await supabase.from('applied_patterns').insert(records)

  if (error) {
    console.error('[PatternDetection] Failed to store applied patterns:', error)
  } else {
    console.log(`[PatternDetection] Stored ${records.length} applied patterns`)
  }
}
