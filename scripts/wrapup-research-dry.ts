/**
 * Trockenlauf der Update-Recherche für den Wochenrückblick (Spec 2026-10-24).
 *
 *   pnpm wrapup:research-dry                   # letzte abgeschlossene Woche
 *   pnpm wrapup:research-dry -- --asof 2026-10-25
 *
 * Führt NUR die Recherche aus (Anthropic + web_search, kostet Geld) und
 * schreibt KEINEN Entwurf. Nur llm_usage bekommt Zeilen durch das
 * Usage-Logging. Je Thema: Stufe, Zahl der Web-Suchen, Zusammenfassung und
 * Quellen; am Ende Dauer und Kosten (Token aus llm_usage; Web-Suchen werden
 * dort nicht bepreist und stehen separat mit 0,01 USD je Suche).
 *
 * Env wie die anderen Scripts: ~/.synthszr.env.prod vor .env.local.
 */
import { config } from 'dotenv'
import { existsSync } from 'node:fs'

const prodEnv = `${process.env.HOME}/.synthszr.env.prod`
config({ path: existsSync(prodEnv) ? prodEnv : '.env.local' })

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const { lastCompleteWeek } = await import('@/lib/wrapup/week')
  const { collectWeekTopics } = await import('@/lib/wrapup/collect')
  const { researchWeekUpdates } = await import('@/lib/wrapup/research')
  const { flushUsageLog } = await import('@/lib/ai/usage-log')
  const { createAdminClient } = await import('@/lib/supabase/admin')

  const supabase = createAdminClient()
  const week = lastCompleteWeek(new Date())
  const start = new Date().toISOString()
  console.log(`Woche: ${week.label} (${week.mondayDate} bis ${week.saturdayDate})`)

  const topics = await collectWeekTopics(supabase, week.mondayIso, week.saturdayEndIso)
  if (topics.length === 0) {
    console.log('Keine Themen in dieser Woche — nichts zu recherchieren.')
    return
  }
  console.log(`Themen: ${topics.length}\n`)

  const asOfDate = arg('--asof')
  const t0 = Date.now()
  const updates = await researchWeekUpdates(topics, asOfDate ? { asOfDate } : {})
  const dauer = Math.round((Date.now() - t0) / 1000)

  updates.forEach((u, i) => {
    const t = topics[i]
    console.log(`${u.weekday} ${t.date}: ${t.headline}`)
    console.log(`  Stufe: ${u.updateLevel} · Web-Suchen: ${u.searches}`)
    if (u.updateLevel !== 'none') {
      console.log(`  ${u.summary}`)
      for (const s of u.sources) console.log(`  - ${s.title} (${s.date}) ${s.url}`)
    }
    console.log()
  })

  await flushUsageLog()
  const { data } = await supabase
    .from('llm_usage')
    .select('cost_usd')
    .eq('use_case', 'wrapup_research')
    .gte('created_at', start)
  const rows = (data ?? []) as Array<{ cost_usd: number | null }>
  const tokenKosten = rows.reduce((a, r) => a + (r.cost_usd ?? 0), 0)
  const suchen = updates.reduce((a, u) => a + u.searches, 0)
  const zaehl = (lvl: string) => updates.filter((u) => u.updateLevel === lvl).length
  console.log(`Stufen: none ${zaehl('none')} · minor ${zaehl('minor')} · major ${zaehl('major')}`)
  console.log(
    `Dauer ${dauer} s · ${rows.length} Aufrufe in llm_usage · Token-Kosten ${tokenKosten.toFixed(3)} USD` +
    ` · Web-Suchen ${suchen} (≈ ${(suchen * 0.01).toFixed(2)} USD, nicht in llm_usage)`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('FEHLER:', e instanceof Error ? e.message : e); process.exit(1) })
