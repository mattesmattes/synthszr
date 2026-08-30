/**
 * Schreibt die kalibrierten Bewegungsparameter aus dem Vollkorpus-Test
 * (29.08.2026, 2376/2376 verifiziert) in glossary_terms.animation_params.
 *
 * VORAUSSETZUNG: Migration 20260829120000_glossary_animation_params.sql muss
 * bereits ueber das Supabase-Dashboard gelaufen sein (Migrationen laufen in
 * diesem Projekt nur dort, nicht per CLI — s. reference_supabase_migrationen).
 *
 * Nimmt die Eingabedatei als einziges Argument (der Pfad zur
 * animation-params.jsonl aus dem Test-Scratchpad). Ein Fehler bei einem
 * einzelnen Slug bricht den Lauf nicht ab, sondern wird gesammelt gemeldet —
 * bei 2376 Zeilen soll ein einzelner unbekannter Slug (z.B. ein inzwischen
 * geloeschter Begriff) nicht den ganzen Backfill verhindern.
 */
import { readFileSync } from 'node:fs'
import { config } from 'dotenv'
import os from 'node:os'

config({ path: os.homedir() + '/.synthszr.env.prod', quiet: true })

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string
const H: Record<string, string> = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
}

interface Zeile {
  slug: string
  muster: string
  amp: number
  pivot?: [number, number]
  dosis?: number
  fehler?: string
}

async function main() {
  const pfad = process.argv[2]
  if (!pfad) {
    console.error('Aufruf: npx tsx scripts/backfill-animation-params.ts <pfad-zu-animation-params.jsonl>')
    process.exit(1)
  }

  // Vorabpruefung: existiert die Spalte ueberhaupt schon? Frueh und klar
  // scheitern, statt 2376x denselben Fehler zu sammeln.
  const probe = await fetch(`${URL}/rest/v1/glossary_terms?select=animation_params&limit=1`, { headers: H })
  if (!probe.ok) {
    const body = await probe.text()
    if (body.includes('animation_params') && body.includes('does not exist')) {
      console.error('Die Spalte animation_params existiert noch nicht.')
      console.error('Migration 20260829120000_glossary_animation_params.sql zuerst ueber das Supabase-Dashboard ausfuehren.')
      process.exit(1)
    }
    console.error('Vorabpruefung fehlgeschlagen:', probe.status, body.slice(0, 300))
    process.exit(1)
  }

  const zeilen: Zeile[] = readFileSync(pfad, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((z) => !z.fehler)

  console.log(`${zeilen.length} Zeilen zu schreiben`)

  let ok = 0
  const fehler: Array<{ slug: string; problem: string }> = []
  const BATCH = 20

  for (let i = 0; i < zeilen.length; i += BATCH) {
    const stapel = zeilen.slice(i, i + BATCH)
    await Promise.all(
      stapel.map(async (z) => {
        const animation_params = { muster: z.muster, amp: z.amp, ...(z.pivot ? { pivot: z.pivot } : {}), dosis: z.dosis }
        const r = await fetch(`${URL}/rest/v1/glossary_terms?slug=eq.${encodeURIComponent(z.slug)}`, {
          method: 'PATCH',
          headers: { ...H, Prefer: 'return=minimal' },
          body: JSON.stringify({ animation_params }),
        })
        if (r.ok) {
          ok++
        } else {
          fehler.push({ slug: z.slug, problem: `HTTP ${r.status}: ${(await r.text()).slice(0, 150)}` })
        }
      }),
    )
    if ((i / BATCH) % 20 === 0) console.log(`  ${Math.min(i + BATCH, zeilen.length)}/${zeilen.length}`)
  }

  console.log(`\nFERTIG: ${ok}/${zeilen.length} geschrieben, ${fehler.length} Fehler`)
  for (const f of fehler.slice(0, 20)) console.log(`  ${f.slug}: ${f.problem}`)

  // Gegenprobe: stichprobenartig ein paar Zeilen zurücklesen.
  const stich = zeilen.slice(0, 3).map((z) => z.slug)
  for (const slug of stich) {
    const r = await fetch(`${URL}/rest/v1/glossary_terms?slug=eq.${slug}&select=slug,animation_params`, { headers: H })
    console.log('  Gegenprobe', await r.text())
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FEHLER:', e.message)
    process.exit(1)
  })
