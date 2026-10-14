// app/api/admin/curation/runs/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRun, getRunUnits, listRuns } from '@/lib/curation/service'
import type { RunMode } from '@/lib/curation/types'

const MODES: RunMode[] = ['shadow', 'backtest']

function parseMode(value: string | null): RunMode | undefined {
  return MODES.includes(value as RunMode) ? (value as RunMode) : undefined
}

/**
 * Fehlertext fuer das Panel: generische Service-Fehler bleiben, wie sie
 * sind, aber eine fehlende Tabelle (noch nicht eingespielte Migration)
 * bekommt einen konkreten Hinweis statt eines nackten PostgREST-Fehlers —
 * Muster app/admin/llm-costs/page.tsx.
 */
function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Unbekannter Fehler'
  if (message.includes('curation_runs') && message.includes('schema cache')) {
    return `${message} — Migration 20261014090000 einspielen`
  }
  return message
}

/**
 * Lesepfad fuer das read-only Panel `/admin/curation`: Liste (ohne `id`)
 * oder Detail (mit `id`).
 *
 * `new URL(request.url)` statt `request.nextUrl` — Testbarkeit, siehe
 * app/api/admin/glossary-jobs/route.ts:75-77 (Tests reichen ein einfaches
 * Request-Objekt ohne `nextUrl` durch).
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const supabase = createAdminClient()

  try {
    if (id) {
      const run = await getRun(supabase, id)
      if (!run) return NextResponse.json({ error: 'Run nicht gefunden' }, { status: 404 })

      const units = await getRunUnits(supabase, run.id)

      // `cards`/`pool` fliegen aus dem Detail — Payload-Groesse (Pool-Snapshot
      // und Scout-Karten sind pro Run mehrere hundert Items schwer, das Panel
      // zeigt davon nur die Titel-Map unten). `brief` behaelt nur `meta` und
      // `precedentIds`: die Texte (systemPrefix/dayBlock) sind das, was dem
      // Modell vorgelegt wurde, nicht das, was der Betreiber hier braucht —
      // die Seite zeigt stattdessen die Zaehler aus `meta`.
      const { cards: _cards, pool, brief, ...rest } = run
      const titles = Object.fromEntries((pool?.items ?? []).map((item) => [item.id, item.title]))

      return NextResponse.json({
        run: {
          ...rest,
          brief: brief ? { meta: brief.meta, precedentIds: brief.precedentIds } : null,
        },
        units,
        titles,
      })
    }

    const limitRaw = Number(searchParams.get('limit'))
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.max(1, Math.min(Math.trunc(limitRaw), 100)) : 30
    const mode = parseMode(searchParams.get('mode'))
    const opts = mode ? { limit, mode } : { limit }
    const runs = await listRuns(supabase, opts)
    return NextResponse.json({ runs })
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 })
  }
}
