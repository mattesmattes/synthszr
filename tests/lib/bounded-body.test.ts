import { describe, it, expect } from 'vitest'
import { readJsonBody, readResponseBuffer, BoundedBodyError } from '@/lib/security/bounded-body'

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

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

describe('readResponseBuffer', () => {
  it('reads a small response body fully into a Buffer', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const res = new Response(bytes)
    const result = await readResponseBuffer(res, MAX_IMAGE_BYTES)
    expect(Buffer.isBuffer(result)).toBe(true)
    expect([...result]).toEqual([1, 2, 3, 4, 5])
  })

  it('throws BODY_TOO_LARGE when declared content-length exceeds maxBytes, without reading the body', async () => {
    // Body itself is tiny — only the (lied-about) declared content-length is oversized.
    const res = new Response(new Uint8Array(10), {
      headers: { 'content-length': String(MAX_IMAGE_BYTES + 1) },
    })
    await expect(readResponseBuffer(res, MAX_IMAGE_BYTES)).rejects.toMatchObject({ code: 'BODY_TOO_LARGE' })
  })

  it('throws BODY_TOO_LARGE for a streamed body exceeding maxBytes with no content-length header', async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(7) // 1 MiB per chunk
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 9; i++) controller.enqueue(chunk) // 9 MiB total, > 8 MiB limit
        controller.close()
      },
    })
    const res = new Response(stream)
    expect(res.headers.get('content-length')).toBeNull()
    await expect(readResponseBuffer(res, MAX_IMAGE_BYTES)).rejects.toMatchObject({ code: 'BODY_TOO_LARGE' })
  })

  it('accepts a streamed body exactly at the byte limit', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_IMAGE_BYTES))
        controller.close()
      },
    })
    const res = new Response(stream)
    const result = await readResponseBuffer(res, MAX_IMAGE_BYTES)
    expect(result.length).toBe(MAX_IMAGE_BYTES)
  })

  it('returns an empty Buffer when the response has no body', async () => {
    const res = new Response(null, { status: 204 })
    const result = await readResponseBuffer(res, MAX_IMAGE_BYTES)
    expect(result.length).toBe(0)
  })
})
