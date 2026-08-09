import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomBytes } from 'crypto'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { readJsonBody, BoundedBodyError } from '@/lib/security/bounded-body'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'
import { requireValidOrigin } from '@/lib/security/origin-check'
import { postExists, type PostSource } from '@/lib/comments/service'

/**
 * Take-Barometer: „Sehe ich auch so" / „Sehe ich anders" unter jedem Take.
 *
 * BEWUSST OHNE IDENTITÄT (Design 2026-08-09): ein Klick, anonym. Dieses Signal
 * wandert nie ins Schema-Markup — weiche Dedup über einen Cookie genügt, und
 * genau deshalb darf die Hürde bei null liegen. Wer den Cookie löscht, kann
 * erneut voten; das verzerrt Prozentwerte im Rahmen dessen, was ein UI-Signal
 * verträgt, und keinen SEO-Wert, weil es keinen trägt.
 *
 * Umstimmen ist erlaubt: der Upsert überschreibt das alte Votum desselben
 * Voters statt zu addieren.
 */
const MAX_BODY_BYTES = 4 * 1024
const VOTER_COOKIE = 'synthszr_tb'
const VOTER_COOKIE_TTL = 365 * 24 * 60 * 60

const limiter = rateLimiters.relaxed()

const voteSchema = z.object({
  postSource: z.enum(['posts', 'generated_posts']),
  postId: z.string().uuid(),
  sectionAnchor: z.string().min(1).max(200),
  vote: z.enum(['agree', 'disagree']),
}).strict()

function voterHash(voterId: string): string {
  return createHash('sha256').update(voterId).digest('hex')
}

export async function POST(request: NextRequest) {
  const originError = requireValidOrigin(request)
  if (originError) return originError

  const ip = getClientIP(request)
  const rateLimit = await checkRateLimit(`take-feedback:${ip}`, limiter ?? undefined)
  if (!rateLimit.success) return rateLimitResponse(rateLimit)

  let rawBody: unknown
  try {
    rawBody = await readJsonBody(request, MAX_BODY_BYTES)
  } catch (err) {
    if (err instanceof BoundedBodyError && err.code === 'BODY_TOO_LARGE') {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = voteSchema.safeParse(rawBody)
  if (!parsed.success) return NextResponse.json({ error: 'Ungültige Eingabe' }, { status: 400 })
  const { postSource, postId, sectionAnchor, vote } = parsed.data

  const supabase = createAdminClient()
  if (!(await postExists(supabase, postSource as PostSource, postId))) {
    return NextResponse.json({ error: 'Artikel nicht gefunden' }, { status: 404 })
  }

  // Voter-ID aus dem Cookie — oder frisch würfeln. Zufalls-ID statt
  // sha256(IP+UA) wie in analytics: der Analytics-Hash kollidiert hinter NAT
  // und würde ganzen Büros das Voten nach dem ersten Kollegen sperren.
  let voterId = request.cookies.get(VOTER_COOKIE)?.value ?? ''
  const isNewVoter = !/^[A-Za-z0-9_-]{16,64}$/.test(voterId)
  if (isNewVoter) voterId = randomBytes(24).toString('base64url')

  const { error } = await supabase.from('take_feedback').upsert({
    post_source: postSource,
    post_id: postId,
    section_anchor: sectionAnchor,
    vote,
    voter_hash: voterHash(voterId),
  }, { onConflict: 'post_source,post_id,section_anchor,voter_hash' })
  if (error) {
    console.error('[TakeFeedback] Upsert fehlgeschlagen:', error.message)
    return NextResponse.json({ error: 'Nicht gespeichert' }, { status: 500 })
  }

  // Frische Aggregate direkt mitliefern — erspart dem Client den zweiten Request.
  const counts = await aggregate(supabase, postSource, postId, sectionAnchor)
  const res = NextResponse.json({ ok: true, ...counts })
  if (isNewVoter) {
    res.cookies.set(VOTER_COOKIE, voterId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: VOTER_COOKIE_TTL,
      path: '/',
    })
  }
  return res
}

async function aggregate(
  supabase: ReturnType<typeof createAdminClient>,
  postSource: string,
  postId: string,
  sectionAnchor?: string,
) {
  let query = supabase
    .from('take_feedback')
    .select('section_anchor, vote')
    .eq('post_source', postSource)
    .eq('post_id', postId)
  if (sectionAnchor) query = query.eq('section_anchor', sectionAnchor)
  // Ohne range() kappt PostgREST bei 1000 Zeilen — für ein UI-Prozent
  // verkraftbar, für die Doku trotzdem notiert: ab 1000 Voten je Take wird der
  // Balken zur Stichprobe.
  const { data } = await query.limit(1000)
  const bySection = new Map<string, { agree: number; disagree: number }>()
  for (const r of (data ?? []) as Array<{ section_anchor: string; vote: string }>) {
    const entry = bySection.get(r.section_anchor) ?? { agree: 0, disagree: 0 }
    if (r.vote === 'agree') entry.agree++
    else entry.disagree++
    bySection.set(r.section_anchor, entry)
  }
  if (sectionAnchor) {
    const s = bySection.get(sectionAnchor) ?? { agree: 0, disagree: 0 }
    return { agree: s.agree, disagree: s.disagree }
  }
  return { sections: Object.fromEntries(bySection) }
}

/** Aggregate aller Takes eines Posts — das Barometer lädt sie nach der
 *  Hydration in einem Rutsch. */
export async function GET(request: NextRequest) {
  // Rate-Limit trotz CDN-Cache: ein Cache-Buster-Query umginge den Edge-Cache
  // und träfe die (bis zu 1000 Zeilen aggregierende) DB-Abfrage direkt.
  const ip = getClientIP(request)
  const rl = await checkRateLimit(`take-feedback-get:${ip}`, limiter ?? undefined)
  if (!rl.success) return rateLimitResponse(rl)

  const { searchParams } = new URL(request.url)
  const source = searchParams.get('source')
  const postId = searchParams.get('postId')
  if ((source !== 'posts' && source !== 'generated_posts') || !postId || !z.string().uuid().safeParse(postId).success) {
    return NextResponse.json({ error: 'Ungültige Parameter' }, { status: 400 })
  }
  const counts = await aggregate(createAdminClient(), source, postId)
  return NextResponse.json(counts, {
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' },
  })
}
