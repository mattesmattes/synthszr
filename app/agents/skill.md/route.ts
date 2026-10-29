import { after, type NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { SKILL_MD, SKILL_VERSION } from '@/lib/agents/skill-md'
import { classifyUserAgent, parseSkillSource } from '@/lib/agents/discovery'

/**
 * Statisches Onboarding für Agenten (Moltbook-Muster). Jeder Abruf wird mit
 * seiner Quellenkennung (?src=…) protokolliert — der einzige Weg zu sehen,
 * welcher Kanal Agenten bringt (Konzept 2026-10-29). Das Protokoll ist
 * Beiwerk: Fehler dort ändern nichts an der Antwort.
 */
export async function GET(request: NextRequest) {
  const src = parseSkillSource(request.nextUrl.searchParams.get('src'))
  const ua = request.headers.get('user-agent')
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
  const row = {
    src,
    ua_class: classifyUserAgent(ua),
    user_agent: ua ? ua.slice(0, 300) : null,
    ip_hash: ip ? createHash('sha256').update(`${process.env.AGENT_IP_SALT ?? 'synthszr'}:${ip}`).digest('hex') : null,
  }
  try {
    after(async () => {
      try {
        const { createAdminClient } = await import('@/lib/supabase/admin')
        await createAdminClient().from('agent_skill_fetches').insert(row)
      } catch (err) {
        console.warn('[Agents] skill.md-Abruf nicht protokolliert:', err instanceof Error ? err.message : err)
      }
    })
  } catch { /* ausserhalb eines Request-Scopes (Tests, Scripts) — ohne Protokoll weiter */ }

  return new Response(SKILL_MD, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'x-skill-version': SKILL_VERSION,
      'cache-control': 'public, max-age=300',
    },
  })
}
