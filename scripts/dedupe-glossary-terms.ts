/**
 * CLI fuer runGlossaryDedupe (lib/glossary/dedupe-run.ts) — bereinigt
 * Begriffs-Dubletten im Fachbegriff-Lexikon.
 *
 * Befund 2026-08-06: die Dubletten-Erkennung beim Erzeugen (generateCandidates
 * / partitionByExisting in lib/glossary/crawl.ts) verglich nur exakte
 * Slug-Gleichheit. Schreibvarianten wie Bindestrich oder Singular/Plural
 * ergeben einen ANDEREN Slug und wurden deshalb als zwei getrennte Begriffe
 * erzeugt - in Prod betraf das vier Paare: "Eval"/"Evals",
 * "Leveraged ETF"/"Leveraged ETFs", "Pretraining"/"Pre-Training",
 * "Time Series Foundation Model"/"...Models". lib/glossary/crawl.ts ist seit
 * demselben Befund gegen KUENFTIGE Paare dieser Art abgesichert (normalisierter
 * Vergleich in partitionByExisting) - dieses Skript raeumt den BESTAND auf.
 *
 * Erweiterung 2026-08-30: ein Scan gegen den kompletten Bestand (2904 Begriffe)
 * fand 22 Cluster mit >1 veroeffentlichtem Eintrag desselben canonical_name,
 * von denen die Slug-Normalisierung allein nur 4 gefunden haette (z.B.
 * "artboard"/"artboards"). Die grosse Mehrheit sind Akronym/Vollform-Paare
 * ("mcp"/"model-context-protocol", "saas"/"software-as-a-service",
 * "ci"/"continuous-integration", "sso"/"single-sign-on", "pr"/"pull-request",
 * "cuda"/"compute-unified-device-architecture", "tco"/"total-cost-of-ownership",
 * "vscode"/"visual-studio-code") und synonyme Direktkonzepte ("ki-agent" 4x
 * unter agent-ki-agent/ai-agents/ki-agent/ki-agentin) — VOELLIG verschiedene
 * Slugs, die normalizeSlugForDedup grundsaetzlich nie zusammenfuehren kann.
 * Dedupliziert wird deshalb jetzt ZUSAETZLICH ueber normalisierten
 * canonical_name (s. buildClusters in dedupe-run.ts).
 *
 * Die eigentliche Logik lebt seit demselben Datum in
 * lib/glossary/dedupe-run.ts (runGlossaryDedupe) — importierbar, damit sowohl
 * dieses CLI-Skript als auch app/api/cron/glossary-dedupe (woechentlich)
 * dieselbe Implementierung nutzen statt zweier divergierender Kopien. Diese
 * Datei ist nur noch die Kommandozeilen-Huelle: Env/Argv-Handling und
 * menschenlesbare Ausgabe des strukturierten Ergebnisses.
 *
 * KRITERIUM je Cluster (lib/glossary/dedupe.ts, decidePair), in dieser
 * Reihenfolge:
 *   1. Mehr eingehende Verlinkungen (Artikel mit glossaryLink-Mark auf den Slug).
 *   2. Bei Gleichstand: mehr Inhalt (Zeichenlaenge von summary + body).
 *   3. Bei erneutem Gleichstand: der AELTERE Begriff (created_at).
 * Urspruenglich nur Kriterium 2 - Betreiber-Korrektur 2026-08-06, nachdem der
 * erste Dry-Run zeigte, dass reine Inhaltslaenge in zwei von vier Paaren den
 * Slug ohne jede Verlinkung gewinnen liess. Der Verlierer wird auf
 * status='hidden' gesetzt, sein canonical_name UND seine eigenen Aliasse
 * wandern als Alias an den verbleibenden Begriff.
 *
 * GEFAHR: bestehende Artikel koennen per glossaryLink-Mark schon auf den zu
 * versteckenden Slug zeigen. Ein Link auf einen hidden-Begriff fuehrt auf
 * notFound() - deshalb korrigiert runGlossaryDedupe die betroffenen
 * generated_posts ueber linkPostContent (lib/glossary/backfill.ts), NACHDEM
 * der Loser hidden ist und sein Name als Alias am Gewinner haengt (dieselbe
 * Textstelle matcht dann wieder - nur auf den anderen Slug). Betroffen sind
 * ausschliesslich generated_posts (deutsche Artikel); content_translations
 * haben ihre eigene Mark-Injektion und werden hier NICHT angefasst.
 *
 * Dry-Run als Voreinstellung: ohne --apply wird NUR gelesen und berichtet.
 *
 * Aufruf:
 *   npx tsx scripts/dedupe-glossary-terms.ts <env-datei>
 *   npx tsx scripts/dedupe-glossary-terms.ts <env-datei> --apply
 *
 * Fuer echte Prod-Schluessel: vercel env pull --environment=production <env-datei>
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { runGlossaryDedupe } from '@/lib/glossary/dedupe-run'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const envPath = args.find((a) => !a.startsWith('--')) || '.env.local'

dotenv.config({ path: envPath, quiet: true })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { autoRefreshToken: false, persistSession: false } },
)

async function main() {
  console.log(`Modus: ${APPLY ? 'SCHREIBEN (--apply)' : 'nur lesen (Dry-Run)'}`)
  console.log(`Env:   ${envPath}\n`)

  const r = await runGlossaryDedupe(supabase, { apply: APPLY })

  console.log(`${r.publishedCount} veroeffentlichte Begriffe geladen`)
  if (r.clusterCount === 0) {
    console.log('Keine Dubletten gefunden.')
    return
  }
  console.log(`${r.clusterCount} Dubletten-Gruppe(n) gefunden\n`)

  console.log('Entscheidungen:\n')
  for (const d of r.decisions) {
    console.log(`Cluster: ${d.winnerSlug}, ${d.loserSlugs.join(', ')} - entschieden durch: ${d.criterion}`)
    for (const line of d.reasoning) console.log(`  ${line}`)
    console.log('')
  }
  console.log(`${r.markChangesNeeded} Mark-Aenderung(en) waeren durch diese Entscheidung noetig.`)

  if (!APPLY) {
    console.log('\nNichts geschrieben. Mit --apply erneut aufrufen.')
    return
  }

  console.log('\n--- Schreiblauf ---\n')
  for (const slug of r.hiddenSlugs) console.log(`  versteckt: ${slug}`)
  console.log(`\n${r.articlesRelinked} von ${r.articlesAffected} Artikeln neu verlinkt.`)
  if (r.errors.length) {
    console.log('\nFehler:')
    for (const e of r.errors) console.error(`  ${e}`)
  }
  console.log('\nFertig.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
