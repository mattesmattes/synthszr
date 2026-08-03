import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { refreshGlossaryNews } from '@/lib/glossary/news'

// Für den Fall, dass die Begriffsliste einmal groß genug wird, dass ein Lauf
// wirklich das gesamte Zeitbudget braucht (siehe lib/glossary/news.ts).
export const maxDuration = 300

/**
 * GET /api/cron/glossary-news — wöchentlicher News-Refresh fürs
 * Fachbegriff-Lexikon (Design-Spec §F, vercel.json: montags 04:00 UTC).
 *
 * Ruft match_glossary_news pro veröffentlichtem Begriff auf und schreibt die
 * Treffer nach glossary_term_news. Gibt IMMER 200 zurück (außer bei fehlender
 * Auth): eine noch nicht angewendete Migration oder ein einzelner
 * Begriffsfehler darf den Cron nie als Vercel-Fehler erscheinen lassen — der
 * News-Block bleibt in diesem Fall einfach leer, wie jede andere
 * Lexikon-Anreicherung in diesem Feature auch (Tasks 1–13).
 */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const result = await refreshGlossaryNews(createAdminClient())
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    console.error('[cron/glossary-news]', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    )
  }
}
