import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('Security: Cron Authentication', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    vi.resetModules()
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    // Restore original env
    Object.keys(process.env).forEach(key => {
      if (!(key in originalEnv)) {
        delete process.env[key]
      }
    })
    Object.assign(process.env, originalEnv)
  })

  it('authorizes with valid CRON_SECRET bearer token', async () => {
    process.env.CRON_SECRET = 'test-secret-123'
    vi.stubEnv('NODE_ENV', 'production')

    const { verifyCronAuth } = await import('@/lib/security/cron-auth')
    const request = {
      headers: {
        get: (key: string) => key === 'authorization' ? 'Bearer test-secret-123' : null
      }
    } as any

    const result = verifyCronAuth(request)
    expect(result.authorized).toBe(true)
    expect(result.method).toBe('bearer')
  })

  it('rejects spoofed x-vercel-cron without bearer secret', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.CRON_SECRET = 'real-secret'

    const { verifyCronAuth } = await import('@/lib/security/cron-auth')
    const request = {
      headers: {
        get: (key: string) => key === 'x-vercel-cron' ? '1' : null
      }
    } as any

    const result = verifyCronAuth(request)
    expect(result).toEqual({ authorized: false, method: 'none' })
  })

  it('rejects in production without valid credentials', async () => {
    process.env.CRON_SECRET = 'real-secret'
    vi.stubEnv('NODE_ENV', 'production')

    const { verifyCronAuth } = await import('@/lib/security/cron-auth')
    const request = {
      headers: {
        get: () => null
      }
    } as any

    const result = verifyCronAuth(request)
    expect(result.authorized).toBe(false)
    expect(result.method).toBe('none')
  })

  it('rejects dev bypass without ALLOW_DEV_CRON_BYPASS', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    delete process.env.ALLOW_DEV_CRON_BYPASS

    const { verifyCronAuth } = await import('@/lib/security/cron-auth')
    const request = {
      headers: {
        get: () => null
      }
    } as any

    const result = verifyCronAuth(request)
    expect(result.authorized).toBe(false)
  })

  it('does not allow dev bypass (removed for security)', async () => {
    // Dev bypass was removed - CRON_SECRET is required in all environments
    vi.stubEnv('NODE_ENV', 'development')
    process.env.ALLOW_DEV_CRON_BYPASS = 'true'

    const { verifyCronAuth } = await import('@/lib/security/cron-auth')
    const request = {
      headers: {
        get: () => null
      }
    } as any

    const result = verifyCronAuth(request)
    expect(result.authorized).toBe(false)
    expect(result.method).toBe('none')
  })
})

describe('Security: Startup Checks', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    vi.resetModules()
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    // Restore original env
    Object.keys(process.env).forEach(key => {
      if (!(key in originalEnv)) {
        delete process.env[key]
      }
    })
    Object.assign(process.env, originalEnv)
  })

  // Tests run with .env.local injected, so every variable under test has to be
  // cleared explicitly - otherwise a real local value silently satisfies a
  // check the test means to fail.
  const SECURITY_ENV_KEYS = [
    'JWT_SECRET', 'CRON_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_PASSWORD', 'REVALIDATE_SECRET',
    'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
    'VERCEL_ENV',
  ]

  /** Builds a fully-configured production env, then applies the overrides. */
  function productionEnv(overrides: Record<string, string | undefined> = {}) {
    for (const key of SECURITY_ENV_KEYS) delete process.env[key]
    vi.stubEnv('NODE_ENV', 'production')

    const values: Record<string, string | undefined> = {
      VERCEL_ENV: 'production',
      JWT_SECRET: 'jwt-secret',
      CRON_SECRET: 'cron-secret',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      ADMIN_PASSWORD: 'admin-password',
      REVALIDATE_SECRET: 'revalidate-secret',
      KV_REST_API_URL: 'https://kv.vercel-storage.com',
      KV_REST_API_TOKEN: 'kv-token',
      ...overrides,
    }

    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }

  it('validates production config with all secrets', async () => {
    productionEnv()

    const { validateSecurityConfig } = await import('@/lib/security/startup-checks')
    const result = validateSecurityConfig()

    expect(result.errors).toHaveLength(0)
    expect(result.valid).toBe(true)
  })

  it('reports missing JWT_SECRET in production', async () => {
    productionEnv({ JWT_SECRET: undefined })

    const { validateSecurityConfig } = await import('@/lib/security/startup-checks')
    const result = validateSecurityConfig()

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('JWT_SECRET'))).toBe(true)
  })

  it('reports missing CRON_SECRET in production', async () => {
    productionEnv({ CRON_SECRET: undefined })

    const { validateSecurityConfig } = await import('@/lib/security/startup-checks')
    const result = validateSecurityConfig()

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('CRON_SECRET'))).toBe(true)
  })

  it('reports missing ADMIN_PASSWORD in production', async () => {
    productionEnv({ ADMIN_PASSWORD: undefined })

    const { validateSecurityConfig } = await import('@/lib/security/startup-checks')
    const result = validateSecurityConfig()

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('ADMIN_PASSWORD'))).toBe(true)
  })

  it('reports missing REVALIDATE_SECRET in production', async () => {
    productionEnv({ REVALIDATE_SECRET: undefined })

    const { validateSecurityConfig } = await import('@/lib/security/startup-checks')
    const result = validateSecurityConfig()

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('REVALIDATE_SECRET'))).toBe(true)
  })

  it('accepts the KV_REST_API_* pair this deployment actually uses', async () => {
    productionEnv()

    const { validateSecurityConfig } = await import('@/lib/security/startup-checks')
    const result = validateSecurityConfig()

    expect(result.errors.some(e => e.includes('Rate limit'))).toBe(false)
    expect(result.warnings.some(w => w.includes('Rate limit'))).toBe(false)
  })

  it('accepts the UPSTASH_REDIS_REST_* pair as an equivalent alternative', async () => {
    productionEnv({
      KV_REST_API_URL: undefined,
      KV_REST_API_TOKEN: undefined,
      UPSTASH_REDIS_REST_URL: 'https://redis.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'token',
    })

    const { validateSecurityConfig } = await import('@/lib/security/startup-checks')
    const result = validateSecurityConfig()

    expect(result.valid).toBe(true)
  })

  it('treats a half-configured credential pair as an error', async () => {
    productionEnv({ KV_REST_API_TOKEN: undefined })

    const { validateSecurityConfig } = await import('@/lib/security/startup-checks')
    const result = validateSecurityConfig()

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Rate limit'))).toBe(true)
  })

  it('fails, not warns, when production has no rate limiting at all', async () => {
    productionEnv({ KV_REST_API_URL: undefined, KV_REST_API_TOKEN: undefined })

    const { validateSecurityConfig } = await import('@/lib/security/startup-checks')
    const result = validateSecurityConfig()

    // Without a limiter every rate-limited security route collectively fails
    // closed to 429 - that is an outage, not a warning.
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('Rate limit'))).toBe(true)
  })

  it('never advertises a development cron bypass', async () => {
    productionEnv({ CRON_SECRET: undefined })
    const { validateSecurityConfig } = await import('@/lib/security/startup-checks')
    expect(JSON.stringify(validateSecurityConfig())).not.toMatch(/bypass/i)

    vi.stubEnv('NODE_ENV', 'development')
    delete process.env.CRON_SECRET
    vi.resetModules()
    const dev = await import('@/lib/security/startup-checks')
    expect(JSON.stringify(dev.validateSecurityConfig())).not.toMatch(/bypass/i)
  })
})

describe('Security: Startup Enforcement', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    vi.resetModules()
    originalEnv = { ...process.env }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    Object.keys(process.env).forEach(key => {
      if (!(key in originalEnv)) delete process.env[key]
    })
    Object.assign(process.env, originalEnv)
  })

  it('throws in a real production deployment when a secret is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.VERCEL_ENV = 'production'
    delete process.env.CRON_SECRET

    const { enforceSecurityConfig } = await import('@/lib/security/startup-checks')
    expect(() => enforceSecurityConfig()).toThrow(/CRON_SECRET/)
  })

  it('does not take down preview deployments, which run NODE_ENV=production without the production secrets', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.VERCEL_ENV = 'preview'
    delete process.env.CRON_SECRET
    delete process.env.ADMIN_PASSWORD

    const { enforceSecurityConfig } = await import('@/lib/security/startup-checks')
    expect(() => enforceSecurityConfig()).not.toThrow()
  })
})
