/**
 * SSRF (Server-Side Request Forgery) Guard
 *
 * The article crawler fetches arbitrary URLs supplied by admins or extracted
 * from crawled newsletters. Without validation, an attacker (or a poisoned
 * newsletter link) could point the server at internal-only targets:
 * cloud metadata endpoints (169.254.169.254), loopback, private ranges, etc.
 *
 * This is a BLOCKLIST, not an allowlist — the crawler must be able to reach
 * any public URL. We only reject requests that resolve to non-public
 * (private/reserved/loopback/link-local) addresses.
 */

import { lookup } from 'dns/promises'
import net from 'net'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const MAX_REDIRECTS = 5

/**
 * Check if an IPv4 address (dotted-quad string) falls into a private/reserved range.
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) {
    // Not a well-formed IPv4 literal - treat as unsafe so callers fail closed.
    return true
  }
  const [a, b] = parts

  // 0.0.0.0/8 - "this network" / unspecified
  if (a === 0) return true
  // 10.0.0.0/8 - private
  if (a === 10) return true
  // 127.0.0.0/8 - loopback
  if (a === 127) return true
  // 169.254.0.0/16 - link-local (includes cloud metadata 169.254.169.254)
  if (a === 169 && b === 254) return true
  // 172.16.0.0/12 - private
  if (a === 172 && b >= 16 && b <= 31) return true
  // 192.168.0.0/16 - private
  if (a === 192 && b === 168) return true
  // 192.0.0.0/24 - IETF protocol assignments (includes some cloud metadata schemes)
  if (a === 192 && b === 0 && parts[2] === 0) return true
  // 198.18.0.0/15 - benchmark testing
  if (a === 198 && (b === 18 || b === 19)) return true
  // 224.0.0.0/4 - multicast
  if (a >= 224 && a <= 239) return true
  // 240.0.0.0/4 - reserved
  if (a >= 240) return true

  return false
}

/**
 * Check if an IPv6 address falls into a private/reserved/loopback range.
 */
export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase()

  // ::1 - loopback
  if (normalized === '::1') return true
  // :: - unspecified
  if (normalized === '::') return true

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) - check the embedded IPv4 address
  const mappedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mappedMatch) {
    return isPrivateIPv4(mappedMatch[1])
  }

  // fe80::/10 - link-local
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true
  }
  // fc00::/7 - unique local (fc00:: - fdff::)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true

  return false
}

/**
 * Check if a resolved IP address (v4 or v6) is a private/reserved/loopback target.
 */
export function isPrivateIP(ip: string): boolean {
  const version = net.isIP(ip)
  if (version === 4) return isPrivateIPv4(ip)
  if (version === 6) return isPrivateIPv6(ip)
  // Not a valid IP literal at all - fail closed.
  return true
}

/**
 * Validate that a URL is http(s) and resolves only to public, non-reserved
 * addresses. Throws an Error (without leaking the offending internal IP) if
 * the URL is unsafe. Returns the parsed URL on success.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('SSRF blocked: invalid URL')
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error(`SSRF blocked: protocol not allowed (${url.protocol})`)
  }

  // WHATWG URL keeps brackets around IPv6 hostnames (e.g. "[::1]") - strip
  // them so net.isIP()/isPrivateIP() see the bare address.
  const hostname = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname

  // Direct IP literal in the hostname (e.g. http://169.254.169.254/)
  const literalVersion = net.isIP(hostname)
  if (literalVersion !== 0) {
    if (isPrivateIP(hostname)) {
      throw new Error('SSRF blocked: target resolves to a reserved address')
    }
    return url
  }

  // localhost and friends never hit DNS resolution the same way in all
  // environments - block by name explicitly as a belt-and-suspenders check.
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('SSRF blocked: target resolves to a reserved address')
  }

  let resolved: Array<{ address: string; family: number }>
  try {
    resolved = await lookup(hostname, { all: true })
  } catch {
    throw new Error('SSRF blocked: could not resolve host')
  }

  if (resolved.length === 0) {
    throw new Error('SSRF blocked: could not resolve host')
  }

  for (const { address } of resolved) {
    if (isPrivateIP(address)) {
      throw new Error('SSRF blocked: target resolves to a reserved address')
    }
  }

  return url
}

/**
 * SSRF-safe fetch wrapper. Validates the URL (and every redirect hop) via
 * assertPublicUrl before it is fetched, following up to MAX_REDIRECTS
 * redirects manually.
 */
export async function safeFetch(rawUrl: string, init?: RequestInit): Promise<Response> {
  let currentUrl = (await assertPublicUrl(rawUrl)).toString()

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const response = await fetch(currentUrl, {
      ...init,
      redirect: 'manual',
    })

    // Manual redirect handling: fetch reports a redirect either via
    // response.type === 'opaqueredirect' (no-cors-like) or a 3xx status with
    // a Location header (the typical same-origin/cors case).
    const isRedirectStatus = response.status >= 300 && response.status < 400
    const location = response.headers.get('location')

    if (!isRedirectStatus || !location) {
      return response
    }

    if (redirectCount === MAX_REDIRECTS) {
      throw new Error('SSRF blocked: too many redirects')
    }

    const nextUrl = new URL(location, currentUrl)
    currentUrl = (await assertPublicUrl(nextUrl.toString())).toString()
  }

  throw new Error('SSRF blocked: too many redirects')
}
