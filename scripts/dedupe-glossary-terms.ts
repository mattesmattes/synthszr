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
 * Kriterium je Paar: der Begriff mit mehr Inhalt (Zeichenlaenge von summary +
 * extrahiertem body-Text) bleibt, bei Gleichstand der AELTERE. Der andere wird
 * auf status='hidden' gesetzt, sein canonical_name UND seine eigenen Aliasse
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
import { normalizeSlugForDedup, isValidTipTapDoc, extractPlainText } from '@/lib/glossary/generate'
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

interface FullRow extends SlugRow {
  aliases: string[]
  summary: string
  body: unknown
}

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

/** Inhaltslaenge fuer die Gewinner-Entscheidung: summary + extrahierter
 *  Klartext des body. extractPlainText statt roher JSON-Laenge, sonst zaehlt
 *  Struktur-Overhead (Knoten-Verschachtelung) statt tatsaechlichem Inhalt mit. */
function contentLength(summary: string, body: unknown): number {
  if (isValidTipTapDoc(body)) return summary.length + extractPlainText(body).length
  return summary.length + JSON.stringify(body ?? '').length
}

/** Merged Aliasse zweier Begriffe: Aliasse des Gewinners + Aliasse des
 *  Verlierers + der canonical_name des Verlierers selbst (der explizit
 *  geforderte Teil - er ist unter diesem Namen bekannt und gesucht worden).
 *  Case-insensitive dedupliziert, der eigene canonical_name des Gewinners
 *  fliegt raus (er ist ueber canonical_name selbst schon abgedeckt). */
function mergeAliases(
  winner: { canonical_name: string; aliases: string[] },
  loser: { canonical_name: string; aliases: string[] },
): string[] {
  const canonLower = winner.canonical_name.trim().toLowerCase()
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [...winner.aliases, ...loser.aliases, loser.canonical_name]) {
    const alias = raw.trim()
    if (!alias) continue
    const key = alias.toLowerCase()
    if (key === canonLower || seen.has(key)) continue
    seen.add(key)
    out.push(alias)
  }
  return out
}

interface Decision {
  winner: FullRow
  losers: FullRow[]
  reasoning: string[]
}

function decidePair(rows: FullRow[]): Decision {
  const scored = rows
    .map((row) => ({ row, len: contentLength(row.summary, row.body) }))
    .sort((a, b) => b.len - a.len || (a.row.created_at < b.row.created_at ? -1 : 1))
  const winner = scored[0].row
  const losers = scored.slice(1).map((s) => s.row)
  const reasoning = scored.map((s, i) =>
    `${i === 0 ? 'GEWINNER' : 'versteckt '} ${s.row.slug} ("${s.row.canonical_name}"): ` +
    `${s.len} Zeichen Inhalt, erstellt ${s.row.created_at}`,
  )
  return { winner, losers, reasoning }
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

  const decisions: Decision[] = []
  for (const group of dupeGroups) {
    const rows = group.map((g) => bySlug.get(g.slug)).filter((r): r is FullRow => Boolean(r))
    if (rows.length < 2) continue
    decisions.push(decidePair(rows))
  }

  console.log('Entscheidungen:\n')
  for (const d of decisions) {
    console.log(`Paar (normalisiert gleich): ${d.winner.slug}, ${d.losers.map((l) => l.slug).join(', ')}`)
    for (const line of d.reasoning) console.log(`  ${line}`)
    console.log('')
  }

  console.log('Verlinkungs-Check (Artikel mit glossaryLink-Mark auf den zu versteckenden Slug):')
  const linkedArticlesByLoser = new Map<string, Array<{ id: string; slug: string }>>()
  let totalLinkedArticles = 0
  for (const d of decisions) {
    for (const loser of d.losers) {
      const posts = await findLinkingArticles(loser.slug)
      linkedArticlesByLoser.set(loser.slug, posts)
      totalLinkedArticles += posts.length
      console.log(
        `  ${loser.slug}: ${posts.length} Artikel` +
        (posts.length ? ` - ${posts.map((p) => p.slug).join(', ')}` : ''),
      )
    }
  }
  console.log(`\n${totalLinkedArticles} Artikel-Verlinkungen insgesamt betroffen (auf zu versteckende Slugs).`)

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
  for (const posts of linkedArticlesByLoser.values()) {
    for (const p of posts) affectedPosts.set(p.id, p)
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
