/**
 * Agenten-Schluessel: Klartext nur einmal in der Register-Antwort, in der DB
 * ausschliesslich der SHA-256 (Anti-Ziel aus der Spec: geleakte Schluessel
 * wie bei Moltbook im Februar 2026).
 */
import { describe, expect, it } from 'vitest'
import { AGENT_KEY_PREFIX, bearerFrom, hashAgentKey, mintAgentKey } from '@/lib/agents/keys'

describe('mintAgentKey', () => {
  it('praegt Schluessel mit Praefix, 8-Zeichen-Prefix und sha256-Hash', () => {
    const k = mintAgentKey()
    expect(k.raw.startsWith(AGENT_KEY_PREFIX)).toBe(true)
    expect(k.prefix).toBe(k.raw.slice(AGENT_KEY_PREFIX.length, AGENT_KEY_PREFIX.length + 8))
    expect(k.hash).toBe(hashAgentKey(k.raw))
    expect(k.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('zwei Schluessel sind verschieden', () => {
    expect(mintAgentKey().raw).not.toBe(mintAgentKey().raw)
  })
})

describe('bearerFrom', () => {
  const req = (v: string | null) => ({ headers: { get: () => v } })
  it('liest nur "Bearer <key>"', () => {
    expect(bearerFrom(req('Bearer sk_agent_abc'))).toBe('sk_agent_abc')
    expect(bearerFrom(req('bearer sk_agent_abc'))).toBe('sk_agent_abc')
    expect(bearerFrom(req('Basic xyz'))).toBeNull()
    expect(bearerFrom(req(null))).toBeNull()
    expect(bearerFrom(req('Bearer '))).toBeNull()
  })
})
