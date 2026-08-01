/**
 * Daily Digests API — Security-Stufe 2 (Welle 1b)
 *
 * Serverseitige, authentifizierte CRUD für daily_digests — ersetzt den
 * direkten Browser-anon-Zugriff aus app/admin/digests/page.tsx.
 *
 * GET: Die letzten 20 Digests (neueste zuerst)
 * POST: Neuen Digest anlegen ({ digestDate, analysisContent, wordCount, sourcesUsed })
 * DELETE: Digest per id löschen ({ id })
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseIntParam } from '@/lib/validation/query-params'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const supabase = createAdminClient()

  // Security-Stufe 2 (Welle 1c): Einzel-Digest per id (+ optionalem select) für
  // app/admin/generated-articles/edit/[id]/page.tsx (ersetzt direkten Browser-Query
  // `.select('analysis_content').eq('id', digestId).single()`).
  const id = searchParams.get('id')
  if (id) {
    const select = searchParams.get('select')
    const { data, error } = await supabase
      .from('daily_digests')
      .select(select || '*')
      .eq('id', id)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  // Security-Stufe 2 (Welle 1c): optionaler ?limit= für
  // app/admin/create-article/page.tsx (bisher `.limit(5)` im Browser-Query).
  // Default bleibt 20 — unverändert für app/admin/digests/page.tsx.
  const limit = parseIntParam(searchParams.get('limit'), 20, 1, 100)

  const { data, error } = await supabase
    .from('daily_digests')
    .select('*')
    .order('digest_date', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ digests: data ?? [] })
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { digestDate, analysisContent, wordCount, sourcesUsed } = await request.json()
  if (!digestDate || !analysisContent) {
    return NextResponse.json({ error: 'digestDate und analysisContent erforderlich' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('daily_digests')
    .insert({
      digest_date: digestDate,
      analysis_content: analysisContent,
      word_count: wordCount,
      sources_used: sourcesUsed,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'id erforderlich' }, { status: 400 })

  const supabase = createAdminClient()
  const { error } = await supabase.from('daily_digests').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
