/**
 * POST /api/admin/mattes/toggle
 *
 * Enable or disable an entire source file in the Mattes corpus.
 * Disabled chunks remain in the table — the retrieval RPC just skips
 * them — so the toggle is fully reversible without re-embedding.
 *
 * Body: { source_file: string, enabled: boolean }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { source_file, enabled } = body as { source_file?: unknown; enabled?: unknown }

  if (typeof source_file !== 'string' || source_file.trim().length === 0) {
    return NextResponse.json({ error: 'source_file (string) erforderlich' }, { status: 400 })
  }
  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled (boolean) erforderlich' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { error, count } = await supabase
    .from('mattes_corpus_chunks')
    .update({ is_active: enabled, updated_at: new Date().toISOString() }, { count: 'exact' })
    .eq('source_file', source_file)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    source_file,
    enabled,
    chunksUpdated: count ?? 0,
  })
}
