/**
 * Erzwingt eine ISR-Neugenerierung ALLER Glossar-Detailseiten.
 *
 * Wurde gebraucht, weil der Korn-Animation-Rollout (30.08.2026) die
 * animation_params für 2.904 Begriffe per direktem PostgREST-Bulk-PATCH
 * schrieb — am Next.js-Layer vorbei. Der ETABLIERTE Weg für Content-Änderungen
 * ist revalidateGlossaryDetail() in glossary/route.ts (nach publish/hide/
 * delete/translate), der lief hier nie, weil kein Request die App durchlief.
 *
 * Folge: Seiten, die vor dem Bulk-Write schon im ISR-Cache lagen (revalidate=
 * 21600, s. app/[lang]/glossary/[slug]/page.tsx), lieferten bis zu 6h weiter
 * die alte Fassung — SICHTBAR NUR BEI EINEM RELOAD, weil ein Reload den
 * Next.js Client-Router-Cache verwirft (der bei SPA-Navigation eine bereits
 * geladene, evtl. noch aeltere Fassung wiederverwenden kann), waehrend der
 * server-seitige ISR-Cache selbst durch Reloads NICHT umgangen wird, solange
 * er noch innerhalb des Fensters "frisch" ist.
 *
 * Bearer-Auth wie die Cron-Routen (lib/security/cron-auth.ts) — kein
 * Session-Cookie noetig, per curl aufrufbar. Bleibt als Werkzeug fuer
 * zukuenftige Bulk-Datenaenderungen am Lexikon stehen, die denselben Layer
 * umgehen.
 */
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { verifyBearerToken } from '@/lib/security/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const maxDuration = 300

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!verifyBearerToken(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const supabase = createAdminClient()

  // PostgREST kappt ohne range() still bei 1.000 Zeilen (s. reference_postgrest_grenzen
  // in der Projekt-Memory — traf hier beim ersten Aufruf: 1000 von 2904 statt aller).
  // Seitenweise abholen, bis eine Seite leer zurueckkommt.
  const SEITE = 1000
  const slugs: string[] = []
  for (let off = 0; ; off += SEITE) {
    const { data, error } = await supabase
      .from('glossary_terms')
      .select('slug')
      .not('illustration_url', 'is', null)
      .range(off, off + SEITE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) break
    slugs.push(...data.map((r) => r.slug as string))
    if (data.length < SEITE) break
  }
  for (const slug of slugs) {
    revalidatePath(`/de/glossary/${slug}`)
    revalidatePath(`/en/glossary/${slug}`)
  }
  revalidatePath('/de/glossary')
  revalidatePath('/en/glossary')

  return NextResponse.json({ revalidated: slugs.length })
}
