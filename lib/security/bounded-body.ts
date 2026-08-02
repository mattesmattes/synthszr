/**
 * Bounded readers for untrusted network payloads.
 *
 * `readJsonBody` bounds a *request* body. `readResponseBuffer` bounds a
 * *response* body (e.g. when proxying external URLs such as newsletter
 * images) the same way: check `content-length` first, then stream chunk by
 * chunk and cancel the moment the running total crosses `maxBytes` — never
 * an unbounded `arrayBuffer()`.
 */

export type BoundedBodyErrorCode = 'BODY_TOO_LARGE' | 'INVALID_JSON'

export class BoundedBodyError extends Error {
  readonly code: BoundedBodyErrorCode

  constructor(code: BoundedBodyErrorCode, message: string) {
    super(message)
    this.name = 'BoundedBodyError'
    this.code = code
  }
}

/**
 * Reads a Request body as JSON while enforcing a hard byte limit.
 *
 * The body is streamed in chunks and the running total is checked against
 * `maxBytes` on every chunk — an oversized body throws `BODY_TOO_LARGE`
 * before any UTF-8 decoding or JSON parsing happens. Only a body that passes
 * the size check is decoded and parsed; malformed JSON (or invalid UTF-8)
 * within the limit throws `INVALID_JSON`.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const declaredLength = Number(contentLength)
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new BoundedBodyError(
        'BODY_TOO_LARGE',
        `Request body declares ${declaredLength} bytes, exceeding limit of ${maxBytes}`
      )
    }
  }

  const body = request.body
  if (!body) {
    throw new BoundedBodyError('INVALID_JSON', 'Request has no body')
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new BoundedBodyError('BODY_TOO_LARGE', `Request body exceeds limit of ${maxBytes} bytes`)
    }
    chunks.push(value)
  }

  const buffer = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return JSON.parse(text)
  } catch {
    throw new BoundedBodyError('INVALID_JSON', 'Request body is not valid JSON')
  }
}

/**
 * Reads a fetch Response body into a Buffer while enforcing a hard byte
 * limit — the response-side counterpart to readJsonBody.
 *
 * The declared `content-length` is checked first (cheap rejection without
 * reading anything). The body is then streamed in chunks with a running
 * total checked against `maxBytes` on every chunk, so a server that lies
 * about (or omits) content-length is still bounded: the moment the total
 * crosses the limit, the reader is cancelled and BODY_TOO_LARGE is thrown.
 * There is never an unbounded `response.arrayBuffer()` fallback.
 */
export async function readResponseBuffer(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const declaredLength = Number(contentLength)
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new BoundedBodyError(
        'BODY_TOO_LARGE',
        `Response declares ${declaredLength} bytes, exceeding limit of ${maxBytes}`
      )
    }
  }

  const body = response.body
  if (!body) {
    return Buffer.alloc(0)
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new BoundedBodyError('BODY_TOO_LARGE', `Response body exceeds limit of ${maxBytes} bytes`)
    }
    chunks.push(value)
  }

  const buffer = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }

  return Buffer.from(buffer)
}
