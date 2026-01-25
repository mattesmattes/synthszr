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

  it('authorizes with x-vercel-cron header', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    const { verifyCronAuth } = await import('@/lib/security/cron-auth')
    const request = {
      headers: {
        get: (key: string) => key === 'x-vercel-cron' ? '1' : null
      }
    } as any

    const result = verifyCronAuth(request)
    expect(result.authorized).toBe(true)
    expect(result.method).toBe('vercel-cron')
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

  it('validates production config with all secrets', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.JWT_SECRET = 'jwt-secret'
    process.env.CRON_SECRET = 'cron-secret'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token'

    const { validateSecurityConfig } = await import('@/lib/security/startup-checks')
    const result = validateSecurityConfig()

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('reports missing JWT_SECRET in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.JWT_SECRET
    delete process.env.CRON_SECRET
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'

    const { validateSecurityConfig } = await import('@/lib/security/startup-checks')
    const result = validateSecurityConfig()

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('JWT_SECRET'))).toBe(true)
  })

  it('reports missing CRON_SECRET in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    process.env.JWT_SECRET = 'jwt-secret'
    delete process.env.CRON_SECRET

    const { validateSecurityConfig } = await import('@/lib/security/startup-checks')
    const result = validateSecurityConfig()

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('CRON_SECRET'))).toBe(true)
  })

  it('warns about missing rate limiting', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.JWT_SECRET = 'jwt-secret'
    process.env.CRON_SECRET = 'cron-secret'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN

    const { validateSecurityConfig } = await import('@/lib/security/startup-checks')
    const result = validateSecurityConfig()

    expect(result.warnings.some(w => w.includes('Rate limiting'))).toBe(true)
  })
})
