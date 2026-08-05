import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  createOrGetJob, getJobStatus, requestCancel, type GlossaryJobKind,
} from '@/lib/glossary/jobs/service'

export const maxDuration = 60

const KINDS: GlossaryJobKind[] = ['generate', 'images', 'relink', 'pending']

function parseKind(value: unknown): GlossaryJobKind | null {
  return KINDS.includes(value as GlossaryJobKind) ? (value as GlossaryJobKind) : null
}

/** Legt einen Lauf an — oder liefert den bereits offenen derselben Art. */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const kind = parseKind(body?.kind)
  if (!kind) return NextResponse.json({ error: 'Unbekannte Lauf-Art' }, { status: 400 })

  // `from` kommt aus dem Panel als Tagesdatum und ist die UNTERE Grenze
  // ("verlinke Artikel AB diesem Tag"), nicht die obere.
  let params: Record<string, unknown> = {}
  if (kind === 'relink' && body?.from) {
    params = { since: `${body.from}T00:00:00.000Z` }
  } else if (kind === 'pending') {
    // Anders als die uebrigen Arten ist 'pending' artikelbezogen — ohne
    // postId/confirmedSlugs koennte advanceJob spaeter nichts verarbeiten
    // (s. runUnit-Zweig in advance.ts, der ohne postId hart wirft).
    const postId = typeof body?.postId === 'string' ? body.postId : null
    const confirmedSlugs = Array.isArray(body?.confirmedSlugs) ? body.confirmedSlugs : null
    if (!postId) return NextResponse.json({ error: 'postId fehlt' }, { status: 400 })
    if (!confirmedSlugs || confirmedSlugs.length === 0) {
      return NextResponse.json({ error: 'confirmedSlugs fehlt' }, { status: 400 })
    }
    params = { postId, confirmedSlugs }
  }

  try {
    const job = await createOrGetJob(createAdminClient(), kind, params)
    return NextResponse.json({ job })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Job nicht anlegbar' },
      { status: 500 },
    )
  }
}

/** Lesepfad fuer das Polling im Panel. */
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  // new URL(request.url) statt request.nextUrl: Tests reichen ein einfaches
  // Request-Objekt ohne nextUrl durch (Muster wie app/api/admin/glossary/route.ts).
  const { searchParams } = new URL(request.url)
  const kind = parseKind(searchParams.get('kind'))
  if (!kind) return NextResponse.json({ error: 'Unbekannte Lauf-Art' }, { status: 400 })

  const job = await getJobStatus(createAdminClient(), kind)
  return NextResponse.json({ job })
}

/** Abbruchwunsch; der naechste Cron-Tick wertet ihn aus. */
export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const kind = parseKind(body?.kind)
  if (!kind) return NextResponse.json({ error: 'Unbekannte Lauf-Art' }, { status: 400 })

  await requestCancel(createAdminClient(), kind)
  return NextResponse.json({ ok: true })
}
