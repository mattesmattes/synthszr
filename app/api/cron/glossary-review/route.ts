import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { reviewGlossaryTerms } from '@/lib/glossary/review'

// Ein LLM-Call pro Begriff, Batch von 10 (siehe lib/glossary/review.ts) —
// bleibt deutlich unter dem 300s-Vercel-Cap, aber gleiches Sicherheitsnetz wie
// beim News-Cron, falls einzelne Calls ungewöhnlich lange brauchen.
export const maxDuration = 300

/**
 * GET /api/cron/glossary-review — tägliche Aktualitätsprüfung fürs
 * Fachbegriff-Lexikon (Design-Spec §I, vercel.json: 05:00 UTC).
 *
 * Prüft pro Lauf die 10 am längsten nicht geprüften veröffentlichten
 * Begriffe gegen ihre aktuellen News und schreibt das Ergebnis
 * (review_state='ok' oder eine Revision nach pending_body). Gibt IMMER 200
 * zurück (außer bei fehlender Auth): ein einzelner Begriffsfehler darf den
 * Cron nie als Vercel-Fehler erscheinen lassen (Muster aus
 * app/api/cron/glossary-news/route.ts).
 */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const result = await reviewGlossaryTerms(createAdminClient())
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    console.error('[cron/glossary-review]', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    )
  }
}
