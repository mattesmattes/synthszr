/**
 * Bereinigt Begriffs-Dubletten im Fachbegriff-Lexikon.
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
 * Erkennung: zwei veroeffentlichte Begriffe, deren Slug ohne Bindestriche und
 * ohne einen einzelnen End-"s" gleich ist (normalizeSlugForDedup,
 * lib/glossary/generate.ts).
 *
 * KRITERIUM je Paar (lib/glossary/dedupe.ts, decidePair), in dieser Reihenfolge:
 *   1. Mehr eingehende Verlinkungen (Artikel mit glossaryLink-Mark auf den Slug).
 *   2. Bei Gleichstand: mehr Inhalt (Zeichenlaenge von summary + body).
 *   3. Bei erneutem Gleichstand: der AELTERE Begriff (created_at).
 * Urspruenglich nur Kriterium 2 - Betreiber-Korrektur 2026-08-06, nachdem der
 * erste Dry-Run zeigte, dass reine Inhaltslaenge in zwei von vier Paaren den
 * Slug ohne jede Verlinkung gewinnen liess (s. Report). Der Verlierer wird auf
 * status='hidden' gesetzt, sein canonical_name UND seine eigenen Aliasse
 * wandern als Alias an den verbleibenden Begriff (aliases ist text[], s.
 * lib/glossary/detail.ts/terms.ts) - damit finden Suche und Verlinkung ihn
 * weiter.
 *
 * GEFAHR: bestehende Artikel koennen per glossaryLink-Mark schon auf den zu
 * versteckenden Slug zeigen (lib/glossary/inject-marks.ts). Ein Link auf einen
 * hidden-Begriff fuehrt auf notFound() - dieses Skript wuerde also tote Links
 * erzeugen, wenn es die Marks nicht mitkorrigiert. Es tut das NICHT ueber eine
 * eigene Mark-Schreib-Logik, sondern ueber linkPostContent aus
 * lib/glossary/backfill.ts (bereits vorhanden, fuer genau diesen Zweck exportiert):
 * injectGlossaryMarks entfernt darin zuerst ALLE Marks und setzt sie anhand der
 * AKTUELLEN Begriffsliste neu. Nachdem der Loser hidden ist und sein Name als
 * Alias am Gewinner haengt, matcht dieselbe Textstelle wieder - nur auf den
 * anderen Slug. Betroffen sind ausschliesslich generated_posts (deutsche
 * Artikel); content_translations (uebersetzte Artikel) haben ihre eigene
 * Mark-Injektion (reinjectGlossaryMarksForTranslation) und werden hier NICHT
 * angefasst - s. Report.
 *
 * Dry-Run als Voreinstellung: ohne --apply wird NUR gelesen und berichtet,
 * inklusive der Anzahl betroffener Artikel-Verlinkungen je zu versteckendem
 * Slug. Muster/Aufrufkonvention wie scripts/requantize-glossary-illustrations.ts.
 *
 * Aufruf:
 *   npx tsx scripts/dedupe-glossary-terms.ts <env-datei>
 *   npx tsx scripts/dedupe-glossary-terms.ts <env-datei> --apply
 *
 * Fuer echte Prod-Schluessel: vercel env pull --environment=production <env-datei>
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { normalizeSlugForDedup } from '@/lib/glossary/generate'
import { decidePair, mergeAliases, type DedupeRow } from '@/lib/glossary/dedupe'
import { linkPostContent } from '@/lib/glossary/backfill'
import { getMatcherTerms, getChartProductNames, buildReservedNames } from '@/lib/glossary/terms'
import { safeParseJSON } from '@/lib/utils/safe-json'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const envPath = args.find((a) => !a.startsWith('--')) || '.env.local'

dotenv.config({ path: envPath, quiet: true })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { autoRefreshToken: false, persistSession: false } }
)

interface SlugRow {
  id: string
  slug: string
  canonical_name: string
  created_at: string
}

type FullRow = DedupeRow

/** Schmale Spalten, ALLE veroeffentlichten Begriffe - paginiert, PostgREST
 *  kappt sonst still bei 1000 Zeilen (aktuell ~470, aber das Lexikon waechst). */
async function loadPublishedSlugs(): Promise<SlugRow[]> {
  const rows: SlugRow[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('glossary_terms')
      .select('id, slug, canonical_name, created_at')
      .eq('status', 'published')
      .order('slug')
      .range(offset, offset + 999)
    if (error) throw new Error(`Begriffe nicht ladbar: ${error.message}`)
    if (!data?.length) break
    rows.push(...(data as SlugRow[]))
    if (data.length < 1000) break
  }
  return rows
}

/** Artikel, die per glossaryLink-Mark auf `slug` zeigen. ilike filtert auf der
 *  DB-Seite (SQL ILIKE) - nur die tatsaechlichen Treffer werden uebertragen,
 *  nicht der ganze content jedes veroeffentlichten Artikels (Egress). Das
 *  Muster "attrs":{"slug":"..."} ist eindeutig: injectGlossaryMarks ist die
 *  einzige Stelle, die eine Mark mit einem "slug"-Attribut schreibt (Stock-Links
 *  nutzen "href", s. lib/glossary/inject-stock-links.ts). */
async function findLinkingArticles(slug: string): Promise<Array<{ id: string; slug: string }>> {
  const { data, error } = await supabase
    .from('generated_posts')
    .select('id, slug')
    .eq('status', 'published')
    .ilike('content', `%"attrs":{"slug":"${slug}"}%`)
  if (error) throw new Error(`Verlinkungs-Check fuer "${slug}" fehlgeschlagen: ${error.message}`)
  return (data ?? []) as Array<{ id: string; slug: string }>
}

async function main() {
  console.log(`Modus: ${APPLY ? 'SCHREIBEN (--apply)' : 'nur lesen (Dry-Run)'}`)
  console.log(`Env:   ${envPath}\n`)

  const published = await loadPublishedSlugs()
  console.log(`${published.length} veroeffentlichte Begriffe geladen`)

  const groups = new Map<string, SlugRow[]>()
  for (const row of published) {
    const key = normalizeSlugForDedup(row.slug)
    const g = groups.get(key) ?? []
    g.push(row)
    groups.set(key, g)
  }
  const dupeGroups = [...groups.values()].filter((g) => g.length > 1)

  if (dupeGroups.length === 0) {
    console.log('Keine Dubletten gefunden.')
    return
  }
  console.log(`${dupeGroups.length} Dubletten-Gruppe(n) gefunden\n`)

  // Volle Zeilen (mit body/summary/aliases) NUR fuer die betroffenen Slugs -
  // kein select('*') ueber den ganzen Bestand (body ist gross, Egress).
  const affectedSlugs = dupeGroups.flat().map((r) => r.slug)
  const { data: fullRows, error: fullErr } = await supabase
    .from('glossary_terms')
    .select('id, slug, canonical_name, aliases, summary, body, created_at')
    .in('slug', affectedSlugs)
  if (fullErr) throw new Error(`Volle Begriffsdaten nicht ladbar: ${fullErr.message}`)
  const bySlug = new Map(((fullRows ?? []) as FullRow[]).map((r) => [r.slug, r]))

  // Verlinkungen sind das ERSTE Kriterium (lib/glossary/dedupe.ts) - deshalb
  // fuer JEDE Zeile jeder Gruppe geprueft, nicht nur fuer den nach Inhalt
  // vermuteten Verlierer. Wer hier wie viele Links hat, entscheidet erst
  // decidePair - nicht diese Schleife.
  console.log('Verlinkungs-Check (alle Kandidaten, vor der Entscheidung):')
  const linkedArticlesBySlug = new Map<string, Array<{ id: string; slug: string }>>()
  for (const group of dupeGroups) {
    for (const g of group) {
      const posts = await findLinkingArticles(g.slug)
      linkedArticlesBySlug.set(g.slug, posts)
      console.log(
        `  ${g.slug}: ${posts.length} Artikel` +
        (posts.length ? ` - ${posts.map((p) => p.slug).join(', ')}` : ''),
      )
    }
  }
  const linkCounts = new Map(
    [...linkedArticlesBySlug.entries()].map(([slug, posts]) => [slug, posts.length]),
  )

  const decisions = []
  for (const group of dupeGroups) {
    const rows = group.map((g) => bySlug.get(g.slug)).filter((r): r is FullRow => Boolean(r))
    if (rows.length < 2) continue
    decisions.push(decidePair(rows, linkCounts))
  }

  console.log('\nEntscheidungen:\n')
  for (const d of decisions) {
    console.log(
      `Paar (normalisiert gleich): ${d.winner.slug}, ${d.losers.map((l) => l.slug).join(', ')} ` +
      `- entschieden durch: ${d.decidingCriterion}`,
    )
    for (const line of d.reasoning) console.log(`  ${line}`)
    console.log('')
  }

  // Die tatsaechlich anfallenden Mark-Aenderungen sind NUR die Links der
  // ENDGUELTIGEN Verlierer - nicht mehr alle vier Slugs von oben. Explizit
  // gezaehlt, weil dieser Wert die Risikoabschaetzung des Kriteriums ist: 0
  // heisst "niemand verlinkte auf den Verlierer", jede andere Zahl bedeutet
  // tatsaechliches Umbiegen bestehender Artikel-Verlinkungen.
  let totalMarkChanges = 0
  for (const d of decisions) {
    for (const loser of d.losers) totalMarkChanges += linkCounts.get(loser.slug) ?? 0
  }
  console.log(`${totalMarkChanges} Mark-Aenderung(en) waeren durch diese Entscheidung noetig ` +
    '(Summe der Verlinkungen auf die jeweiligen Verlierer).')

  if (!APPLY) {
    console.log('\nNichts geschrieben. Mit --apply erneut aufrufen.')
    return
  }

  // --- Schreiblauf ---
  console.log('\n--- Schreiblauf ---\n')
  for (const d of decisions) {
    for (const loser of d.losers) {
      const mergedAliases = mergeAliases(d.winner, loser)

      const { error: hideErr } = await supabase
        .from('glossary_terms')
        .update({ status: 'hidden', updated_at: new Date().toISOString() })
        .eq('id', loser.id)
      if (hideErr) {
        console.error(`  FEHLER beim Verstecken von ${loser.slug}: ${hideErr.message}`)
        continue
      }

      const { error: aliasErr } = await supabase
        .from('glossary_terms')
        .update({ aliases: mergedAliases, updated_at: new Date().toISOString() })
        .eq('id', d.winner.id)
      if (aliasErr) {
        console.error(`  FEHLER beim Alias-Merge auf ${d.winner.slug}: ${aliasErr.message}`)
        continue
      }

      // Lokal aktuell halten: bei einer Gruppe mit mehr als zwei Mitgliedern
      // muss der naechste Merge-Durchlauf auf den bereits erweiterten Aliassen
      // des Gewinners aufsetzen, sonst dedupliziert er gegen die alte Liste.
      d.winner.aliases = mergedAliases
      console.log(`  versteckt: ${loser.slug} -> Alias "${loser.canonical_name}" an ${d.winner.slug}`)
    }
  }

  // Verlinkungen umbiegen: bestehende Re-Injektion nutzen (linkPostContent aus
  // lib/glossary/backfill.ts), keine dritte Stelle, die Marks schreibt. Die
  // Begriffsliste MUSS NACH den obigen Updates geladen werden - sie filtert auf
  // status=published und enthaelt die frisch zusammengefuehrten Aliasse.
  const affectedPosts = new Map<string, { id: string; slug: string }>()
  for (const d of decisions) {
    for (const loser of d.losers) {
      for (const p of linkedArticlesBySlug.get(loser.slug) ?? []) affectedPosts.set(p.id, p)
    }
  }

  if (affectedPosts.size === 0) {
    console.log('\nKeine Artikel-Verlinkungen zu korrigieren.')
  } else {
    const terms = await getMatcherTerms('de')
    if (terms === null) {
      console.error(
        '\nFEHLER: Begriffsliste nicht ladbar - Verlinkungen NICHT korrigiert. ' +
        'Status/Alias-Aenderungen sind bereits geschrieben; Skript erneut ausfuehren, ' +
        'um nur noch die Verlinkung zu reparieren (findet dann keine Dubletten-Paare ' +
        'mehr, s. Report fuer den manuellen Nachtrag).',
      )
    } else {
      const reserved = buildReservedNames(await getChartProductNames())
      let fixed = 0
      for (const post of affectedPosts.values()) {
        const { data: postRow, error: postErr } = await supabase
          .from('generated_posts')
          .select('content')
          .eq('id', post.id)
          .maybeSingle()
        if (postErr || !postRow) {
          console.error(`  FEHLER: Artikel ${post.slug} nicht ladbar`)
          continue
        }
        const parsed = typeof postRow.content === 'string' ? safeParseJSON(postRow.content) : postRow.content
        const result = linkPostContent(parsed, terms, reserved)
        if (!result.changed) continue
        const { error: upErr } = await supabase
          .from('generated_posts')
          .update({ content: JSON.stringify(result.content) })
          .eq('id', post.id)
        if (upErr) {
          console.error(`  FEHLER: ${post.slug} nicht speicherbar: ${upErr.message}`)
          continue
        }
        fixed++
        console.log(`  Verlinkung korrigiert: ${post.slug}`)
      }
      console.log(`\n${fixed} von ${affectedPosts.size} Artikeln neu verlinkt.`)
    }
  }

  console.log('\nFertig.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
