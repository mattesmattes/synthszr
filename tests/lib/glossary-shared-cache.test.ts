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

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), mget: vi.fn() }))
vi.mock('@upstash/redis', () => ({
  Redis: class { get = mocks.get; set = mocks.set; mget = mocks.mget },
}))

async function load() {
  vi.resetModules()
  return import('@/lib/cache/shared-cache')
}

beforeEach(() => {
  mocks.get.mockReset()
  mocks.set.mockReset()
  mocks.mget.mockReset()
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

/**
 * Speicher-Ebene VOR Redis (28.08.2026).
 *
 * Vorher fragte withSharedCache bei JEDEM Aufruf Redis, obwohl der TTL-Cache in
 * terms.ts die Antwort oft schon hatte — der sass aber HINTER dieser Schicht,
 * also erst im Loader, wo er nichts mehr spart. Eine Begriffsseite kostete so
 * drei Redis-Commands; bei 2360 Begriffen x 5 Sprachen sind das 35.400 pro
 * Vollcrawl, und das Upstash-Kontingent (500.000/Monat) war nach 14 Crawls
 * erschoepft — was am 28.08. auch eintrat.
 *
 * Die Speicher-TTL ist bewusst KURZ (60s) und nicht so lang wie die
 * Redis-TTL (1h): Die Ebenen verketten sich, ein aus Redis geholter Wert kann
 * selbst schon fast eine Stunde alt sein. 60s halten den schlimmsten Fall bei
 * 1h+1min statt bei 2h und sparen praktisch dasselbe — ein Crawler, der 100
 * Seiten pro Minute abruft, braucht damit einen Redis-Zugriff statt 300.
 */
describe('withSharedCache — Speicher-Ebene vor Redis', () => {
  it('fragt Redis beim zweiten Aufruf desselben Schluessels nicht erneut', async () => {
    mocks.get.mockResolvedValue(['aus-redis'])
    const { withSharedCache } = await load()
    const loader = vi.fn().mockResolvedValue(['aus-db'])

    expect(await withSharedCache('k', loader)).toEqual(['aus-redis'])
    expect(await withSharedCache('k', loader)).toEqual(['aus-redis'])

    expect(mocks.get).toHaveBeenCalledTimes(1)
    expect(loader).not.toHaveBeenCalled()
  })

  it('haelt verschiedene Schluessel auseinander', async () => {
    mocks.get.mockResolvedValue(['x'])
    const { withSharedCache } = await load()
    const loader = vi.fn().mockResolvedValue(['y'])
    await withSharedCache('a', loader)
    await withSharedCache('b', loader)
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it('merkt sich auch einen Wert, der erst der Loader geliefert hat', async () => {
    mocks.get.mockResolvedValue(null) // Redis-Fehltreffer
    const { withSharedCache } = await load()
    const loader = vi.fn().mockResolvedValue(['aus-db'])

    await withSharedCache('k', loader)
    await withSharedCache('k', loader)

    expect(loader).toHaveBeenCalledTimes(1)
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it('fragt nach Ablauf der Speicher-TTL wieder Redis', async () => {
    vi.useFakeTimers()
    try {
      mocks.get.mockResolvedValue(['v'])
      const { withSharedCache } = await load()
      const loader = vi.fn().mockResolvedValue(['w'])

      await withSharedCache('k', loader)
      vi.advanceTimersByTime(61_000)
      await withSharedCache('k', loader)

      expect(mocks.get).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('zementiert einen nicht cachebaren Wert auch im Speicher nicht', async () => {
    mocks.get.mockResolvedValue(null)
    const { withSharedCache } = await load()
    const loader = vi.fn().mockResolvedValue([]) // leere Liste = nicht cachebar

    await withSharedCache('k', loader, (v) => (v as unknown[]).length > 0)
    await withSharedCache('k', loader, (v) => (v as unknown[]).length > 0)

    expect(loader).toHaveBeenCalledTimes(2)
  })
})

/**
 * Vorwaermen (28.08.2026, Schritt 2).
 *
 * Eine Begriffsseite braucht drei Cache-Eintraege: Begriffsliste,
 * Chart-Produkte, Matcher-Liste. Als drei getrennte withSharedCache-Aufrufe
 * sind das drei Redis-Kommandos. prewarmSharedCache holt sie in EINEM MGET in
 * die Speicher-Ebene; die drei Einzelaufrufe treffen danach den Speicher und
 * fragen Redis nicht mehr.
 *
 * Warum nicht ein gemeinsamer Schluessel fuer alle drei: Der Lexikon-Index und
 * die Sitemap brauchen nur die Begriffsliste. Ein Buendel wuerde ihnen die
 * Chart-Produkte und die Matcher-Liste aufzwingen — mehr Bytes fuer weniger
 * Kommandos, ein schlechter Tausch bei 2360 Begriffen.
 */
describe('prewarmSharedCache', () => {
  it('holt mehrere Schluessel in EINEM Kommando und bedient danach aus dem Speicher', async () => {
    mocks.mget.mockResolvedValue([['liste'], ['produkte']])
    const { prewarmSharedCache, withSharedCache } = await load()

    await prewarmSharedCache(['a', 'b'])
    expect(mocks.mget).toHaveBeenCalledTimes(1)

    const loader = vi.fn().mockResolvedValue(['aus-db'])
    expect(await withSharedCache('a', loader)).toEqual(['liste'])
    expect(await withSharedCache('b', loader)).toEqual(['produkte'])

    expect(mocks.get).not.toHaveBeenCalled()
    expect(loader).not.toHaveBeenCalled()
  })

  it('merkt sich nur die Schluessel, die Redis wirklich hatte', async () => {
    mocks.mget.mockResolvedValue([null, ['da']])
    mocks.get.mockResolvedValue(null)
    const { prewarmSharedCache, withSharedCache } = await load()

    await prewarmSharedCache(['fehlt', 'da'])
    const loader = vi.fn().mockResolvedValue(['aus-db'])

    expect(await withSharedCache('fehlt', loader)).toEqual(['aus-db'])
    expect(mocks.get).toHaveBeenCalledTimes(1) // nur fuer den fehlenden
    expect(await withSharedCache('da', loader)).toEqual(['da'])
    expect(mocks.get).toHaveBeenCalledTimes(1) // der andere kam aus dem Speicher
  })

  it('fragt gar nicht erst, wenn alles schon im Speicher liegt', async () => {
    mocks.mget.mockResolvedValue([['x']])
    const { prewarmSharedCache } = await load()
    await prewarmSharedCache(['a'])
    await prewarmSharedCache(['a'])
    expect(mocks.mget).toHaveBeenCalledTimes(1)
  })

  it('bleibt folgenlos, wenn Redis beim Vorwaermen ausfaellt', async () => {
    mocks.mget.mockRejectedValue(new Error('down'))
    mocks.get.mockResolvedValue(null)
    const { prewarmSharedCache, withSharedCache } = await load()

    await expect(prewarmSharedCache(['a'])).resolves.toBeUndefined()
    const loader = vi.fn().mockResolvedValue(['aus-db'])
    expect(await withSharedCache('a', loader)).toEqual(['aus-db'])
  })

  it('tut nichts ohne Upstash-Konfiguration', async () => {
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    const { prewarmSharedCache } = await load()
    await prewarmSharedCache(['a'])
    expect(mocks.mget).not.toHaveBeenCalled()
  })
})
