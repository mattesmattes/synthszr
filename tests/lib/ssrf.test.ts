import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dns/promises so hostname-based lookups (e.g. https://example.com) don't
// depend on real network/DNS access in CI. IP-literal cases (127.0.0.1, ::1,
// etc.) never reach `lookup()` in the implementation, so they're unaffected.
const dnsMocks = vi.hoisted(() => ({
  lookup: vi.fn(),
}))

vi.mock('dns/promises', () => ({ lookup: dnsMocks.lookup }))

// Mock undici so the pinning wiring (which Agent gets built, with which
// `connect.lookup`, and which dispatcher reaches fetch) is observable without
// opening a real socket.
const undiciMocks = vi.hoisted(() => {
  const agents: Array<{ options: any; closed: boolean; destroyed: boolean }> = []
  class FakeAgent {
    options: any
    closed = false
    destroyed = false
    constructor(options: any) {
      this.options = options
      agents.push(this)
    }
    async close() { this.closed = true }
    async destroy() { this.destroyed = true }
  }
  return { agents, FakeAgent, fetch: vi.fn() }
})

vi.mock('undici', () => ({ Agent: undiciMocks.FakeAgent, fetch: undiciMocks.fetch }))

import { assertPublicUrl, safeFetch, isPrivateIP, isPrivateIPv4, isPrivateIPv6 } from '@/lib/security/ssrf'

beforeEach(() => {
  dnsMocks.lookup.mockReset()
  dnsMocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  undiciMocks.fetch.mockReset()
  undiciMocks.agents.length = 0
})

/** Runs the connector's lookup callback the way undici's socket layer would. */
function resolveViaConnector(
  agent: { options: any },
  hostname: string
): Promise<{ address: string; family: number }> {
  return new Promise((resolve, reject) => {
    agent.options.connect.lookup(hostname, {}, (err: Error | null, address: string, family: number) => {
      if (err) reject(err)
      else resolve({ address, family })
    })
  })
}

describe('Security: SSRF isPrivateIPv4', () => {
  it('blocks loopback (127.0.0.0/8)', () => {
    expect(isPrivateIPv4('127.0.0.1')).toBe(true)
  })

  it('blocks the unspecified address (0.0.0.0)', () => {
    expect(isPrivateIPv4('0.0.0.0')).toBe(true)
  })

  it('blocks cloud metadata / link-local (169.254.0.0/16)', () => {
    expect(isPrivateIPv4('169.254.169.254')).toBe(true)
  })

  it('blocks private range 10.0.0.0/8', () => {
    expect(isPrivateIPv4('10.0.0.1')).toBe(true)
  })

  it('blocks private range 172.16.0.0/12', () => {
    expect(isPrivateIPv4('172.16.0.1')).toBe(true)
    expect(isPrivateIPv4('172.31.255.255')).toBe(true)
    // Just outside the /12 range - not private
    expect(isPrivateIPv4('172.32.0.1')).toBe(false)
  })

  it('blocks private range 192.168.0.0/16', () => {
    expect(isPrivateIPv4('192.168.1.1')).toBe(true)
  })

  it('allows public IPv4 addresses', () => {
    expect(isPrivateIPv4('8.8.8.8')).toBe(false)
    expect(isPrivateIPv4('1.1.1.1')).toBe(false)
    expect(isPrivateIPv4('93.184.216.34')).toBe(false)
  })
})

describe('Security: SSRF isPrivateIPv6', () => {
  it('blocks loopback (::1)', () => {
    expect(isPrivateIPv6('::1')).toBe(true)
  })

  it('blocks the unspecified address (::)', () => {
    expect(isPrivateIPv6('::')).toBe(true)
  })

  it('blocks link-local (fe80::/10)', () => {
    expect(isPrivateIPv6('fe80::1')).toBe(true)
  })

  it('blocks unique local addresses (fc00::/7)', () => {
    expect(isPrivateIPv6('fc00::1')).toBe(true)
    expect(isPrivateIPv6('fd00::1')).toBe(true)
  })

  it('blocks IPv4-mapped private addresses (decimal form)', () => {
    expect(isPrivateIPv6('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateIPv6('::ffff:10.0.0.1')).toBe(true)
  })

  it('blocks IPv4-mapped private addresses (hex form)', () => {
    // ::ffff:7f00:1 = 127.0.0.1 (loopback)
    expect(isPrivateIPv6('::ffff:7f00:1')).toBe(true)
    // ::ffff:a00:1 = 10.0.0.1 (private)
    expect(isPrivateIPv6('::ffff:a00:1')).toBe(true)
    // ::ffff:c0a8:1 = 192.168.0.1 (private)
    expect(isPrivateIPv6('::ffff:c0a8:1')).toBe(true)
    // ::ffff:a9fe:a9fe = 169.254.169.254 (cloud metadata / link-local)
    expect(isPrivateIPv6('::ffff:a9fe:a9fe')).toBe(true)
    // fully expanded, uncompressed form of ::ffff:7f00:1
    expect(isPrivateIPv6('0:0:0:0:0:ffff:7f00:1')).toBe(true)
    // uppercase hex should be treated the same
    expect(isPrivateIPv6('::FFFF:7F00:1')).toBe(true)
  })

  it('allows public IPv6 addresses', () => {
    expect(isPrivateIPv6('2606:4700:4700::1111')).toBe(false)
  })

  it('does not misclassify a public address that merely contains "ffff" as IPv4-mapped', () => {
    // ffff sits in the wrong position (not hextet 6) - not an IPv4-mapped address
    expect(isPrivateIPv6('2001:ffff::1')).toBe(false)
  })
})

describe('Security: SSRF isPrivateIP (dispatch)', () => {
  it('dispatches to the correct family check', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true)
    expect(isPrivateIP('::1')).toBe(true)
    expect(isPrivateIP('8.8.8.8')).toBe(false)
  })

  it('fails closed for non-IP strings', () => {
    expect(isPrivateIP('not-an-ip')).toBe(true)
  })
})

describe('Security: SSRF assertPublicUrl', () => {
  it('blocks non-http(s) protocols', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow('SSRF blocked')
  })

  it('blocks cloud metadata IP literal', async () => {
    await expect(assertPublicUrl('http://169.254.169.254/')).rejects.toThrow('SSRF blocked')
  })

  it('blocks localhost by hostname', async () => {
    await expect(assertPublicUrl('http://localhost/')).rejects.toThrow('SSRF blocked')
  })

  it('blocks loopback IP literal', async () => {
    await expect(assertPublicUrl('http://127.0.0.1/')).rejects.toThrow('SSRF blocked')
  })

  it('blocks private range IP literal', async () => {
    await expect(assertPublicUrl('http://10.0.0.1/')).rejects.toThrow('SSRF blocked')
  })

  it('blocks IPv6 loopback literal', async () => {
    await expect(assertPublicUrl('http://[::1]/')).rejects.toThrow('SSRF blocked')
  })

  it('blocks IPv4-mapped loopback literal in hex form', async () => {
    await expect(assertPublicUrl('http://[::ffff:7f00:1]/')).rejects.toThrow('SSRF blocked')
  })

  it('blocks IPv4-mapped cloud-metadata literal in hex form', async () => {
    await expect(assertPublicUrl('http://[::ffff:a9fe:a9fe]/')).rejects.toThrow('SSRF blocked')
  })

  it('does not block a normal public domain, and returns the resolved IP(s)', async () => {
    const result = await assertPublicUrl('https://example.com')
    expect(result.url).toBeInstanceOf(URL)
    expect(result.ips).toEqual(['93.184.216.34'])
  })
})

describe('Security: SSRF safeFetch DNS pinning (SEC-004)', () => {
  it('connects to the address assertPublicUrl validated, not a re-resolved one', async () => {
    // First answer (validation) is public, every later answer is loopback -
    // the classic DNS-rebinding pattern.
    dnsMocks.lookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    undiciMocks.fetch.mockResolvedValue(new Response('ok'))

    await safeFetch('https://example.com')

    expect(undiciMocks.agents).toHaveLength(1)
    await expect(resolveViaConnector(undiciMocks.agents[0], 'example.com'))
      .resolves.toEqual({ address: '93.184.216.34', family: 4 })
  })

  it('never asks DNS a second time for the connection itself', async () => {
    undiciMocks.fetch.mockResolvedValue(new Response('ok'))

    await safeFetch('https://example.com')

    expect(dnsMocks.lookup).toHaveBeenCalledTimes(1)
  })

  it('passes the pinned dispatcher to fetch and handles redirects manually', async () => {
    undiciMocks.fetch.mockResolvedValue(new Response('ok'))

    await safeFetch('https://example.com')

    expect(undiciMocks.fetch).toHaveBeenCalledWith(
      'https://example.com/',
      expect.objectContaining({
        dispatcher: undiciMocks.agents[0],
        redirect: 'manual',
        signal: expect.any(AbortSignal),
      })
    )
  })

  it('keeps the original hostname in the request URL so Host/SNI stay correct', async () => {
    undiciMocks.fetch.mockResolvedValue(new Response('ok'))

    await safeFetch('https://example.com/path')

    expect(undiciMocks.fetch.mock.calls[0][0]).toBe('https://example.com/path')
  })

  it('blocks a redirect to link-local before opening the second connection', async () => {
    undiciMocks.fetch.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })
    )

    await expect(safeFetch('https://example.com')).rejects.toThrow('SSRF blocked')
    expect(undiciMocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('pins each redirect hop to its own validated address', async () => {
    dnsMocks.lookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '203.0.113.7', family: 4 }])
    undiciMocks.fetch
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/final' } }))
      .mockResolvedValueOnce(new Response('ok'))

    await safeFetch('https://example.com')

    expect(undiciMocks.agents).toHaveLength(2)
    await expect(resolveViaConnector(undiciMocks.agents[1], 'elsewhere.test'))
      .resolves.toEqual({ address: '203.0.113.7', family: 4 })
  })

  it('drops credential headers when a redirect crosses origins', async () => {
    dnsMocks.lookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '203.0.113.7', family: 4 }])
    undiciMocks.fetch
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/final' } }))
      .mockResolvedValueOnce(new Response('ok'))

    await safeFetch('https://example.com', {
      headers: { Authorization: 'Bearer secret', Cookie: 'session=abc', Accept: 'text/html' },
    })

    const secondHopHeaders = new Headers(undiciMocks.fetch.mock.calls[1][1].headers)
    expect(secondHopHeaders.get('authorization')).toBeNull()
    expect(secondHopHeaders.get('cookie')).toBeNull()
    expect(secondHopHeaders.get('accept')).toBe('text/html')
  })

  it('closes the pinned dispatcher for every hop', async () => {
    undiciMocks.fetch.mockResolvedValue(new Response('ok'))

    await safeFetch('https://example.com')

    expect(undiciMocks.agents[0].closed).toBe(true)
  })

  it('tears the dispatcher down when the request fails', async () => {
    undiciMocks.fetch.mockRejectedValue(new Error('socket hang up'))

    await expect(safeFetch('https://example.com')).rejects.toThrow('socket hang up')
    expect(undiciMocks.agents[0].destroyed).toBe(true)
  })

  it('aborts a hop that outlives its timeout budget', async () => {
    undiciMocks.fetch.mockImplementation((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('The operation was aborted')))
      })
    )

    await expect(safeFetch('https://example.com', { timeoutMs: 10 })).rejects.toThrow(/abort/i)
  })
})
