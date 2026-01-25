/**
 * Security Startup Checks
 *
 * Validates required security configuration at application startup.
 * Throws an error in production if critical security settings are missing.
 */

export interface SecurityCheckResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validate security configuration
 * Call this during app initialization to catch misconfigurations early
 */
export function validateSecurityConfig(): SecurityCheckResult {
  const errors: string[] = []
  const warnings: string[] = []
  const isProduction = process.env.NODE_ENV === 'production'

  // Critical: JWT Secret
  if (!process.env.JWT_SECRET) {
    if (isProduction) {
      errors.push('JWT_SECRET is required in production')
    } else {
      warnings.push('JWT_SECRET not set - using fallback (dev only)')
    }
  }

  // Critical: Cron Secret
  if (!process.env.CRON_SECRET) {
    if (isProduction) {
      errors.push('CRON_SECRET is required in production - cron endpoints would be unprotected')
    } else {
      warnings.push('CRON_SECRET not set - cron endpoints use dev bypass')
    }
  }

  // High: Rate Limiting
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    if (isProduction) {
      warnings.push('Rate limiting disabled - UPSTASH_REDIS credentials not configured')
    }
  }

  // High: Supabase Service Role
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    errors.push('SUPABASE_SERVICE_ROLE_KEY is required for admin operations')
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

  // Log warnings
  for (const warning of result.warnings) {
    console.warn(`[Security] WARNING: ${warning}`)
  }

  // In production, throw on errors
  if (!result.valid && process.env.NODE_ENV === 'production') {
    const errorMessage = `Security configuration errors:\n${result.errors.map(e => `  - ${e}`).join('\n')}`
    console.error(`[Security] CRITICAL: ${errorMessage}`)
    throw new Error(errorMessage)
  }

  // In development, log errors as warnings
  if (!result.valid) {
    for (const error of result.errors) {
      console.warn(`[Security] DEV ERROR (would fail in prod): ${error}`)
    }
  }
}
