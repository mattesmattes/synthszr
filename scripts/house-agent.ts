/**
 * Hausagenten verwalten und von Hand laufen lassen (Konzept 2026-10-29).
 *
 *   pnpm agents:house -- register argus          # Persona aus lib/agents/house-personas.ts registrieren
 *   pnpm agents:house -- register lumen --langs de,en --max 3
 *   pnpm agents:house -- run                     # alle Hausagenten einmal laufen lassen (schreibt Takes!)
 *   pnpm agents:house -- run --handle argus --dry  # nur planen, nichts einreichen
 *   pnpm agents:house -- list
 *
 * Env wie die anderen Scripts (~/.synthszr.env.prod vor .env.local). `register`
 * legt das Konto über dieselbe Logik wie die API an und speichert den
 * Schlüssel in settings.agent_house (nur Service-Role liest das).
 */
import { config } from 'dotenv'
import { existsSync } from 'node:fs'

const prodEnv = `${process.env.HOME}/.synthszr.env.prod`
config({ path: existsSync(prodEnv) ? prodEnv : '.env.local' })

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const has = (name: string) => process.argv.includes(name)

async function main() {
  const [{ createAdminClient }, house, personas, accounts, { flushUsageLog }] = await Promise.all([
    import('@/lib/supabase/admin'),
    import('@/lib/agents/house'),
    import('@/lib/agents/house-personas'),
    import('@/lib/agents/accounts'),
    import('@/lib/ai/usage-log'),
  ])
  const supabase = createAdminClient()
  // pnpm reicht ein fuehrendes "--" mit durch — ueberspringen.
  const argv = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--"))
  const cmd = argv[0]

  if (cmd === 'list') {
    const agents = await house.loadHouseAgents(supabase)
    for (const a of agents) console.log(`${a.handle}  langs=${a.langs.join(',')}  max/Tag=${a.max_takes_per_day}  model=${a.model ?? '(Use Case)'}`)
    if (agents.length === 0) console.log('Keine Hausagenten konfiguriert.')
    return
  }

  if (cmd === 'register') {
    const handle = argv[1]
    const persona = personas.HOUSE_PERSONAS.find((p) => p.handle === handle)
    if (!persona) throw new Error(`Unbekannte Persona: ${handle}. Bekannt: ${personas.HOUSE_PERSONAS.map((p) => p.handle).join(', ')}`)
    const existing = await house.loadHouseAgents(supabase)
    if (existing.some((a) => a.handle === handle)) throw new Error(`${handle} ist schon registriert.`)
    const r = await accounts.registerAgent(supabase, {
      handle: persona.handle,
      display_name: persona.display_name,
      description: persona.description,
      model: arg('--model') ?? 'claude-opus-5',
    }, accounts.hashIp('house'))
    if (!r.ok) throw new Error(`Registrierung fehlgeschlagen: ${r.error}`)
    const langs = (arg('--langs') ?? 'de').split(',') as Array<'de' | 'en' | 'cs' | 'nds' | 'fr'>
    await house.saveHouseAgents(supabase, [...existing, {
      handle: persona.handle,
      api_key: r.apiKey,
      persona: persona.persona,
      langs,
      max_takes_per_day: Number(arg('--max') ?? 3),
      model: arg('--model'),
    }])
    console.log(`Registriert: @${persona.handle} (${persona.display_name}), langs=${langs.join(',')}. Schlüssel liegt in settings.agent_house.`)
    return
  }

  if (cmd === 'run') {
    const only = arg('--handle')
    const dry = has('--dry')
    const agents = (await house.loadHouseAgents(supabase)).filter((a) => !only || a.handle === only)
    if (agents.length === 0) { console.log('Keine passenden Hausagenten.'); return }
    for (const agent of agents) {
      const t0 = Date.now()
      const r = await house.runHouseAgent(supabase, agent, dry ? {
        submit: async (_s, _acc, input) => {
          console.log(`  [dry] ${input.lang} ${input.sectionAnchor.slice(0, 8)} ${input.stance}: ${input.body.slice(0, 160)}…`)
          return { ok: true, status: 'pending', holdReason: null, id: 'dry' }
        },
      } : {})
      console.log(`@${r.handle}: ${r.error ?? 'ok'} · geplant ${r.planned} · eingereicht ${r.submitted} · veröffentlicht ${r.published} · wartend ${r.pending} · abgelehnt ${r.rejected} · ${Math.round((Date.now() - t0) / 1000)} s`)
      for (const d of r.details) console.log(`  ${d.lang} ${d.sectionAnchor.slice(0, 8)} → ${d.result}`)
    }
    await flushUsageLog()
    return
  }

  console.log('Befehle: list | register <handle> [--langs de,en] [--max 3] [--model …] | run [--handle x] [--dry]')
}

main().then(() => process.exit(0)).catch((e) => { console.error('FEHLER:', e instanceof Error ? e.message : e); process.exit(1) })
