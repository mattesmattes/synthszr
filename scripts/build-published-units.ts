#!/usr/bin/env npx tsx
/**
 * Backfill published_units — die Einheiten-Ground-Truth für Archivbrief,
 * Präzedenzfälle (Task 11) und Baseline (Task 15).
 *
 * Je Post mit status='published': Top-Level-H2-Einheiten per
 * extractPublishedUnits, Embedding aus prepareTextForEmbedding(heading,
 * firstParagraph) ohne Quelle, idempotent je Post `delete where post_id` +
 * `insert`. Die Entscheidungen je Post (kaputt / leer / Embedding-Fehler /
 * Abbruchschwelle) liegen getestet in scripts/lib/published-units-backfill.ts;
 * dieses Script ist nur die Schleife mit Pagination und Logausgabe.
 *
 * Flags:
 *   --dry-run          nichts schreiben, keine Embeddings erzeugen; nur zählen
 *   --since YYYY-MM-DD nur Posts mit published_at >= Datum (auch --since=…)
 *   --limit N          höchstens N Posts (Probelauf; auch --limit=N)
 *
 * Lauf: pnpm exec tsx scripts/build-published-units.ts --dry-run --limit=5
 *       (gegen ~/.synthszr.env.prod, sonst .env.local)
 * Ohne --dry-run schreibt das Script in die Produktions-DB und erzeugt
 * Embeddings (Gemini, kostet wenig) — nur mit Betreiber-Freigabe.
 */
import { config } from 'dotenv'
import { existsSync } from 'node:fs'
const prodEnv = `${process.env.HOME}/.synthszr.env.prod`
config({ path: existsSync(prodEnv) ? prodEnv : '.env.local', quiet: true })

// Vertrag 0: generated_posts.content in Seiten von 200 — die content-Zeilen
// sind groß (TipTap-JSON), größere Seiten treiben Egress und Antwortgröße.
const PAGE = 200
const PROGRESS_EVERY = 50
const EMBED_BATCH = 16 // wie dedupeByTopic (lib/news-queue/semantic-dedup.ts:197)

async function main() {
  const { parseBuildArgs, processPost, createEmbedFailGuard } = await import('./lib/published-units-backfill')
  const args = parseBuildArgs(process.argv.slice(2))
  if (!args) {
    // WARUM: ein Tippfehler in --since/--limit darf nicht still zum Volllauf
    // mit Embedding-Kosten werden — lieber hart abbrechen.
    console.warn('[Curation] WARNUNG: --since (YYYY-MM-DD) oder --limit (positive ganze Zahl) ist ungültig oder ohne Wert — Abbruch statt versehentlichem Volllauf.')
    process.exit(1)
  }

  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { generateEmbeddings } = await import('@/lib/embeddings/generator')
  const supabase = createAdminClient()
  const embed = (texts: string[]) => generateEmbeddings(texts, { batchSize: EMBED_BATCH })
  const guard = createEmbedFailGuard()

  console.log(`[Curation] build-published-units: ${args.dryRun ? 'DRY-RUN' : 'SCHREIBEND'}${args.since ? `, seit ${args.since}` : ''}${args.limit ? `, max ${args.limit} Posts` : ''}`)

  const t0 = Date.now()
  let posts = 0
  let unitsTotal = 0
  let postsWithoutUnits = 0
  let broken = 0
  let failedPosts = 0
  let embedded = 0

  const progressLine = () => {
    const mins = ((Date.now() - t0) / 60000).toFixed(1)
    return `${posts} Posts · ${unitsTotal} Einheiten · ${postsWithoutUnits} ohne Einheit · ${broken} kaputt · ${failedPosts} Embedding-Fehler · ${embedded} Embeddings (${mins} min)`
  }

  let offset = 0
  while (true) {
    // Seitengröße bei --limit kappen: 200 volle content-Zeilen für einen
    // 5er-Probelauf wären unnötiger Egress.
    const size = args.limit !== undefined ? Math.min(PAGE, args.limit - posts) : PAGE
    if (size <= 0) break

    // Reihenfolge published_at (Vertrag 2.6), id als Tiebreaker, damit die
    // .range()-Seiten stabil bleiben.
    let query = supabase.from('generated_posts')
      .select('id, title, content, published_at')
      .eq('status', 'published')
    if (args.since) query = query.gte('published_at', args.since)
    const { data, error } = await query
      .order('published_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + size - 1)
    if (error) throw new Error(`generated_posts: ${error.message}`)
    if (!data || data.length === 0) break

    for (const post of data) {
      posts++
      const postId = post.id as string
      const publishedAt = (post.published_at as string | null) ?? null
      const outcome = await processPost(supabase, embed, { id: postId, content: post.content, published_at: publishedAt }, args.dryRun)

      // Kein `continue` in dieser Schleife: die Fortschrittszeile unten muss
      // für JEDEN Post erreicht werden, sonst fehlen bei Post 50/100/… mit
      // kaputtem Content still ganze Fortschrittsschritte.
      if (outcome.kind === 'broken') {
        broken++
        console.warn(`[Curation] ${postId} content ist kein gültiges JSON (übersprungen, alter Stand bleibt)`)
      } else {
        unitsTotal += outcome.units.length
        if (outcome.units.length === 0) postsWithoutUnits++
        if (outcome.kind === 'written') embedded += outcome.embedded
        if (outcome.kind === 'embed_failed') {
          failedPosts++
          console.error(`[Curation] ${postId} Embedding fehlgeschlagen (Post übersprungen, alter Stand bleibt): ${outcome.error}`)
        }
        if (outcome.kind === 'dry_run' && posts <= 3) {
          console.log(`\n[Curation] ${postId} · ${String(publishedAt ?? '').slice(0, 10)} · "${String(post.title ?? '').slice(0, 60)}" · ${outcome.units.length} Einheiten`)
          for (const u of outcome.units) {
            console.log(`  [${u.position}] ${u.bundleType ?? '-'} · ${u.memberIds.length} IDs · ${u.heading.slice(0, 70)} · Absatz ${u.firstParagraph.length} Zeichen`)
          }
        }
      }
      if (guard.record(outcome)) {
        throw new Error(`[Curation] ABBRUCH: ${guard.consecutive()} Embedding-Fehler in Folge — GOOGLE_GENERATIVE_AI_API_KEY/Gemini prüfen, dann erneut starten (idempotent). Stand: ${progressLine()}`)
      }

      if (posts % PROGRESS_EVERY === 0) console.log(`[Curation] ${progressLine()}`)
    }

    if (data.length < size) break // letzte Seite war nicht voll
    offset += data.length
  }

  const mins = ((Date.now() - t0) / 60000).toFixed(1)
  console.log(`[Curation] FERTIG${args.dryRun ? ' (DRY-RUN, nichts geschrieben)' : ''}: ${posts} Posts, ${unitsTotal} Einheiten, ${postsWithoutUnits} Posts ohne Einheit, ${broken} kaputte content-Zeilen, ${failedPosts} Embedding-Fehler, ${embedded} Embeddings geschrieben (${mins} min)`)
  if (failedPosts > 0) console.warn('[Curation] WARNUNG: mind. ein Post ohne Embedding übersprungen — Script erneut laufen lassen (idempotent).')
  if (posts > 0 && unitsTotal === 0) console.warn('[Curation] WARNUNG: kein einziges H2 mit level=2 gefunden — stimmt die Heading-Struktur der Posts?')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
