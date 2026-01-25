import { describe, it, expect } from 'vitest'
import { parseIntParam, parseFloatParam, validateArray, validateObjectArray } from '@/lib/validation/query-params'

describe('parseIntParam', () => {
  it('returns default for null input', () => {
    expect(parseIntParam(null, 10)).toBe(10)
  })

  it('returns default for undefined input', () => {
    expect(parseIntParam(undefined, 10)).toBe(10)
  })

  it('returns default for empty string', () => {
    expect(parseIntParam('', 10)).toBe(10)
  })

  it('returns default for non-numeric string', () => {
    expect(parseIntParam('abc', 10)).toBe(10)
  })

  it('parses valid integer string', () => {
    expect(parseIntParam('42', 10)).toBe(42)
  })

  it('parses negative integers', () => {
    expect(parseIntParam('-5', 10)).toBe(-5)
  })

  it('truncates floats to integers', () => {
    expect(parseIntParam('3.7', 10)).toBe(3)
  })

  it('clamps to minimum value', () => {
    expect(parseIntParam('0', 10, 1)).toBe(1)
    expect(parseIntParam('-10', 10, 0)).toBe(0)
  })

  it('clamps to maximum value', () => {
    expect(parseIntParam('1000', 10, undefined, 100)).toBe(100)
  })

  it('clamps within range', () => {
    expect(parseIntParam('50', 10, 1, 100)).toBe(50)
    expect(parseIntParam('0', 10, 1, 100)).toBe(1)
    expect(parseIntParam('500', 10, 1, 100)).toBe(100)
  })
})

describe('parseFloatParam', () => {
  it('returns default for null input', () => {
    expect(parseFloatParam(null, 0.5)).toBe(0.5)
  })

  it('returns default for undefined input', () => {
    expect(parseFloatParam(undefined, 0.5)).toBe(0.5)
  })

  it('returns default for empty string', () => {
    expect(parseFloatParam('', 0.5)).toBe(0.5)
  })

  it('returns default for non-numeric string', () => {
    expect(parseFloatParam('abc', 0.5)).toBe(0.5)
  })

  it('parses valid float string', () => {
    expect(parseFloatParam('0.75', 0.5)).toBe(0.75)
  })

  it('parses integers as floats', () => {
    expect(parseFloatParam('3', 0.5)).toBe(3)
  })

  it('parses negative floats', () => {
    expect(parseFloatParam('-0.25', 0.5)).toBe(-0.25)
  })

  it('clamps to minimum value', () => {
    expect(parseFloatParam('-0.5', 0.5, 0)).toBe(0)
  })

  it('clamps to maximum value', () => {
    expect(parseFloatParam('1.5', 0.5, undefined, 1)).toBe(1)
  })

  it('clamps within range', () => {
    expect(parseFloatParam('0.7', 0.5, 0, 1)).toBe(0.7)
    expect(parseFloatParam('-1', 0.5, 0, 1)).toBe(0)
    expect(parseFloatParam('2', 0.5, 0, 1)).toBe(1)
  })
})

describe('validateArray', () => {
  it('rejects non-arrays', () => {
    expect(validateArray('not an array').valid).toBe(false)
    expect(validateArray({}).valid).toBe(false)
    expect(validateArray(null).valid).toBe(false)
    expect(validateArray(undefined).valid).toBe(false)
  })

  it('rejects empty arrays by default', () => {
    const result = validateArray([])
    expect(result.valid).toBe(false)
    expect(result.error).toContain('at least 1')
  })

  it('allows empty arrays when minLength is 0', () => {
    const result = validateArray([], 100, 0)
    expect(result.valid).toBe(true)
  })

  it('rejects arrays exceeding maxLength', () => {
    const result = validateArray([1, 2, 3, 4, 5], 3)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('cannot exceed 3')
  })

  it('accepts valid arrays', () => {
    const result = validateArray([1, 2, 3], 10)
    expect(result.valid).toBe(true)
    expect(result.data).toEqual([1, 2, 3])
  })
})

describe('validateObjectArray', () => {
  it('validates required string fields', () => {
    const result = validateObjectArray<{name: string, email: string}>(
      [{ name: 'Test', email: 'test@example.com' }],
      ['name', 'email']
    )
    expect(result.valid).toBe(true)
  })

  it('rejects missing required fields', () => {
    const result = validateObjectArray<{name: string, email: string}>(
      [{ name: 'Test' }],
      ['name', 'email']
    )
    expect(result.valid).toBe(false)
    expect(result.error).toContain("missing required field 'email'")
  })

  it('rejects empty string fields', () => {
    const result = validateObjectArray<{name: string}>(
      [{ name: '   ' }],
      ['name']
    )
    expect(result.valid).toBe(false)
    expect(result.error).toContain('cannot be empty')
  })

  it('reports correct item index in error', () => {
    const result = validateObjectArray<{name: string}>(
      [{ name: 'Valid' }, { name: '' }],
      ['name']
    )
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Item 2')
  })
})
