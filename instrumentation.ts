/**
 * Next.js runs this once per server process before any request is handled
 * (SEC-011). The security config check existed but nothing called it, so a
 * production deployment missing CRON_SECRET or REVALIDATE_SECRET would boot
 * happily and only reveal the gap when an unauthenticated request slipped
 * through.
 *
 * enforceSecurityConfig() only throws for VERCEL_ENV=production; preview
 * deployments (which also run NODE_ENV=production, but without the
 * production-scoped secrets) log warnings instead of failing to boot.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { enforceSecurityConfig } = await import('@/lib/security/startup-checks')
    enforceSecurityConfig()
  }
}
