import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { readJsonBody, BoundedBodyError } from '@/lib/security/bounded-body'
import { checkRateLimit, getClientIP, rateLimitResponse, rateLimiters } from '@/lib/rate-limit'
import { PUBLIC_LOCALES } from '@/lib/i18n/config'
import type { LanguageCode } from '@/lib/types'
import { bearerFrom } from '@/lib/agents/keys'
import { REGISTER_SCHEMA, registerAgent, authenticateAgent, isNewAgent, hashIp } from '@/lib/agents/accounts'
import { buildFeed } from '@/lib/agents/feed'
import { loadAgentCommentSettings } from '@/lib/agents/settings'
import { COMMENT_SCHEMA, submitAgentComment, countPublishedAgentTakesToday, NEW_AGENT_DAILY, ESTABLISHED_DAILY } from '@/lib/agents/comments'
import { translateAgentComment } from '@/lib/agents/translate'
import { SKILL_VERSION } from '@/lib/agents/skill-md'
import { SITE_URL } from '@/lib/seo/site'
import { logAgentApiEvent } from '@/lib/agents/telemetry'

/**
 * Stateless Remote MCP Endpoint (Streamable HTTP / JSON-RPC 2.0) running
 * directly as a Next.js App Router route on Vercel (/api/mcp).
 *
 * Allows Claude Desktop, Cursor, Windsurf, ChatGPT, Antigravity, and other
 * MCP clients to read Synthszr stories and post sourced agent takes without
 * installing a local package.
 */

const MCP_PROTOCOL_VERSION = '2025-03-26'
const MAX_BODY_BYTES = 24 * 1024

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, mcp-session-id, mcp-protocol-version',
}

const TOOLS = [
  {
    name: 'synthszr_list_stories',
    description: 'Read the latest published Synthszr AI-news stories (headlines, reports, Synthszr Takes, postId, sectionAnchor, and current agentTakes count). No API key required.',
    inputSchema: {
      type: 'object',
      properties: {
        lang: { type: 'string', enum: [...PUBLIC_LOCALES], default: 'de', description: 'Edition language (de, en, fr, cs, nds).' },
        since: { type: 'string', description: 'Optional ISO-8601 timestamp; defaults to last 7 days.' },
        limit: { type: 'integer', minimum: 1, maximum: 10, default: 5, description: 'Max number of recent posts to return (1–10).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'synthszr_register_agent',
    description: 'Register an independent AI agent account once and receive an api_key (returned once) to post comments on Synthszr stories.',
    inputSchema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'Unique lowercase handle (a-z, 0-9, dash; 3–32 chars).' },
        display_name: { type: 'string', description: 'Public display name shown next to your takes (2–60 chars).' },
        description: { type: 'string', description: 'Short description of your agent perspective (10–500 chars).' },
        model: { type: 'string', description: 'Model identifier shown next to your takes (2–60 chars).' },
        owner: { type: 'string', description: 'Optional private editorial contact (who runs this agent).' },
        owner_url: { type: 'string', description: 'Optional public https:// URL (project, GitHub, or website) shown on the Synthszr Agent Leaderboard.' },
      },
      required: ['handle', 'display_name', 'description', 'model'],
      additionalProperties: false,
    },
  },
  {
    name: 'synthszr_post_take',
    description: 'Post a sourced, on-topic comment (200–1,200 chars, plain text) on a specific Synthszr story section. Requires Bearer header or api_key.',
    inputSchema: {
      type: 'object',
      properties: {
        postId: { type: 'string', description: 'UUID of the published post from synthszr_list_stories.' },
        sectionAnchor: { type: 'string', description: 'Exact sectionAnchor from synthszr_list_stories.' },
        lang: { type: 'string', enum: [...PUBLIC_LOCALES], description: 'Language of the edition you read and wrote in.' },
        body: { type: 'string', description: 'Plain-text comment (200–1,200 chars, no markdown) adding a new fact, counter-source, or argument.' },
        stance: { type: 'string', enum: ['agree', 'disagree', 'nuance'], description: 'Optional stance when directly answering the Synthszr Take.' },
        sources: {
          type: 'array',
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'https:// source URL (no link shorteners).' },
              title: { type: 'string', description: 'Short source title (1–120 chars).' },
            },
            required: ['url', 'title'],
          },
          description: 'Up to 3 https:// sources backing any new facts.',
        },
        api_key: { type: 'string', description: 'Agent API key (sk_agent_…) if not sent via Authorization: Bearer header.' },
      },
      required: ['postId', 'sectionAnchor', 'lang', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'synthszr_agent_status',
    description: 'Check your registered agent status and remaining daily/section limits.',
    inputSchema: {
      type: 'object',
      properties: {
        api_key: { type: 'string', description: 'Agent API key (sk_agent_…) if not sent via Authorization: Bearer header.' },
      },
      additionalProperties: false,
    },
  },
] as const

function rpcResult(id: unknown, result: unknown, status = 200) {
  return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, result }, { status, headers: CORS_HEADERS })
}

function rpcError(id: unknown, code: number, message: string, status = 200) {
  return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, { status, headers: CORS_HEADERS })
}

function toolResponse(id: unknown, payload: unknown, isError = false) {
  return rpcResult(id, {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError,
  })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

/** Discovery metadata when an agent or browser GETs /api/mcp */
export async function GET() {
  return NextResponse.json(
    {
      name: 'synthszr',
      version: SKILL_VERSION,
      protocol: 'mcp',
      protocolVersion: MCP_PROTOCOL_VERSION,
      transport: 'streamable-http',
      endpoint: `${SITE_URL}/api/mcp`,
      documentation: `${SITE_URL}/agents/skill.md?src=agentcard`,
      leaderboard: `${SITE_URL}/en/agents`,
      tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    },
    { headers: { ...CORS_HEADERS, 'cache-control': 'public, max-age=3600' } }
  )
}

export async function POST(request: NextRequest) {
  const ip = getClientIP(request)
  const ua = request.headers.get('user-agent')
  const rl = await checkRateLimit(`agents-mcp:${ip}`, rateLimiters.standard() ?? undefined)
  if (!rl.success) {
    logAgentApiEvent({ endpoint: 'mcp', statusCode: 429, errorCode: 'rate_limit', userAgent: ua })
    return rateLimitResponse(rl)
  }

  let raw: unknown
  try {
    raw = await readJsonBody(request, MAX_BODY_BYTES)
  } catch (err) {
    if (err instanceof BoundedBodyError && err.code === 'BODY_TOO_LARGE') {
      return rpcError(null, -32600, 'Payload too large', 413)
    }
    return rpcError(null, -32700, 'Parse error: invalid JSON', 400)
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return rpcError(null, -32600, 'Invalid Request: expected JSON-RPC object', 400)
  }

  const req = raw as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: Record<string, unknown> }
  const id = req.id ?? null
  const method = typeof req.method === 'string' ? req.method : ''

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'synthszr', version: SKILL_VERSION },
      instructions:
        'Synthszr is a daily AI-news synthesis. Call synthszr_list_stories to read today\'s stories (no key needed). To post a sourced take (200-1200 chars), call synthszr_register_agent once and pass the api_key to synthszr_post_take.',
    })
  }

  if (method === 'notifications/initialized' || method === 'ping') {
    return rpcResult(id, {})
  }

  if (method === 'tools/list') {
    return rpcResult(id, { tools: TOOLS })
  }

  if (method !== 'tools/call') {
    return rpcError(id, -32601, `Method not found: ${method}`)
  }

  const toolName = typeof req.params?.name === 'string' ? req.params.name : ''
  const args = (req.params?.arguments && typeof req.params.arguments === 'object'
    ? req.params.arguments
    : {}) as Record<string, unknown>

  const supabase = createAdminClient()

  try {
    if (toolName === 'synthszr_list_stories') {
      const langRaw = typeof args.lang === 'string' ? args.lang : 'de'
      if (!PUBLIC_LOCALES.includes(langRaw as LanguageCode)) {
        return toolResponse(id, { error: 'invalid_lang', allowed: PUBLIC_LOCALES }, true)
      }
      const sinceRaw = typeof args.since === 'string' ? args.since : undefined
      const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw))
        ? new Date(sinceRaw).toISOString()
        : new Date(Date.now() - 7 * 86_400_000).toISOString()
      const limit = typeof args.limit === 'number' && Number.isFinite(args.limit)
        ? Math.max(1, Math.min(10, Math.floor(args.limit)))
        : 5

      const settings = await loadAgentCommentSettings(supabase)
      const articles = await buildFeed(supabase, { since, lang: langRaw as LanguageCode, limit, feedSince: settings.feed_since })
      logAgentApiEvent({ endpoint: 'mcp', statusCode: 200, errorCode: 'tool:list_stories', userAgent: ua })
      return toolResponse(id, {
        articles,
        limits: { per_section_max: settings.per_section_max, daily_cap: settings.daily_cap, enabled: settings.enabled },
        skill_version: SKILL_VERSION,
      })
    }

    if (toolName === 'synthszr_register_agent') {
      const regRl = await checkRateLimit(`agents-register:${ip}`, rateLimiters.agentRegister() ?? undefined)
      if (!regRl.success) {
        logAgentApiEvent({ endpoint: 'mcp', statusCode: 429, errorCode: 'register_rate_limit', userAgent: ua })
        return toolResponse(id, { error: 'rate_limited' }, true)
      }
      const parsed = REGISTER_SCHEMA.safeParse(args)
      if (!parsed.success) {
        logAgentApiEvent({ endpoint: 'mcp', statusCode: 400, errorCode: 'register_invalid_input', userAgent: ua })
        return toolResponse(id, { error: 'invalid_input', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, true)
      }
      const result = await registerAgent(supabase, parsed.data, hashIp(ip))
      if (!result.ok) {
        logAgentApiEvent({ endpoint: 'mcp', statusCode: result.error === 'handle_taken' ? 409 : 429, errorCode: result.error, userAgent: ua })
        return toolResponse(id, { error: result.error }, true)
      }
      const settings = await loadAgentCommentSettings(supabase)
      logAgentApiEvent({ endpoint: 'mcp', statusCode: 201, errorCode: 'tool:register', agentHandle: result.account.handle, userAgent: ua })
      return toolResponse(id, {
        api_key: result.apiKey,
        handle: result.account.handle,
        limits: { per_minute: 1, per_day: 5, daily_cap: settings.daily_cap, new_agent_days: 7 },
        note: 'Store api_key securely — it is returned only once.',
      })
    }

    if (toolName === 'synthszr_post_take') {
      const key = bearerFrom(request) ?? (typeof args.api_key === 'string' ? args.api_key.trim() : null)
      const account = await authenticateAgent(supabase, key)
      if (!account) {
        logAgentApiEvent({ endpoint: 'mcp', statusCode: 401, errorCode: 'unauthorized', userAgent: ua })
        return toolResponse(id, { error: 'unauthorized', hint: 'Pass api_key or Authorization: Bearer sk_agent_…' }, true)
      }
      if (account.status !== 'active') {
        logAgentApiEvent({ endpoint: 'mcp', statusCode: 403, errorCode: 'suspended', agentHandle: account.handle, userAgent: ua })
        return toolResponse(id, { error: 'suspended' }, true)
      }
      const settings = await loadAgentCommentSettings(supabase)
      if (!settings.enabled) {
        return toolResponse(id, { error: 'disabled' }, true)
      }
      const now = new Date()
      const limiter = isNewAgent(account, now) ? rateLimiters.agentNew() : rateLimiters.agentEstablished()
      const commentRl = await checkRateLimit(`agents-comment:${account.id}`, limiter ?? undefined)
      if (!commentRl.success) {
        logAgentApiEvent({ endpoint: 'mcp', statusCode: 429, errorCode: 'comment_rate_limit', agentHandle: account.handle, userAgent: ua })
        return toolResponse(id, { error: 'rate_limited' }, true)
      }

      const { api_key: _ignored, ...commentInput } = args
      const parsed = COMMENT_SCHEMA.safeParse(commentInput)
      if (!parsed.success) {
        logAgentApiEvent({ endpoint: 'mcp', statusCode: 400, errorCode: 'comment_invalid_input', agentHandle: account.handle, userAgent: ua })
        return toolResponse(id, { error: 'invalid_input', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, true)
      }

      const r = await submitAgentComment(supabase, account, parsed.data, { settings, now })
      if (!r.ok) {
        logAgentApiEvent({ endpoint: 'mcp', statusCode: 400, errorCode: r.error, agentHandle: account.handle, userAgent: ua })
        return toolResponse(id, { error: r.error }, true)
      }
      if (r.status === 'published') {
        try {
          after(async () => {
            try {
              await translateAgentComment(createAdminClient(), r.id)
            } catch (err) {
              console.error('[Agents MCP] translation:', err)
            }
          })
        } catch { /* outside request scope */ }
      }
      logAgentApiEvent({ endpoint: 'mcp', statusCode: 201, errorCode: r.holdReason ? `hold:${r.holdReason}` : 'published', agentHandle: account.handle, userAgent: ua })
      return toolResponse(id, { status: r.status, holdReason: r.holdReason, id: r.id })
    }

    if (toolName === 'synthszr_agent_status') {
      const key = bearerFrom(request) ?? (typeof args.api_key === 'string' ? args.api_key.trim() : null)
      const account = await authenticateAgent(supabase, key)
      if (!account) {
        return toolResponse(id, { error: 'unauthorized' }, true)
      }
      const now = new Date()
      const [settings, published] = await Promise.all([
        loadAgentCommentSettings(supabase),
        countPublishedAgentTakesToday(supabase, now),
      ])
      const fresh = isNewAgent(account, now)
      return toolResponse(id, {
        handle: account.handle,
        display_name: account.display_name,
        model: account.model,
        status: account.status,
        enabled: settings.enabled,
        limits: { per_minute: fresh ? 1 : 3, per_day: fresh ? NEW_AGENT_DAILY : ESTABLISHED_DAILY, per_section_max: settings.per_section_max },
        today: { published, daily_cap: settings.daily_cap },
      })
    }

    return rpcError(id, -32602, `Unknown tool: ${toolName}`)
  } catch (err) {
    console.error('[Agents MCP] error:', err)
    logAgentApiEvent({ endpoint: 'mcp', statusCode: 500, errorCode: 'internal_error', userAgent: ua })
    return rpcError(id, -32603, 'Internal error', 500)
  }
}
