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
 *
 * Callers with a small, fixed set of trusted hosts (e.g. the newsletter
 * image proxy, SEC-007) can additionally opt into an exact-hostname
 * allowlist via the `allowedHostname` option — checked on every hop
 * alongside, not instead of, the blocklist above.
 */

import { lookup } from 'dns/promises'
import net from 'net'
import { Agent, fetch as undiciFetch } from 'undici'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const MAX_REDIRECTS = 5
const DEFAULT_TIMEOUT_MS = 10_000

/** Never replayed to a different origin after a redirect. */
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization']

/**
 * Thrown by assertPublicUrl/safeFetch for every blocking reason (bad
 * protocol, private/reserved IP, hostname not in an allowlist, too many
 * redirects). A dedicated subclass lets callers distinguish "blocked by this
 * guard" from unrelated network errors (DNS failure inside fetch(), abort/
 * timeout) without parsing message strings.
 */
export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsrfBlockedError'
  }
}

export interface AssertPublicUrlOptions {
  /**
   * If set, the hostname must exactly match one of these values
   * (case-insensitive, no subdomain/wildcard matching). Applied in addition
   * to the private-IP blocklist below, not instead of it.
   */
  allowedHostname?: string | readonly string[]
}

function isHostnameAllowed(hostname: string, allowed: string | readonly string[]): boolean {
  const list = Array.isArray(allowed) ? allowed : [allowed]
  const lowerHostname = hostname.toLowerCase()
  return list.some(h => h.toLowerCase() === lowerHostname)
}

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
export async function assertPublicUrl(
  rawUrl: string,
  options?: AssertPublicUrlOptions
): Promise<{ url: URL; ips: string[] }> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new SsrfBlockedError('SSRF blocked: invalid URL')
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfBlockedError(`SSRF blocked: protocol not allowed (${url.protocol})`)
  }

  // WHATWG URL keeps brackets around IPv6 hostnames (e.g. "[::1]") - strip
  // them so net.isIP()/isPrivateIP() see the bare address.
  const hostname = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname

  if (options?.allowedHostname && !isHostnameAllowed(hostname, options.allowedHostname)) {
    throw new SsrfBlockedError('SSRF blocked: host not in allowlist')
  }

  // Direct IP literal in the hostname (e.g. http://169.254.169.254/)
  const literalVersion = net.isIP(hostname)
  if (literalVersion !== 0) {
    if (isPrivateIP(hostname)) {
      throw new SsrfBlockedError('SSRF blocked: target resolves to a reserved address')
    }
    return { url, ips: [hostname] }
  }

  // localhost and friends never hit DNS resolution the same way in all
  // environments - block by name explicitly as a belt-and-suspenders check.
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new SsrfBlockedError('SSRF blocked: target resolves to a reserved address')
  }

  let resolved: Array<{ address: string; family: number }>
  try {
    resolved = await lookup(hostname, { all: true })
  } catch {
    throw new SsrfBlockedError('SSRF blocked: could not resolve host')
  }

  if (resolved.length === 0) {
    throw new SsrfBlockedError('SSRF blocked: could not resolve host')
  }

  for (const { address } of resolved) {
    if (isPrivateIP(address)) {
      throw new SsrfBlockedError('SSRF blocked: target resolves to a reserved address')
    }
  }

  return { url, ips: resolved.map(r => r.address) }
}

/**
 * Pick the address the connection will be pinned to. IPv4 wins when both
 * families are available: pinning removes the runtime's happy-eyeballs
 * fallback, and every current deployment target (Vercel Lambda) reaches the
 * internet over IPv4 - preferring AAAA here would turn a working dual-stack
 * host into a connection error.
 */
function selectPinnedAddress(ips: string[]): { address: string; family: number } {
  const address = ips.find(ip => net.isIP(ip) === 4) ?? ips[0]
  return { address, family: net.isIP(address) }
}

/**
 * A single-use dispatcher whose socket-level `lookup` always answers with the
 * address assertPublicUrl already validated - no matter what the hostname
 * resolves to by the time the socket is opened. The request URL keeps the
 * original hostname, so the Host header and TLS SNI stay correct.
 */
export function createPinnedAgent(pinned: { address: string; family: number }): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        if (options && (options as { all?: boolean }).all) {
          ;(callback as unknown as (err: null, addresses: Array<{ address: string; family: number }>) => void)(
            null,
            [pinned]
          )
          return
        }
        callback(null, pinned.address, pinned.family)
      },
    },
  })
}

function stripCredentialHeaders(headers: HeadersInit | undefined): Headers {
  const next = new Headers(headers ?? {})
  for (const name of CREDENTIAL_HEADERS) next.delete(name)
  return next
}

/**
 * SSRF-safe fetch wrapper. Validates the URL (and every redirect hop) via
 * assertPublicUrl immediately before it is fetched, then pins the actual
 * connection to the address that validation approved.
 *
 * DNS-rebinding (TOCTOU): resolving a hostname and then handing that same
 * hostname to `fetch()` leaves a gap - fetch performs its OWN, independent
 * resolution when it opens the socket, so an attacker-controlled resolver can
 * answer "public" for the check and "169.254.169.254" for the connection.
 * We close that gap with a per-hop undici Agent whose `connect.lookup`
 * returns the already-validated address, which is why undici is a direct
 * dependency rather than a transitive one: Agent and fetch must come from the
 * same copy for the dispatcher to be accepted.
 *
 * Every hop gets its own agent (validated separately, torn down afterwards),
 * credential headers are dropped when a redirect crosses origins, and each
 * hop runs under its own timeout budget.
 */
export interface SafeFetchInit extends RequestInit {
  /** Restricts every hop (initial URL + every redirect target) to this hostname allowlist — see AssertPublicUrlOptions. */
  allowedHostname?: string | readonly string[]
  /** Overrides the default redirect cap (MAX_REDIRECTS) for this call. */
  maxRedirects?: number
  /** Per-hop timeout budget in milliseconds (default DEFAULT_TIMEOUT_MS). */
  timeoutMs?: number
}

export async function safeFetch(rawUrl: string, init?: SafeFetchInit): Promise<Response> {
  const { allowedHostname, maxRedirects, timeoutMs, signal, ...fetchInit } = init ?? {}
  const redirectLimit = maxRedirects ?? MAX_REDIRECTS
  const hopTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS

  let validated = await assertPublicUrl(rawUrl, { allowedHostname })
  let currentUrl = validated.url.toString()
  let currentOrigin = validated.url.origin
  let headers: HeadersInit | undefined = fetchInit.headers

  for (let redirectCount = 0; redirectCount <= redirectLimit; redirectCount++) {
    const agent = createPinnedAgent(selectPinnedAddress(validated.ips))
    const timeout = AbortSignal.timeout(hopTimeout)
    const hopSignal = signal ? AbortSignal.any([signal, timeout]) : timeout

    let response: Response
    try {
      response = (await undiciFetch(currentUrl, {
        ...fetchInit,
        headers,
        redirect: 'manual',
        signal: hopSignal,
        dispatcher: agent,
      } as Parameters<typeof undiciFetch>[1])) as unknown as Response
    } catch (error) {
      void agent.destroy()
      throw error
    }

    const isRedirectStatus = response.status >= 300 && response.status < 400
    const location = response.headers.get('location')

    if (!isRedirectStatus || !location) {
      // Graceful close: undici waits for the in-flight request (including the
      // response body the caller is about to read) before tearing the pool
      // down. destroy() here would abort streamed bodies mid-flight.
      void agent.close().catch(() => agent.destroy())
      return response
    }

    // The redirect body is never surfaced to the caller - cancel it so the
    // socket is released before this hop's agent goes away.
    await response.body?.cancel().catch(() => {})
    await agent.close().catch(() => agent.destroy())

    if (redirectCount === redirectLimit) {
      throw new SsrfBlockedError('SSRF blocked: too many redirects')
    }

    const nextUrl = new URL(location, currentUrl)
    validated = await assertPublicUrl(nextUrl.toString(), { allowedHostname })
    if (validated.url.origin !== currentOrigin) {
      headers = stripCredentialHeaders(headers)
    }
    currentUrl = validated.url.toString()
    currentOrigin = validated.url.origin
  }

  throw new SsrfBlockedError('SSRF blocked: too many redirects')
}
