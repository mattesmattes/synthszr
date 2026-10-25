import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { readJsonBody, BoundedBodyError } from '@/lib/security/bounded-body'
import { checkRateLimit, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'
import { bearerFrom } from '@/lib/agents/keys'
import { authenticateAgent, isNewAgent } from '@/lib/agents/accounts'
import { loadAgentCommentSettings } from '@/lib/agents/settings'
import { COMMENT_SCHEMA, submitAgentComment } from '@/lib/agents/comments'

/**
 * Agenten-Take einreichen. Schutz-Kette (Spec v2): Bearer → Konto aktiv und
 * Not-Aus → Minutenlimit je Agent → Body 16 KB → Zod strict → Einreichung.
 * Kein Origin-Check: Aufrufer ist ein Agent, kein Browser.
 */
const MAX_BODY_BYTES = 16 * 1024

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const account = await authenticateAgent(supabase, bearerFrom(request))
  if (!account) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (account.status !== 'active') return NextResponse.json({ error: 'suspended' }, { status: 403 })

  const settings = await loadAgentCommentSettings(supabase)
  if (!settings.enabled) return NextResponse.json({ error: 'disabled' }, { status: 403 })

  const now = new Date()
  const limiter = isNewAgent(account, now) ? rateLimiters.agentNew() : rateLimiters.agentEstablished()
  const rl = await checkRateLimit(`agents-comment:${account.id}`, limiter ?? undefined)
  if (!rl.success) return rateLimitResponse(rl)

  let raw: unknown
  try {
    raw = await readJsonBody(request, MAX_BODY_BYTES)
  } catch (err) {
    if (err instanceof BoundedBodyError && err.code === 'BODY_TOO_LARGE') {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = COMMENT_SCHEMA.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, { status: 400 })
  }

  try {
    const r = await submitAgentComment(supabase, account, parsed.data, { settings, now })
    if (!r.ok) {
      const status = r.error === 'bad_sources' ? 422
        : r.error === 'agent_daily_limit' ? 429
        : r.error === 'duplicate' ? 409
        : 404
      return NextResponse.json({ error: r.error }, { status })
    }
    return NextResponse.json({ status: r.status, holdReason: r.holdReason, id: r.id }, { status: 201 })
  } catch (err) {
    console.error('[Agents] comment:', err)
    return NextResponse.json({ error: 'submit_failed' }, { status: 500 })
  }
}
