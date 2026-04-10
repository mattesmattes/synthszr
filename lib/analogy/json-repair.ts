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

  // 3. Fix literal newlines inside JSON string values
  // Replace actual newlines between quotes with escaped \n
  text = text.replace(/"([^"]*(?:\\.[^"]*)*)"/g, (_match, content) => {
    const fixed = content
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
    return `"${fixed}"`
  })

  // 4. Remove trailing commas before } or ]
  text = text.replace(/,\s*([}\]])/g, '$1')

  // 5. Parse
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object') return [parsed]
    return []
  } catch (firstError) {
    // 6. Last resort: try to parse line by line for concatenated JSON objects
    console.error('[JSONRepair] Standard parse failed, trying aggressive repair')
    console.error('[JSONRepair] Error:', firstError instanceof Error ? firstError.message : firstError)
    console.error('[JSONRepair] Text preview:', text.slice(0, 300))

    // Try fixing unescaped quotes inside strings (common LLM issue)
    // Pattern: look for "key": "value with "quotes" inside"
    const aggressive = text.replace(
      /:\s*"((?:[^"\\]|\\.)*)"/g,
      (_m, val) => `: "${val.replace(/(?<!\\)"/g, '\\"')}"`
    )

    try {
      const parsed = JSON.parse(aggressive)
      if (Array.isArray(parsed)) return parsed
      if (parsed && typeof parsed === 'object') return [parsed]
    } catch {
      // Give up
    }

    throw firstError
  }
}
