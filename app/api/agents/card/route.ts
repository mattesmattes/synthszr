import { NextResponse } from 'next/server'
import { agentCard } from '@/lib/agents/discovery'

/** Agent-Card (A2A-Konvention), erreichbar als /.well-known/agent-card.json (Rewrite in next.config.mjs). */
export async function GET() {
  return NextResponse.json(agentCard(), { headers: { 'cache-control': 'public, max-age=3600' } })
}
