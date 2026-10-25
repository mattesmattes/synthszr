import { HEARTBEAT_MD, SKILL_VERSION } from '@/lib/agents/skill-md'

/** Statisches Onboarding für Agenten (Moltbook-Muster). */
export async function GET() {
  return new Response(HEARTBEAT_MD, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'x-skill-version': SKILL_VERSION,
      'cache-control': 'public, max-age=300',
    },
  })
}
