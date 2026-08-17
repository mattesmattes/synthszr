/**
 * Lexikon-Stand eines Artikels für die Preflight-Anzeige vor dem Newsletter.
 *
 * Beantwortet drei Fragen in einem Aufruf: sind alle im Artikel erkannten
 * Begriffe erzeugt, haben sie Illustrationen, und sind sie im Text verlinkt?
 *
 * Nötig, weil die Erzeugung nach dem Speichern asynchron im Hintergrund läuft —
 * rund eine Minute je Begriff. Ohne Zahlen ist von außen nicht erkennbar, ob sie
 * arbeitet oder stillsteht.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { computeGlossaryPostStatus } from '@/lib/glossary/post-status'
import { safeParseJSON } from '@/lib/utils/safe-json'
import type { GlossaryCandidate } from '@/lib/glossary/types'

/** Sammelt alle Slugs, die im Artikeltext eine glossaryLink-Mark tragen. */
function collectLinkedSlugs(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (!node || typeof node !== 'object') return out
  const o = node as Record<string, unknown>
  for (const m of (Array.isArray(o.marks) ? o.marks : [])) {
    const mark = m as { type?: string; attrs?: { slug?: string } }
    if (mark.type === 'glossaryLink' && mark.attrs?.slug) out.add(mark.attrs.slug)
  }
  if (Array.isArray(o.content)) for (const c of o.content) collectLinkedSlugs(c, out)
  return out
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const postId = request.nextUrl.searchParams.get('postId')
  if (!postId) return NextResponse.json({ error: 'postId fehlt' }, { status: 400 })

  const supabase = createAdminClient()
  const { data: post, error } = await supabase
    .from('generated_posts')
    .select('content, pending_glossary_terms')
    .eq('id', postId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!post) return NextResponse.json({ error: 'Post nicht gefunden' }, { status: 404 })

  const row = post as { content?: unknown; pending_glossary_terms?: unknown }
  const content = typeof row.content === 'string' ? safeParseJSON(row.content) : row.content
  const linkedSlugs = [...collectLinkedSlugs(content)]

  // ERKANNT = Kandidatenliste PLUS bereits verlinkte Begriffe. Beides nötig: nach
  // erfolgreicher Freigabe wird pending_glossary_terms geleert, die Kandidaten
  // allein würden dann 0 melden, obwohl der Artikel verlinkt ist.
  const candidates = Array.isArray(row.pending_glossary_terms)
    ? (row.pending_glossary_terms as GlossaryCandidate[])
    : []
  const detectedSlugs = [...new Set([...candidates.map((c) => c.slug), ...linkedSlugs])]

  if (detectedSlugs.length === 0) {
    return NextResponse.json(computeGlossaryPostStatus({
      detectedSlugs: [], publishedSlugs: [], withImageSlugs: [], linkedSlugs: [],
    }))
  }

  const { data: terms } = await supabase
    .from('glossary_terms')
    .select('slug, status, illustration_url')
    .in('slug', detectedSlugs)

  // Läuft für DIESEN Artikel gerade ein Lauf? Ohne diese Angabe meldete die
  // Anzeige bei fehlenden Begriffen immer „Rest läuft im Hintergrund" — auch
  // wenn gar kein Job existierte (Befund 2026-08-17: 14 offen, 0 Jobs,
  // Spinner drehte). `kind` wird nicht eingegrenzt: jeder laufende Lexikon-Job
  // dieses Artikels kann die Zahl bewegen.
  const { data: jobs } = await supabase
    .from('glossary_jobs')
    .select('params')
    .in('status', ['queued', 'processing'])
  const runActive = (jobs ?? []).some(
    (j) => (j as { params?: unknown }).params &&
      JSON.stringify((j as { params?: unknown }).params).includes(postId),
  )

  const rows = (terms ?? []) as Array<{ slug: string; status: string; illustration_url: string | null }>
  return NextResponse.json(computeGlossaryPostStatus({
    detectedSlugs,
    publishedSlugs: rows.filter((t) => t.status === 'published').map((t) => t.slug),
    withImageSlugs: rows.filter((t) => t.illustration_url).map((t) => t.slug),
    linkedSlugs,
    runActive,
  }))
}
