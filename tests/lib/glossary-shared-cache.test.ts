/**
 * withSharedCache: die instanzuebergreifende Redis-Schicht vor den
 * Voll-Katalog-Scans des Lexikons.
 *
 * Warum es diese Schicht ueberhaupt gibt: der TTL-Cache in terms.ts ist eine
 * modulweite Map und lebt damit pro Function-Instanz. Next deployt jede Route
 * als eigene Function, und Instanzen starten kalt — der Cache traf in Produktion
 * so selten, dass der Egress nach seiner Einfuehrung (2026-08-19) unveraendert
 * bei 50-125 GB/Tag blieb.
 *
 * Der wichtigste Test hier ist die Degradation: faellt Redis aus oder fehlt die
 * Konfiguration (lokal, Tests, Preview ohne Integration), MUSS der Loader
 * durchlaufen. Ein Cache, der bei Stoerung den Lesepfad mitreisst, waere
 * schlimmer als gar keiner.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))
vi.mock('@upstash/redis', () => ({
  Redis: class { get = mocks.get; set = mocks.set },
}))

async function load() {
  vi.resetModules()
  return import('@/lib/cache/shared-cache')
}

beforeEach(() => {
  mocks.get.mockReset()
  mocks.set.mockReset()
  vi.stubEnv('KV_REST_API_URL', 'https://example.upstash.io')
  vi.stubEnv('KV_REST_API_TOKEN', 'token')
  // .env.local setzt VERCEL_ENV=production — ohne dieses Zuruecksetzen haenge
  // die Namensraum-Erwartung an der lokalen Konfiguration des Entwicklers.
  vi.stubEnv('VERCEL_ENV', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('withSharedCache', () => {
  it('reicht bei fehlender Upstash-Konfiguration einfach den Loader durch', async () => {
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
    const { withSharedCache } = await load()
    const loader = vi.fn().mockResolvedValue(['a'])
    expect(await withSharedCache('k', loader)).toEqual(['a'])
    expect(loader).toHaveBeenCalledTimes(1)
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('laedt bei einem Treffer NICHT aus der Datenbank', async () => {
    mocks.get.mockResolvedValue(['aus-redis'])
    const { withSharedCache } = await load()
    const loader = vi.fn().mockResolvedValue(['aus-db'])
    expect(await withSharedCache('k', loader)).toEqual(['aus-redis'])
    expect(loader).not.toHaveBeenCalled()
  })

  it('schreibt bei einem Fehltreffer mit TTL zurueck', async () => {
    mocks.get.mockResolvedValue(null)
    const { withSharedCache } = await load()
    const loader = vi.fn().mockResolvedValue(['frisch'])
    expect(await withSharedCache('k', loader)).toEqual(['frisch'])
    expect(mocks.set).toHaveBeenCalledWith('local:k', ['frisch'], expect.objectContaining({ ex: expect.any(Number) }))
  })

  it('trennt die Schluessel nach Umgebung, damit Tests/Dev Produktion nicht ueberschreiben', async () => {
    // Genau das ist am 2026-08-20 passiert: ein Testlauf hat den Prod-Schluessel
    // glossary:v1:matcher:de mit einem einzigen Fixture-Begriff ueberschrieben.
    vi.stubEnv('VERCEL_ENV', 'production')
    const prod = await load()
    mocks.get.mockResolvedValue(null)
    await prod.withSharedCache('glossary:v1:matcher:de', vi.fn().mockResolvedValue(['x']))
    expect(mocks.get).toHaveBeenCalledWith('production:glossary:v1:matcher:de')

    vi.stubEnv('VERCEL_ENV', 'preview')
    const preview = await load()
    await preview.withSharedCache('glossary:v1:matcher:de', vi.fn().mockResolvedValue(['x']))
    expect(mocks.get).toHaveBeenCalledWith('preview:glossary:v1:matcher:de')
  })

  it('degradiert auf den Loader, wenn Redis beim Lesen ausfaellt', async () => {
    mocks.get.mockRejectedValue(new Error('upstash down'))
    const { withSharedCache } = await load()
    const loader = vi.fn().mockResolvedValue(['aus-db'])
    expect(await withSharedCache('k', loader)).toEqual(['aus-db'])
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('liefert das Ergebnis auch dann, wenn Redis beim Schreiben ausfaellt', async () => {
    mocks.get.mockResolvedValue(null)
    mocks.set.mockRejectedValue(new Error('upstash down'))
    const { withSharedCache } = await load()
    expect(await withSharedCache('k', vi.fn().mockResolvedValue(['frisch']))).toEqual(['frisch'])
  })

  it('schreibt einen nicht cachebaren Wert nicht fest (null = Lesefehler)', async () => {
    mocks.get.mockResolvedValue(null)
    const { withSharedCache } = await load()
    const res = await withSharedCache('k', vi.fn().mockResolvedValue(null), (v) => v !== null)
    expect(res).toBeNull()
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('schreibt eine leere Liste nicht fest', async () => {
    mocks.get.mockResolvedValue(null)
    const { withSharedCache } = await load()
    await withSharedCache('k', vi.fn().mockResolvedValue([]), (v) => Array.isArray(v) && v.length > 0)
    expect(mocks.set).not.toHaveBeenCalled()
  })
})
