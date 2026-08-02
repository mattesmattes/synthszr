/**
 * Bounded, SSRF-safe image fetching for the newsletter image proxy routes
 * (cover-image, thumbnail-image).
 *
 * These routes fetch a `url` query param supplied by whatever generated the
 * email (admin newsletter-send, the daily cron, or the reader page) and
 * pipe the bytes through sharp. Without hard bounds here, a malicious or
 * malformed `url` could point the server at unlimited hosts, unlimited
 * download sizes, or images crafted to blow up sharp's decoder — SEC-007.
 *
 * Fixed limits: 8 MiB download, 10s timeout, 3 redirects, and an exact
 * (no-wildcard) hostname allowlist checked on every hop via safeFetch's
 * `allowedHostname`. The 16-megapixel decode limit is NOT enforced here —
 * that's a property of the sharp pipeline in each route
 * (`limitInputPixels: 16_000_000`), not of the raw bytes.
 */

import { safeFetch, SsrfBlockedError } from '@/lib/security/ssrf'
import { readResponseBuffer, BoundedBodyError } from '@/lib/security/bounded-body'

const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024 // 8 MiB
const FETCH_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 3

// The only host that real post_images.image_url rows point to in production
// (verified against the prod DB for Task 8 — 3159/3178 rows, remainder
// empty-string placeholders). Exact hostname, no wildcard.
const VERCEL_BLOB_IMAGE_HOST = 'lbrzdn804nhy3kox.public.blob.vercel-storage.com'

function deriveSupabaseImageHost(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) return null
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return null
  }
}

// Kept as a second allowed host defensively (pre-migration images / other
// environments may still reference Supabase Storage) even though no current
// production row uses it — see Task 8 report.
export const NEWSLETTER_IMAGE_HOSTS: readonly string[] = [
  VERCEL_BLOB_IMAGE_HOST,
  ...(() => {
    const supabaseHost = deriveSupabaseImageHost()
    return supabaseHost ? [supabaseHost] : []
  })(),
]

export class ImageFetchError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ImageFetchError'
    this.status = status
  }
}

type ImageFormat = 'png' | 'jpeg' | 'webp'

const MIME_TO_FORMAT: Record<string, ImageFormat> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/webp': 'webp',
}

/** Detects PNG/JPEG/WebP purely from magic bytes — never trusts the declared Content-Type alone. */
function detectFormatFromMagicBytes(buffer: Buffer): ImageFormat | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg'
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp'
  }
  return null
}

/**
 * Fetches an image URL used by the newsletter proxy routes under hard
 * security bounds and returns the validated bytes.
 *
 * Throws ImageFetchError with the HTTP status the caller should return:
 * - 403: host not in the allowlist (initial URL or any redirect hop), or
 *   blocked by the underlying SSRF guard (private IP, bad protocol, etc.)
 * - 415: missing/mismatched Content-Type vs. magic-byte signature, or a
 *   format other than PNG/JPEG/WebP (GIF, TIFF, SVG, ...)
 * - 413: download exceeds the 8 MiB cap (declared or streamed)
 * - 502: the origin responded, but not with a success status
 * - 504: the fetch itself failed (timeout, DNS, connection reset, abort)
 */
export async function fetchNewsletterImage(rawUrl: string): Promise<Buffer> {
  let response: Response
  try {
    response = await safeFetch(rawUrl, {
      allowedHostname: NEWSLETTER_IMAGE_HOSTS,
      maxRedirects: MAX_REDIRECTS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      throw new ImageFetchError(403, err.message)
    }
    throw new ImageFetchError(504, err instanceof Error ? err.message : 'Image fetch failed')
  }

  if (!response.ok) {
    throw new ImageFetchError(502, `Failed to fetch image (status ${response.status})`)
  }

  let buffer: Buffer
  try {
    buffer = await readResponseBuffer(response, MAX_DOWNLOAD_BYTES)
  } catch (err) {
    if (err instanceof BoundedBodyError && err.code === 'BODY_TOO_LARGE') {
      throw new ImageFetchError(413, 'Image exceeds 8 MiB download limit')
    }
    throw err
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? null
  const declaredFormat = contentType ? MIME_TO_FORMAT[contentType] ?? null : null
  const detectedFormat = detectFormatFromMagicBytes(buffer)

  if (!declaredFormat || !detectedFormat || declaredFormat !== detectedFormat) {
    throw new ImageFetchError(415, 'Unsupported or mismatched image type (allowed: PNG, JPEG, WebP)')
  }

  return buffer
}
