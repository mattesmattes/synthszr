import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { verifyBearerToken } from '@/lib/security/cron-auth'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'

/**
 * Leert den Rankings-Cache (Tag 'rankings') nach Daten-Änderungen (Konsolidierung,
 * Merges, Research) — ohne Deploy/Key-Bump und ohne die 600s-Revalidate abzuwarten.
 * NICHT unter /api/admin (Middleware-Auth würde den Secret-Check blocken).
 *
 * Auth: `Authorization: Bearer $REVALIDATE_SECRET`, timing-safe geprüft (SEC-014).
 * Vorher war das Secret die letzten 16 Zeichen von SUPABASE_SERVICE_ROLE_KEY,
 * übergeben als Query-Parameter — ein Credential, das in jedem Access-Log und
 * Referrer landet und obendrein ein Teilstück des mächtigsten Secrets im System
 * war. Beides ist jetzt ausgeschlossen: eigenes Secret, ausschließlich im Header.
 */
const strictLimiter = rateLimiters.strict()

export async function POST(request: NextRequest) {
  const rateLimit = await checkRateLimit(
    `revalidate-rankings:${getClientIP(request)}`,
    strictLimiter ?? undefined
  )
  if (!rateLimit.success) {
    return rateLimitResponse(rateLimit)
  }

  if (!verifyBearerToken(request.headers.get('authorization'), process.env.REVALIDATE_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  revalidateTag('rankings', 'max')
  return NextResponse.json({ revalidated: true })
}
