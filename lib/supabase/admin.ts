import { createClient } from '@supabase/supabase-js'

/**
 * Create a Supabase client with Service Role Key for admin operations.
 *
 * USE CASES:
 * - Cron jobs and scheduled tasks (no user session)
 * - Background processing (newsletter fetch, synthesis)
 * - Admin operations that bypass RLS
 *
 * WARNING: This client bypasses Row Level Security (RLS).
 * Only use in server-side code where you control the queries.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

/**
 * Create a Supabase client with Anon Key for public read operations.
 *
 * USE CASES:
 * - Public API endpoints (stock quotes, cached data)
 * - Read-only operations that should respect RLS
 *
 * This client respects Row Level Security (RLS) policies.
 */
export function createAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  }

  if (!anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set')
  }

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
