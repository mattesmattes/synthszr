/**
 * Lightweight fire-and-forget funnel telemetry for /api/agents/* and /api/mcp.
 * Records HTTP status and error codes so /admin/agents shows where agents
 * drop off between skill.md fetch, registration, and comment submission.
 */
import { after } from 'next/server'
import { classifyUserAgent } from '@/lib/agents/discovery'

export interface AgentApiEventInput {
  endpoint: 'register' | 'comments' | 'mcp'
  statusCode: number
  errorCode?: string | null
  agentHandle?: string | null
  userAgent?: string | null
}

export function logAgentApiEvent(event: AgentApiEventInput): void {
  if (process.env.NODE_ENV === 'test') return
  const row = {
    endpoint: event.endpoint,
    status_code: event.statusCode,
    error_code: event.errorCode ?? null,
    agent_handle: event.agentHandle ?? null,
    ua_class: classifyUserAgent(event.userAgent),
  }
  try {
    after(async () => {
      try {
        const { createAdminClient } = await import('@/lib/supabase/admin')
        await createAdminClient().from('agent_api_events').insert(row)
      } catch (err) {
        console.warn('[Agents] api event not logged:', err instanceof Error ? err.message : err)
      }
    })
  } catch {
    // Outside request scope (unit tests / scripts) — skip silently
  }
}
