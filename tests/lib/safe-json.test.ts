import { describe, it, expect } from 'vitest'
import { safeParseJSON, safeParseJSONWithError, parseTipTapContent } from '@/lib/utils/safe-json'

describe('safeParseJSON', () => {
  it('parses valid JSON string', () => {
    const result = safeParseJSON('{"name": "test"}')
    expect(result).toEqual({ name: 'test' })
  })

  it('returns fallback for invalid JSON', () => {
    const result = safeParseJSON('not valid json', { fallback: true })
    expect(result).toEqual({ fallback: true })
  })

  it('returns null fallback by default for invalid JSON', () => {
    const result = safeParseJSON('{ invalid }')
    expect(result).toBeNull()
  })

  it('returns value as-is if not a string', () => {
    const obj = { already: 'parsed' }
    const result = safeParseJSON(obj)
    expect(result).toBe(obj)
  })

  it('handles empty string', () => {
    const result = safeParseJSON('')
    expect(result).toBeNull()
  })

  it('handles truncated JSON', () => {
    const result = safeParseJSON('{"name": "value", "incomplete": ')
    expect(result).toBeNull()
  })
})

describe('safeParseJSONWithError', () => {
  it('returns data for valid JSON', () => {
    const result = safeParseJSONWithError('{"key": 123}')
    expect(result.data).toEqual({ key: 123 })
    expect(result.error).toBeNull()
  })

  it('returns error message for invalid JSON', () => {
    const result = safeParseJSONWithError('not json')
    expect(result.data).toBeNull()
    expect(result.error).toBeDefined()
    expect(typeof result.error).toBe('string')
  })

  it('returns object as-is if not string', () => {
    const obj = { test: true }
    const result = safeParseJSONWithError(obj)
    expect(result.data).toBe(obj)
    expect(result.error).toBeNull()
  })
})

describe('parseTipTapContent', () => {
  it('parses valid TipTap JSON', () => {
    const content = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }]
    })
    const result = parseTipTapContent(content)
    expect(result.type).toBe('doc')
    expect(result.content).toHaveLength(1)
  })

  it('returns empty doc structure for invalid JSON', () => {
    const result = parseTipTapContent('{ invalid tiptap content }')
    expect(result).toEqual({ type: 'doc', content: [] })
  })

  it('returns empty doc for malformed JSON with missing brackets', () => {
    const result = parseTipTapContent('"type": "doc"')
    expect(result).toEqual({ type: 'doc', content: [] })
  })

  it('returns object as-is if already parsed', () => {
    const obj = { type: 'doc', content: [{ type: 'heading' }] }
    const result = parseTipTapContent(obj)
    expect(result).toBe(obj)
  })

  it('handles database corruption gracefully', () => {
    // Simulate corrupted database content
    const corrupted = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"'
    const result = parseTipTapContent(corrupted)
    expect(result).toEqual({ type: 'doc', content: [] })
  })

  it('handles null-like string values', () => {
    const result = parseTipTapContent('null')
    // JSON.parse('null') returns null, which is falsy
    expect(result).toEqual({ type: 'doc', content: [] })
  })
})
