/**
 * Repair common JSON issues in LLM responses:
 * - Literal newlines inside string values
 * - Markdown code fences wrapping
 * - Trailing commas
 * - Single object instead of array
 */
export function repairAndParseJSON(raw: string): unknown[] {
  let text = raw.trim()

  // 1. Strip markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (fenceMatch) {
    text = fenceMatch[1].trim()
  }

  // 2. Find JSON array boundaries
  const arrayStart = text.indexOf('[')
  const arrayEnd = text.lastIndexOf(']')
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    text = text.slice(arrayStart, arrayEnd + 1)
  }

  // 3. Fix literal newlines/tabs inside JSON string values
  //    Uses a character-by-character state machine to track whether
  //    we're inside a JSON string (between unescaped ASCII " chars)
  text = escapeNewlinesInStrings(text)

  // 4. Remove trailing commas before } or ]
  text = text.replace(/,\s*([}\]])/g, '$1')

  // 5. Parse
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object') return [parsed]
    return []
  } catch (firstError) {
    console.error('[JSONRepair] Parse failed after repair:', firstError instanceof Error ? firstError.message : firstError)
    console.error('[JSONRepair] Repaired text preview:', text.slice(0, 500))
    throw firstError
  }
}

/**
 * Walk through JSON text character by character.
 * When inside a string (between unescaped " chars):
 *   - \n → \\n, \r → \\r, \t → \\t
 *   - Unescaped " that don't close the string → \\"
 *
 * To detect whether a " closes the string or is embedded:
 * A closing " is followed (after optional whitespace) by , } ] or :
 * An embedded " is followed by a letter, digit, or other content.
 */
function escapeNewlinesInStrings(input: string): string {
  const out: string[] = []
  let inString = false
  let i = 0

  while (i < input.length) {
    const ch = input[i]

    if (ch === '\\' && inString) {
      // Escaped character — push both chars and skip
      out.push(ch)
      if (i + 1 < input.length) {
        out.push(input[i + 1])
        i += 2
      } else {
        i++
      }
      continue
    }

    if (ch === '"') {
      if (!inString) {
        // Opening a string
        inString = true
        out.push(ch)
      } else {
        // Could be closing the string or an embedded unescaped quote
        if (isClosingQuote(input, i)) {
          inString = false
          out.push(ch)
        } else {
          // Embedded quote — escape it
          out.push('\\"')
        }
      }
      i++
      continue
    }

    if (inString) {
      if (ch === '\n') { out.push('\\n'); i++; continue }
      if (ch === '\r') { out.push('\\r'); i++; continue }
      if (ch === '\t') { out.push('\\t'); i++; continue }
    }

    out.push(ch)
    i++
  }

  return out.join('')
}

/**
 * Check if the " at position i is a real closing quote.
 * A closing quote is followed (after optional whitespace) by
 * a JSON structural character: , } ] : or end of input.
 */
function isClosingQuote(input: string, i: number): boolean {
  let j = i + 1
  // Skip whitespace
  while (j < input.length && (input[j] === ' ' || input[j] === '\n' || input[j] === '\r' || input[j] === '\t')) {
    j++
  }
  if (j >= input.length) return true
  const next = input[j]
  return next === ',' || next === '}' || next === ']' || next === ':'
}
