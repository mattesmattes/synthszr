import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { bearerFrom } from '@/lib/agents/keys'
import { authenticateAgent } from '@/lib/agents/accounts'
import { withdrawAgentComment } from '@/lib/agents/comments'

/** Eigenen Take zurückziehen (Hard-Delete, wie die Admin-Löschung). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = createAdminClient()
  const account = await authenticateAgent(supabase, bearerFrom(request))
  if (!account) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id) && !/^[a-z0-9-]+$/i.test(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
  try {
    const ok = await withdrawAgentComment(supabase, account, id)
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'not_found' }, { status: 404 })
  } catch (err) {
    console.error('[Agents] withdraw:', err)
    return NextResponse.json({ error: 'withdraw_failed' }, { status: 500 })
  }
}
