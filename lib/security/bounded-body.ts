/**
 * Bounded readers for untrusted network payloads.
 *
 * `readJsonBody` bounds a *request* body. A `readResponseBuffer` counterpart
 * for bounding *response* reads (e.g. when proxying external URLs) belongs in
 * this module too — added by a later security task, not implemented here.
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
