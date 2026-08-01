import { describe, it, expect, vi } from 'vitest'

// Mock dns/promises so hostname-based lookups (e.g. https://example.com) don't
// depend on real network/DNS access in CI. IP-literal cases (127.0.0.1, ::1,
// etc.) never reach `lookup()` in the implementation, so they're unaffected.
vi.mock('dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}))

import { assertPublicUrl, isPrivateIP, isPrivateIPv4, isPrivateIPv6 } from '@/lib/security/ssrf'

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

  it('blocks IPv4-mapped private addresses', () => {
    expect(isPrivateIPv6('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateIPv6('::ffff:10.0.0.1')).toBe(true)
  })

  it('allows public IPv6 addresses', () => {
    expect(isPrivateIPv6('2606:4700:4700::1111')).toBe(false)
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

  it('does not block a normal public domain', async () => {
    await expect(assertPublicUrl('https://example.com')).resolves.toBeInstanceOf(URL)
  })
})
