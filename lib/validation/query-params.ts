/**
 * Input Validation Helpers
 *
 * Provides safe parsing of query string parameters and request bodies
 * with bounds checking and sensible defaults to prevent NaN propagation,
 * unbounded values, and invalid input.
 */

/**
 * Parse an integer query parameter with bounds checking
 *
 * @param value - Raw query string value (may be null/undefined)
 * @param defaultVal - Default value if parsing fails or value is null
 * @param min - Minimum allowed value (inclusive, optional)
 * @param max - Maximum allowed value (inclusive, optional)
 * @returns Validated integer within bounds
 *
 * @example
 * // Parse limit with default 10, min 1, max 100
 * const limit = parseIntParam(searchParams.get('limit'), 10, 1, 100)
 */
export function parseIntParam(
  value: string | null | undefined,
  defaultVal: number,
  min?: number,
  max?: number
): number {
  if (value === null || value === undefined || value === '') {
    return defaultVal
  }

  const parsed = parseInt(value, 10)

  // If parsing fails (NaN), return default
  if (isNaN(parsed)) {
    return defaultVal
  }

  // Apply bounds if provided
  let result = parsed
  if (min !== undefined && result < min) {
    result = min
  }
  if (max !== undefined && result > max) {
    result = max
  }

  return result
}

/**
 * Parse a float query parameter with bounds checking
 *
 * @param value - Raw query string value (may be null/undefined)
 * @param defaultVal - Default value if parsing fails or value is null
 * @param min - Minimum allowed value (inclusive, optional)
 * @param max - Maximum allowed value (inclusive, optional)
 * @returns Validated float within bounds
 *
 * @example
 * // Parse threshold with default 0.5, min 0, max 1
 * const threshold = parseFloatParam(searchParams.get('threshold'), 0.5, 0, 1)
 */
export function parseFloatParam(
  value: string | null | undefined,
  defaultVal: number,
  min?: number,
  max?: number
): number {
  if (value === null || value === undefined || value === '') {
    return defaultVal
  }

  const parsed = parseFloat(value)

  // If parsing fails (NaN), return default
  if (isNaN(parsed)) {
    return defaultVal
  }

  // Apply bounds if provided
  let result = parsed
  if (min !== undefined && result < min) {
    result = min
  }
  if (max !== undefined && result > max) {
    result = max
  }

  return result
}

// =============================================================================
// Array Validation
// =============================================================================

export interface ArrayValidationResult<T> {
  valid: boolean
  data: T[]
  error?: string
}

/**
 * Validate an array from request body
 *
 * @param data - The data to validate (should be an array)
 * @param maxLength - Maximum allowed array length (default: 100)
 * @param minLength - Minimum required array length (default: 1)
 * @returns Validation result with typed array or error
 *
 * @example
 * const result = validateArray(body.items, 50)
 * if (!result.valid) {
 *   return NextResponse.json({ error: result.error }, { status: 400 })
 * }
 * const items = result.data // typed array
 */
export function validateArray<T>(
  data: unknown,
  maxLength: number = 100,
  minLength: number = 1
): ArrayValidationResult<T> {
  if (!Array.isArray(data)) {
    return { valid: false, data: [], error: 'Input must be an array' }
  }

  if (data.length < minLength) {
    return { valid: false, data: [], error: `Array must have at least ${minLength} item(s)` }
  }

  if (data.length > maxLength) {
    return { valid: false, data: [], error: `Array cannot exceed ${maxLength} items` }
  }

  return { valid: true, data: data as T[] }
}

/**
 * Validate an array of objects with required string fields
 *
 * @param data - The data to validate
 * @param requiredFields - Fields that must be present and be non-empty strings
 * @param maxLength - Maximum allowed array length
 * @returns Validation result with typed array or error
 *
 * @example
 * const result = validateObjectArray<{name: string, email: string}>(
 *   body.sources,
 *   ['name', 'email'],
 *   50
 * )
 */
export function validateObjectArray<T extends Record<string, unknown>>(
  data: unknown,
  requiredFields: (keyof T)[],
  maxLength: number = 100
): ArrayValidationResult<T> {
  const arrayResult = validateArray<Record<string, unknown>>(data, maxLength)
  if (!arrayResult.valid) {
    return arrayResult as ArrayValidationResult<T>
  }

  for (let i = 0; i < arrayResult.data.length; i++) {
    const item = arrayResult.data[i]

    for (const field of requiredFields) {
      const value = item[field as string]
      if (value === undefined || value === null) {
        return {
          valid: false,
          data: [],
          error: `Item ${i + 1}: missing required field '${String(field)}'`
        }
      }
      if (typeof value === 'string' && value.trim() === '') {
        return {
          valid: false,
          data: [],
          error: `Item ${i + 1}: field '${String(field)}' cannot be empty`
        }
      }
    }
  }

  return { valid: true, data: arrayResult.data as T[] }
}
