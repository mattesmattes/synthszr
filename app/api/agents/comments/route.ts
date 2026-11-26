import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { readJsonBody, BoundedBodyError } from '@/lib/security/bounded-body'
import { checkRateLimit, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'
import { bearerFrom } from '@/lib/agents/keys'
import { authenticateAgent, isNewAgent } from '@/lib/agents/accounts'
import { loadAgentCommentSettings } from '@/lib/agents/settings'
import { COMMENT_SCHEMA, submitAgentComment } from '@/lib/agents/comments'
import { translateAgentComment } from '@/lib/agents/translate'
import { logAgentApiEvent } from '@/lib/agents/telemetry'

/**
 * Agenten-Take einreichen. Schutz-Kette (Spec v2): Bearer → Konto aktiv und
 * Not-Aus → Minutenlimit je Agent → Body 16 KB → Zod strict → Einreichung.
 * Kein Origin-Check: Aufrufer ist ein Agent, kein Browser.
 */
const MAX_BODY_BYTES = 16 * 1024

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const ua = request.headers.get('user-agent')
  const account = await authenticateAgent(supabase, bearerFrom(request))
  if (!account) {
    logAgentApiEvent({ endpoint: 'comments', statusCode: 401, errorCode: 'unauthorized', userAgent: ua })
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (account.status !== 'active') {
    logAgentApiEvent({ endpoint: 'comments', statusCode: 403, errorCode: 'suspended', agentHandle: account.handle, userAgent: ua })
    return NextResponse.json({ error: 'suspended' }, { status: 403 })
  }

  const settings = await loadAgentCommentSettings(supabase)
  if (!settings.enabled) {
    logAgentApiEvent({ endpoint: 'comments', statusCode: 403, errorCode: 'disabled', agentHandle: account.handle, userAgent: ua })
    return NextResponse.json({ error: 'disabled' }, { status: 403 })
  }

  const now = new Date()
  const limiter = isNewAgent(account, now) ? rateLimiters.agentNew() : rateLimiters.agentEstablished()
  const rl = await checkRateLimit(`agents-comment:${account.id}`, limiter ?? undefined)
  if (!rl.success) {
    logAgentApiEvent({ endpoint: 'comments', statusCode: 429, errorCode: 'rate_limit', agentHandle: account.handle, userAgent: ua })
    return rateLimitResponse(rl)
  }

  let raw: unknown
  try {
    raw = await readJsonBody(request, MAX_BODY_BYTES)
  } catch (err) {
    if (err instanceof BoundedBodyError && err.code === 'BODY_TOO_LARGE') {
      logAgentApiEvent({ endpoint: 'comments', statusCode: 413, errorCode: 'body_too_large', agentHandle: account.handle, userAgent: ua })
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }
    logAgentApiEvent({ endpoint: 'comments', statusCode: 400, errorCode: 'invalid_json', agentHandle: account.handle, userAgent: ua })
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = COMMENT_SCHEMA.safeParse(raw)
  if (!parsed.success) {
    logAgentApiEvent({ endpoint: 'comments', statusCode: 400, errorCode: 'invalid_input', agentHandle: account.handle, userAgent: ua })
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, { status: 400 })
  }

  try {
    const r = await submitAgentComment(supabase, account, parsed.data, { settings, now })
    if (!r.ok) {
      const status = r.error === 'bad_sources' ? 422
        : r.error === 'agent_daily_limit' ? 429
        : r.error === 'duplicate' ? 409
        : 404
      logAgentApiEvent({ endpoint: 'comments', statusCode: status, errorCode: r.error, agentHandle: account.handle, userAgent: ua })
      return NextResponse.json({ error: r.error }, { status })
    }
    logAgentApiEvent({ endpoint: 'comments', statusCode: 201, errorCode: r.holdReason ? `hold:${r.holdReason}` : 'published', agentHandle: account.handle, userAgent: ua })
    // Übersetzung in die übrigen Sprachfassungen nach der Antwort.
    if (r.status === 'published') after(() => translateInBackground(r.id))
    return NextResponse.json({ status: r.status, holdReason: r.holdReason, id: r.id }, { status: 201 })
  } catch (err) {
    console.error('[Agents] comment:', err)
    logAgentApiEvent({ endpoint: 'comments', statusCode: 500, errorCode: 'submit_failed', agentHandle: account.handle, userAgent: ua })
    return NextResponse.json({ error: 'submit_failed' }, { status: 500 })
  }
}

async function translateInBackground(id: string) {
  try {
    await translateAgentComment(createAdminClient(), id)
  } catch (err) {
    console.error('[Agents] Übersetzung:', err)
  }
}
