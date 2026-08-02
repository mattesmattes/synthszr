import { describe, it, expect } from 'vitest'
import { readJsonBody, BoundedBodyError } from '@/lib/security/bounded-body'

const MAX_BYTES = 8 * 1024

function requestWithBody(body: string): Request {
  return new Request('http://localhost/test', {
    method: 'POST',
    body,
  })
}

describe('readJsonBody', () => {
  it('parses a small valid JSON body', async () => {
    const req = requestWithBody(JSON.stringify({ a: 1, b: 'hello' }))
    const result = await readJsonBody(req, MAX_BYTES)
    expect(result).toEqual({ a: 1, b: 'hello' })
  })

  it('throws BoundedBodyError with code BODY_TOO_LARGE when body exceeds maxBytes', async () => {
    const req = requestWithBody('x'.repeat(9 * 1024))
    await expect(readJsonBody(req, MAX_BYTES)).rejects.toMatchObject({ code: 'BODY_TOO_LARGE' })
  })

  it('throws before decoding — oversized non-JSON body is still BODY_TOO_LARGE, not INVALID_JSON', async () => {
    const req = requestWithBody('x'.repeat(9 * 1024))
    try {
      await readJsonBody(req, MAX_BYTES)
      expect.fail('expected readJsonBody to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(BoundedBodyError)
      expect((err as BoundedBodyError).code).toBe('BODY_TOO_LARGE')
    }
  })

  it('throws BoundedBodyError with code INVALID_JSON for malformed JSON within the size limit', async () => {
    const req = requestWithBody('not-json')
    await expect(readJsonBody(req, MAX_BYTES)).rejects.toMatchObject({ code: 'INVALID_JSON' })
  })

  it('accepts a body exactly at the byte limit', async () => {
    const payload = JSON.stringify({ a: 'x'.repeat(10) })
    const req = requestWithBody(payload)
    const result = await readJsonBody(req, Buffer.byteLength(payload))
    expect(result).toEqual({ a: 'x'.repeat(10) })
  })

  it('rejects a body one byte over the limit', async () => {
    const payload = JSON.stringify({ a: 'x'.repeat(10) })
    const req = requestWithBody(payload)
    await expect(readJsonBody(req, Buffer.byteLength(payload) - 1)).rejects.toMatchObject({ code: 'BODY_TOO_LARGE' })
  })
})
