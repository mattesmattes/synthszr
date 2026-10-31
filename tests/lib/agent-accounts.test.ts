/**
 * Agenten-Konten: Registrierung ohne Bestaetigung (Spec v2). Geprueft wird,
 * dass nur der Hash gespeichert wird, dass Handle-Kollision und IP-Tageslimit
 * sauber gemeldet werden und dass die Authentifizierung ueber den Hash laeuft.
 */
import { describe, expect, it } from 'vitest'
import { registerAgent, authenticateAgent, isNewAgent, hashIp } from '@/lib/agents/accounts'
import { hashAgentKey } from '@/lib/agents/keys'

const INPUT = {
  handle: 'argus', display_name: 'Argus', description: 'Liest täglich KI-News und widerspricht.',
  model: 'claude-opus-5',
}
const ROW = { id: 'a1', handle: 'argus', display_name: 'Argus', description: 'd', model: 'm', status: 'active', created_at: '2026-10-26T06:00:00Z' }

/** Fake-PostgREST fuer agent_accounts: Zaehlabfrage, Insert, Lookup, Update. */
function fakeClient(opts: { ipCount?: number; insertError?: { code?: string; message: string } | null; found?: unknown } = {}) {
  const calls: { insert?: Record<string, unknown>; update?: Record<string, unknown> } = {}
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.gte = () => Promise.resolve({ count: opts.ipCount ?? 0, error: null })
  chain.insert = (p: Record<string, unknown>) => { calls.insert = p; return chain }
  chain.single = () => Promise.resolve(opts.insertError ? { data: null, error: opts.insertError } : { data: ROW, error: null })
  chain.maybeSingle = () => Promise.resolve({ data: opts.found ?? null, error: null })
  chain.update = (p: Record<string, unknown>) => { calls.update = p; return chain }
  return { client: { from: () => chain } as never, calls }
}

describe('registerAgent', () => {
  it('speichert Hash und Prefix, nie den Klartext', async () => {
    const { client, calls } = fakeClient()
    const r = await registerAgent(client, INPUT, 'iphash')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.apiKey.startsWith('sk_agent_')).toBe(true)
    expect(calls.insert?.api_key_hash).toBe(hashAgentKey(r.apiKey))
    expect(calls.insert?.api_key_prefix).toBe(r.apiKey.slice(9, 17))
    expect(JSON.stringify(calls.insert)).not.toContain(r.apiKey)
    expect(calls.insert?.registered_ip_hash).toBe('iphash')
    expect(r.account.handle).toBe('argus')
  })

  it('speichert keinen Besitzer, auch wenn eine alte skill.md-Kopie ihn sendet', async () => {
    const { client, calls } = fakeClient()
    const r = await registerAgent(client, { ...INPUT, owner_handle: 'mattes', owner_contact: 'mail@example.test' }, 'iphash')
    expect(r.ok).toBe(true)
    expect(calls.insert).not.toHaveProperty('owner_handle')
    expect(calls.insert).not.toHaveProperty('owner_contact')
  })

  it('meldet handle_taken bei Unique-Verletzung', async () => {
    const { client } = fakeClient({ insertError: { code: '23505', message: 'duplicate key' } })
    expect(await registerAgent(client, INPUT, 'iphash')).toEqual({ ok: false, error: 'handle_taken' })
  })

  it('meldet ip_daily_limit ab 20 Registrierungen derselben IP am Tag', async () => {
    const { client, calls } = fakeClient({ ipCount: 20 })
    expect(await registerAgent(client, INPUT, 'iphash')).toEqual({ ok: false, error: 'ip_daily_limit' })
    expect(calls.insert).toBeUndefined()
  })
})

describe('authenticateAgent', () => {
  it('liefert null ohne Schluessel und ohne Treffer', async () => {
    expect(await authenticateAgent(fakeClient().client, null)).toBeNull()
    expect(await authenticateAgent(fakeClient().client, 'sk_agent_x')).toBeNull()
  })

  it('findet das Konto ueber den Hash und gibt auch suspended zurueck', async () => {
    const { client, calls } = fakeClient({ found: { ...ROW, status: 'suspended' } })
    const a = await authenticateAgent(client, 'sk_agent_x')
    expect(a?.status).toBe('suspended')
    expect(calls.update?.last_seen_at).toBeTruthy()
  })
})

describe('isNewAgent', () => {
  it('ist in den ersten sieben Tagen neu', () => {
    const a = { ...ROW, status: 'active' as const }
    expect(isNewAgent(a, new Date('2026-11-01T06:00:00Z'))).toBe(true)   // Tag 6
    expect(isNewAgent(a, new Date('2026-11-03T06:00:00Z'))).toBe(false)  // Tag 8
  })
})

describe('hashIp', () => {
  it('ist stabil und kein Klartext', () => {
    expect(hashIp('1.2.3.4')).toBe(hashIp('1.2.3.4'))
    expect(hashIp('1.2.3.4')).not.toContain('1.2.3.4')
  })
})
