/**
 * Security Startup Checks
 *
 * Validates required security configuration at application startup.
 * Throws an error in production if critical security settings are missing.
 *
 * Enforcement is keyed on VERCEL_ENV, not NODE_ENV: Vercel builds and runs
 * preview deployments with NODE_ENV=production, but production-only secrets
 * (CRON_SECRET, ADMIN_PASSWORD, ...) are scoped to the production
 * environment. Keying on NODE_ENV would make instrumentation.ts throw on
 * every preview boot and take the deployment down.
 */

export interface SecurityCheckResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

type DeploymentEnv = 'production' | 'preview' | 'development'

function deploymentEnv(): DeploymentEnv {
  const vercelEnv = process.env.VERCEL_ENV
  if (vercelEnv === 'production' || vercelEnv === 'preview' || vercelEnv === 'development') {
    return vercelEnv
  }
  // Self-hosted / local `next start`: fall back to the Node signal.
  return process.env.NODE_ENV === 'production' ? 'production' : 'development'
}

/**
 * Secrets without which production is either unauthenticated or broken.
 * Kept in sync with what the code actually reads - a name listed here that
 * nothing consumes turns startup into a false alarm, and a consumed secret
 * missing from here fails silently at request time instead.
 */
const REQUIRED_PRODUCTION_SECRETS = [
  ['JWT_SECRET', 'admin session cookies could not be verified'],
  ['CRON_SECRET', 'cron endpoints would be unprotected'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'admin operations would fail'],
  ['ADMIN_PASSWORD', 'password login would be unusable'],
  ['REVALIDATE_SECRET', 'the rankings cache endpoint would be unprotected'],
] as const

type PairState = 'complete' | 'partial' | 'missing'

function pairState(url: string | undefined, token: string | undefined): PairState {
  if (url && token) return 'complete'
  if (url || token) return 'partial'
  return 'missing'
}

/**
 * Validate security configuration
 * Call this during app initialization to catch misconfigurations early
 */
export function validateSecurityConfig(): SecurityCheckResult {
  const errors: string[] = []
  const warnings: string[] = []
  const isProduction = deploymentEnv() === 'production'

  for (const [name, consequence] of REQUIRED_PRODUCTION_SECRETS) {
    if (process.env[name]) continue
    if (isProduction) {
      errors.push(`${name} is required in production - ${consequence}`)
    } else {
      warnings.push(`${name} not set - required in production (${consequence})`)
    }
  }

  // Rate limiting. lib/rate-limit.ts accepts either credential pair
  // (KV_REST_API_* takes precedence, UPSTASH_REDIS_REST_* is the fallback),
  // so checking only one of them reports a healthy deployment as broken.
  const kv = pairState(process.env.KV_REST_API_URL, process.env.KV_REST_API_TOKEN)
  const upstash = pairState(process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN)

  if (kv === 'partial' || upstash === 'partial') {
    errors.push(
      'Rate limit credentials are half-configured - both URL and TOKEN of a pair must be set ' +
      '(KV_REST_API_URL/KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN)'
    )
  } else if (kv !== 'complete' && upstash !== 'complete') {
    const message =
      'Rate limit backend is not configured - every rate-limited route fails closed to HTTP 429'
    if (isProduction) errors.push(message)
    else warnings.push(message)
  }

  // Medium: Admin Emails for OAuth
  if (process.env.GOOGLE_CLIENT_ID && !process.env.ADMIN_EMAILS) {
    warnings.push('ADMIN_EMAILS not set - Google OAuth login will fail')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Run security checks and throw on critical errors in production
 */
export function enforceSecurityConfig(): void {
  const result = validateSecurityConfig()

  for (const warning of result.warnings) {
    console.warn(`[Security] WARNING: ${warning}`)
  }

  if (result.valid) return

  const errorMessage = `Security configuration errors:\n${result.errors.map(e => `  - ${e}`).join('\n')}`

  if (deploymentEnv() === 'production') {
    console.error(`[Security] CRITICAL: ${errorMessage}`)
    throw new Error(errorMessage)
  }

  for (const error of result.errors) {
    console.warn(`[Security] DEV ERROR (would fail in prod): ${error}`)
  }
}
