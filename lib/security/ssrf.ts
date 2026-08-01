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
 * Fully expand an IPv6 literal into its 8 hextets (as numbers 0-65535).
 * Handles "::" zero-run compression and a trailing embedded IPv4 dotted-quad
 * (e.g. "::ffff:127.0.0.1"). Returns null if the input isn't well-formed.
 *
 * This is what lets isPrivateIPv6 recognize IPv4-mapped addresses in BOTH
 * the decimal form (::ffff:127.0.0.1) and the hex form (::ffff:7f00:1,
 * ::ffff:a9fe:a9fe, etc.) - a plain regex only catches the decimal form.
 */
function expandIPv6(ip: string): number[] | null {
  const withoutZone = ip.split('%')[0] // strip a scope id like "fe80::1%eth0"

  // A trailing "a.b.c.d" segment (e.g. "::ffff:127.0.0.1") - convert it to
  // two hextets up front, then expand the remaining hex portion normally.
  let head = withoutZone
  let ipv4Tail: number[] | null = null
  const lastColon = withoutZone.lastIndexOf(':')
  if (lastColon !== -1) {
    const tail = withoutZone.slice(lastColon + 1)
    if (tail.includes('.')) {
      const octets = tail.split('.').map(Number)
      if (octets.length !== 4 || octets.some(o => Number.isNaN(o) || o < 0 || o > 255)) {
        return null
      }
      ipv4Tail = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]]
      head = withoutZone.slice(0, lastColon)
    }
  }

  const compressedParts = head.split('::')
  if (compressedParts.length > 2) return null // more than one "::" - malformed

  let groups: string[]
  if (compressedParts.length === 2) {
    const left = compressedParts[0] === '' ? [] : compressedParts[0].split(':')
    const right = compressedParts[1] === '' ? [] : compressedParts[1].split(':')
    const knownCount = left.length + right.length + (ipv4Tail ? 2 : 0)
    const missing = 8 - knownCount
    if (missing < 1) return null // "::" must stand in for at least one group
    groups = [...left, ...Array(missing).fill('0'), ...right]
  } else {
    groups = head === '' ? [] : head.split(':')
  }

  const hextets = groups.map(g => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN))
  const full = ipv4Tail ? [...hextets, ...ipv4Tail] : hextets
  if (full.length !== 8 || full.some(n => Number.isNaN(n))) return null

  return full
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

  // IPv4-mapped IPv6 (::ffff:0:0/96) - covers the decimal form
  // (::ffff:127.0.0.1) and the hex form (::ffff:7f00:1, ::ffff:a9fe:a9fe,
  // ...) alike: expand to 8 hextets, check hextets 1-5 are 0 and hextet 6 is
  // ffff, then treat hextets 7+8 as the embedded IPv4 address.
  const hextets = expandIPv6(normalized)
  if (
    hextets &&
    hextets[0] === 0 && hextets[1] === 0 && hextets[2] === 0 &&
    hextets[3] === 0 && hextets[4] === 0 && hextets[5] === 0xffff
  ) {
    const embeddedIPv4 = [
      (hextets[6] >> 8) & 0xff, hextets[6] & 0xff,
      (hextets[7] >> 8) & 0xff, hextets[7] & 0xff,
    ].join('.')
    return isPrivateIPv4(embeddedIPv4)
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
 * the URL is unsafe. Returns the parsed URL plus the IP address(es) it
 * resolved to at validation time (a direct IP-literal hostname resolves to
 * itself) - see the DNS-rebinding note on safeFetch for why callers get the
 * IPs back.
 */
export async function assertPublicUrl(rawUrl: string): Promise<{ url: URL; ips: string[] }> {
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
    return { url, ips: [hostname] }
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

  return { url, ips: resolved.map(r => r.address) }
}

/**
 * SSRF-safe fetch wrapper. Validates the URL (and every redirect hop) via
 * assertPublicUrl immediately before it is fetched, following up to
 * MAX_REDIRECTS redirects manually.
 *
 * DNS-rebinding (TOCTOU) note: assertPublicUrl resolves `hostname` and
 * checks the resulting IP(s), but the subsequent `fetch()` call below
 * performs its OWN, independent DNS resolution for the same hostname when it
 * actually opens the connection - so there is an inherent gap between "the
 * name we checked" and "the name fetch() connects to". Fully closing that
 * gap means pinning the outgoing connection to the IP(s) validated here
 * (e.g. a low-level dispatcher/socket `lookup` override that keeps the
 * original hostname for the Host header and TLS SNI but forces the actual
 * connection to the pinned IP). That's not done here because it isn't
 * cleanly achievable on top of the global `fetch()` API in this runtime:
 * it would require either adding `undici` as a direct dependency to build a
 * custom Agent/dispatcher (today it's only a transitive dependency of
 * Next.js, so importing its internals directly is fragile across upgrades),
 * or rewriting this function on raw `http(s).request`, which would lose
 * fetch()'s automatic gzip/br decompression, streaming Response shape, and
 * built-in redirect/abort handling that all current callers (image/audio
 * proxying in the podcast + ad-promo routes, article scraping) depend on.
 *
 * Given that, this is the pragmatic minimal hardening: re-resolve and
 * re-validate the hostname immediately before every single connection
 * attempt - the initial request AND every redirect hop - with no other
 * async work in between, minimizing the window an attacker's DNS answer
 * could flip in. This defeats the common rebinding pattern (serve a public
 * IP, then flip the record to a private one after a delay/TTL expiry), but
 * NOT a maximally adversarial authoritative DNS server that deliberately
 * answers differently on every individual query regardless of timing -
 * that could in theory still slip a private IP past this check into the
 * actual fetch. Residual risk is bounded by the fact all current callers
 * only reach admin/DB-authored URLs or links embedded in crawled
 * newsletters, not fully free-form third-party input.
 */
export async function safeFetch(rawUrl: string, init?: RequestInit): Promise<Response> {
  let currentUrl = (await assertPublicUrl(rawUrl)).url.toString()

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
    currentUrl = (await assertPublicUrl(nextUrl.toString())).url.toString()
  }

  throw new Error('SSRF blocked: too many redirects')
}
