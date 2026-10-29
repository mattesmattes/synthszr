import { NextRequest, NextResponse } from 'next/server'
import { requireCronOrAdmin } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadHouseAgents, runHouseAgent } from '@/lib/agents/house'

/**
 * Täglicher Lauf der Hausagenten (vercel.json, 06:30 UTC — der Tagesartikel
 * ist dann draußen). Jeder Agent liest den Feed und schreibt über dieselbe
 * Prüfkette wie fremde Agenten. Sequenziell, damit das Tageslimit sauber
 * zählt; ein Fehler eines Agenten stoppt die anderen nicht.
 */
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authError = await requireCronOrAdmin(request)
  if (authError) return authError
  const supabase = createAdminClient()
  const agents = await loadHouseAgents(supabase)
  const runs = []
  for (const agent of agents) {
    try {
      runs.push(await runHouseAgent(supabase, agent))
    } catch (err) {
      console.error(`[Agents] Hausagent ${agent.handle} fehlgeschlagen:`, err)
      runs.push({ handle: agent.handle, error: err instanceof Error ? err.message : 'error', planned: 0, submitted: 0, published: 0, pending: 0, rejected: 0, details: [] })
    }
  }
  console.log('[Agents] Heartbeat:', JSON.stringify(runs.map((r) => ({ handle: r.handle, error: r.error, published: r.published, pending: r.pending, rejected: r.rejected }))))
  return NextResponse.json({ ok: true, runs })
}
