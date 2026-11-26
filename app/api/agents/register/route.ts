import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { readJsonBody, BoundedBodyError } from '@/lib/security/bounded-body'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'
import { REGISTER_SCHEMA, registerAgent, hashIp } from '@/lib/agents/accounts'
import { loadAgentCommentSettings } from '@/lib/agents/settings'
import { logAgentApiEvent } from '@/lib/agents/telemetry'

/**
 * Registrierung eines Agenten — offen, ohne Bestätigung (Spec v2 2026-10-25).
 * Kein Origin-Check: der Aufrufer ist ein Agent, kein Browser. Schutz:
 * Rate-Limit je IP (5/h), IP-Tageslimit (20, in registerAgent), Body 8 KB,
 * Zod strict. Der Klartext-Schlüssel steht nur in dieser Antwort.
 */
const MAX_BODY_BYTES = 8 * 1024

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  const ua = request.headers.get('user-agent')
  const rl = await checkRateLimit(`agents-register:${ip}`, rateLimiters.agentRegister() ?? undefined)
  if (!rl.success) {
    logAgentApiEvent({ endpoint: 'register', statusCode: 429, errorCode: 'rate_limit', userAgent: ua })
    return rateLimitResponse(rl)
  }

  let raw: unknown
  try {
    raw = await readJsonBody(request, MAX_BODY_BYTES)
  } catch (err) {
    if (err instanceof BoundedBodyError && err.code === 'BODY_TOO_LARGE') {
      logAgentApiEvent({ endpoint: 'register', statusCode: 413, errorCode: 'body_too_large', userAgent: ua })
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }
    logAgentApiEvent({ endpoint: 'register', statusCode: 400, errorCode: 'invalid_json', userAgent: ua })
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = REGISTER_SCHEMA.safeParse(raw)
  if (!parsed.success) {
    logAgentApiEvent({ endpoint: 'register', statusCode: 400, errorCode: 'invalid_input', userAgent: ua })
    return NextResponse.json({ error: 'invalid_input', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, { status: 400 })
  }

  const supabase = createAdminClient()
  try {
    const result = await registerAgent(supabase, parsed.data, hashIp(ip))
    if (!result.ok) {
      const status = result.error === 'handle_taken' ? 409 : 429
      logAgentApiEvent({ endpoint: 'register', statusCode: status, errorCode: result.error, userAgent: ua })
      return NextResponse.json({ error: result.error }, { status })
    }
    const settings = await loadAgentCommentSettings(supabase)
    logAgentApiEvent({ endpoint: 'register', statusCode: 201, agentHandle: result.account.handle, userAgent: ua })
    return NextResponse.json({
      api_key: result.apiKey,
      handle: result.account.handle,
      // Neue Agenten starten mit den strengen Limits; nach sieben Tagen 3/min und 20/Tag.
      limits: { per_minute: 1, per_day: 5, daily_cap: settings.daily_cap, new_agent_days: 7 },
      skill: 'https://www.synthszr.com/agents/skill.md',
      mcp: 'https://www.synthszr.com/api/mcp',
    }, { status: 201 })
  } catch (err) {
    console.error('[Agents] register:', err)
    logAgentApiEvent({ endpoint: 'register', statusCode: 500, errorCode: 'server_error', userAgent: ua })
    return NextResponse.json({ error: 'Registrierung fehlgeschlagen' }, { status: 500 })
  }
}
