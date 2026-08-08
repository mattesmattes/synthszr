import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

type Period = '7d' | '30d' | '90d' | '1y'

const LOOKBACK_MS: Record<Period, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
}

/** Wie viele Begriffe die Liste zeigt (Betreiber-Vorgabe 2026-08-08). */
const TOP_N = 40

/**
 * Zieht den Begriffs-Slug aus einem Page-View-Pfad — oder `null`, wenn der Pfad
 * keine Begriffsseite ist.
 *
 * SPRACHUNABHAENGIG, und das ist der Kern: derselbe Begriff wird unter /de, /en
 * und /fr aufgerufen (in Prod alle drei belegt). Wuerde man nach PFAD statt nach
 * Slug gruppieren, stuende ein Begriff dreimal in der Liste, jeder Eintrag mit
 * einem Bruchteil seiner echten Zahl — eine Top-40 waere dann keine.
 *
 * Die Uebersichtsseite (/de/glossary) liefert `null`: sie ist kein Begriff und
 * wuerde die Rangliste mit ihrem Sammelverkehr anfuehren. Sie steckt bereits in
 * der Gesamtzahl auf der Statistik-Seite.
 *
 * `/admin/` ist ausgenommen, gleiche Begruendung wie bei isGlossaryPath in
 * app/api/admin/analytics/stats/route.ts: /admin/glossary ist das
 * Redaktionswerkzeug, keine Leser-Nutzung.
 */
export function glossarySlugFromPath(path: string | null | undefined): string | null {
  if (!path || path.startsWith('/admin/')) return null
  // Query und Fragment abschneiden: /de/glossary/token?utm_source=nl und
  // /de/glossary/token#definition sind derselbe Begriff. Newsletter-Links
  // tragen regelmaessig utm-Parameter.
  const clean = path.split(/[?#]/)[0]
  const m = clean.match(/\/glossary\/([^/]+)\/?$/)
  return m ? m[1] : null
}

/**
 * Meistgelesene Lexikonbegriffe im gewaehlten Zeitraum.
 *
 * Eigene Route statt einer Erweiterung von /api/admin/analytics/stats: die Liste
 * wird nur beim Oeffnen des Layers gebraucht. Im Aggregat-Endpunkt haette sie
 * jeden Aufruf der Statistik-Seite verteuert, obwohl sie meistens niemand
 * ansieht.
 */
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const period = (searchParams.get('period') || '30d') as Period
  if (!Object.keys(LOOKBACK_MS).includes(period)) {
    return NextResponse.json({ error: 'Invalid period' }, { status: 400 })
  }

  try {
    const supabase = createAdminClient()
    const since = new Date(Date.now() - LOOKBACK_MS[period]).toISOString()

    // DB-seitig auf Lexikon-Pfade vorfiltern statt alle Page-Views zu holen und
    // hier zu sieben: an Prod gemessen sind das 1.760 statt 19.974 Zeilen (30
    // Tage). Egress ist in diesem Projekt eine reale Groesse, und `path` ist die
    // einzige Spalte, die wir brauchen.
    //
    // PAGINIERT, weil PostgREST eine Antwort ohne range() still bei 1000 Zeilen
    // kappt — ohne Fehler und ohne Log. Bei 1.760 Zeilen greift das bereits.
    const PAGE = 1000
    const paths: string[] = []
    for (let off = 0; ; off += PAGE) {
      const { data, error } = await supabase
        .from('analytics_events')
        .select('path')
        .eq('event_type', 'page_view')
        .gte('created_at', since)
        .ilike('path', '%/glossary/%')
        .range(off, off + PAGE - 1)
      if (error) throw new Error(error.message)
      if (!data?.length) break
      paths.push(...(data as Array<{ path: string | null }>).map((r) => r.path ?? ''))
      if (data.length < PAGE) break
    }

    const counts = new Map<string, number>()
    for (const p of paths) {
      const slug = glossarySlugFromPath(p)
      if (!slug) continue
      counts.set(slug, (counts.get(slug) ?? 0) + 1)
    }

    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)

    // Anzeigenamen nachschlagen. `.in()` mit hoechstens TOP_N Slugs ist
    // unbedenklich — der Filter landet als Query-String in der URL, und die
    // Grenze liegt bei rund 400 IDs (s. TRANSLATION_CHUNK in
    // lib/glossary/terms.ts). Bei 40 kurzen Slugs sind es wenige hundert Zeichen.
    const nameBySlug = new Map<string, string>()
    if (top.length > 0) {
      const { data: terms, error: termErr } = await supabase
        .from('glossary_terms')
        .select('slug, canonical_name')
        .in('slug', top.map(([slug]) => slug))
      if (termErr) {
        // Nicht fatal: ohne Namen zeigt der Layer den Slug, und der ist lesbar.
        console.error('[GlossaryTop] Begriffsnamen nicht ladbar:', termErr.message)
      }
      for (const t of (terms ?? []) as Array<{ slug: string; canonical_name: string }>) {
        nameBySlug.set(t.slug, t.canonical_name)
      }
    }

    return NextResponse.json({
      period,
      // Summe ueber ALLE Begriffsseiten, nicht nur die Top-40 — sonst waere der
      // Anteil, den die Liste abdeckt, nicht erkennbar.
      total: [...counts.values()].reduce((a, b) => a + b, 0),
      distinctTerms: counts.size,
      terms: top.map(([slug, views]) => ({
        slug,
        // Ein Slug ohne Begriff kommt vor: geloeschte oder umbenannte Seiten
        // stehen weiter in den Analytics-Daten. Der Slug ist dann die ehrlichste
        // Anzeige.
        name: nameBySlug.get(slug) ?? slug,
        views,
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unbekannt'
    console.error('[GlossaryTop] Abfrage fehlgeschlagen:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
