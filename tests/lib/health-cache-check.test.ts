/**
 * Der Health-Check prueft auch, ob der geteilte Cache noch antwortet.
 *
 * Anlass 28.08.2026: Das Upstash-Kontingent (500.000 Commands/Monat) war
 * erschoepft, der Cache fiel bei jedem Zugriff auf die Datenbank zurueck — und
 * das TAGELANG unbemerkt. Aufgefallen ist es zufaellig bei der Suche nach einem
 * ganz anderen Fehler. Funktional merkt man nichts (der Fallback greift sauber),
 * nur der Supabase-Egress steigt still wieder an.
 *
 * Geprueft wird SCHREIBEN UND LESEN eines eigenen Testschluessels, nicht bloss
 * ein PING: Der zweite bekannte Fehlermodus ist ein eingefrorener Vercel Data
 * Cache (der Upstash-Client laeuft mit `cache: 'force-cache'`, s. Begruendung in
 * lib/cache/shared-cache.ts). Dann antwortet Upstash zwar, aber die Function
 * bekommt eine alte Antwort serviert und schreibt nichts mehr. Ein Roundtrip
 * faellt darauf herein, ein PING nicht.
 *
 * Kosten: zwei Kommandos alle vier Stunden, rund 360 im Monat.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({ set: vi.fn(), get: vi.fn() }))
vi.mock('@upstash/redis', () => ({
  Redis: class { set = mocks.set; get = mocks.get },
}))

async function load() {
  vi.resetModules()
  return import('@/lib/health/cache-check')
}

beforeEach(() => {
  mocks.set.mockReset()
  mocks.get.mockReset()
  vi.stubEnv('KV_REST_API_URL', 'https://example.upstash.io')
  vi.stubEnv('KV_REST_API_TOKEN', 'token')
})
afterEach(() => vi.unstubAllEnvs())

describe('checkSharedCache', () => {
  it('meldet den Cache als gesund, wenn der Roundtrip aufgeht', async () => {
    mocks.set.mockResolvedValue('OK')
    mocks.get.mockImplementation(async () => mocks.set.mock.calls[0][1])
    const { checkSharedCache } = await load()
    expect(await checkSharedCache()).toEqual({ healthy: true })
  })

  it('meldet den Fehlertext, wenn Upstash das Kontingent verweigert', async () => {
    mocks.set.mockRejectedValue(new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500000'))
    const { checkSharedCache } = await load()
    const r = await checkSharedCache()
    expect(r.healthy).toBe(false)
    expect(r.error).toMatch(/max requests limit/)
  })

  it('erkennt einen eingefrorenen Wert — geschrieben, aber anders zurueckgelesen', async () => {
    mocks.set.mockResolvedValue('OK')
    mocks.get.mockResolvedValue('ein-alter-wert')
    const { checkSharedCache } = await load()
    const r = await checkSharedCache()
    expect(r.healthy).toBe(false)
    expect(r.error).toMatch(/zurueckgelesen|Roundtrip/i)
  })

  it('meldet fehlende Konfiguration als ungesund, nicht als gesund', async () => {
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
    const { checkSharedCache } = await load()
    const r = await checkSharedCache()
    expect(r.healthy).toBe(false)
    expect(mocks.set).not.toHaveBeenCalled()
  })
})
