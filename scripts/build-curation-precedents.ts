#!/usr/bin/env npx tsx
/**
 * Backfill der Präzedenzfälle (curation_precedents) aus den manuellen
 * article_jobs × published_units — Curation Phase 0, Task 11.
 *
 * Welche Jobs: pickPrecedentJobs (lib/curation/precedents.ts, getestet) —
 * je Berlin-Tag der JÜNGSTE Job mit source='manual' und veröffentlichtem
 * Post; übersprungen und gezählt: no_post, not_published, superseded,
 * no_units, no_attributable_units, no_selected. Je verarbeitetem Job:
 *   - selected_items[].id → news_queue (Label, Metadaten, daily_repo_id)
 *     → daily_repo.embedding; Hand-Entscheidung über isHandItem mit den
 *     queue_item_events BIS job.created_at (eventsAsOf; historisch leer →
 *     metadata-Fallback)
 *   - Pool „nie gewählt": news_queue.queued_at in [created_at − 48 h, created_at)
 *   - Einheiten: published_units des Posts (Task 10 muss gelaufen sein),
 *     seitenweise gelesen (PostgREST kappt still bei 1000 Zeilen)
 *   - classifyPrecedents → replacePrecedentDay
 *
 * Der Lauf ERSETZT je Berlin-Tag (delete where day, dann Upsert), statt zu
 * mischen; Tage aus dem Job-Bereich, die pickPrecedentJobs nicht mehr
 * wählt (Post archiviert, neu no_units …), werden geleert (stale_days).
 * Tage vor --since bleiben unberührt.
 *
 * VORBEHALT (Task 15 Entscheidung 23): Vor Phase 0 kann selected_items
 * Füll-Items aus getBalancedSelection enthalten (lib/claude/queue-article.ts:263-284);
 * ohne Events fallen sie auf 'operator' zurück und landen, wenn sie nicht
 * liefen, in dropped_after_selection. Historisch nicht trennbar; ab Phase 0
 * tragen sie ein select-Event mit actor 'pipeline' vor created_at und
 * werden über eventsAsOf zu pending_never_selected.
 *
 * Voraussetzung auch für --dry-run: Migration Task 1 auf Prod
 * (published_units, queue_item_events, curation_precedents) und
 * build-published-units (Task 10) geschrieben.
 *
 * Schreibt NUR curation_precedents. Ohne --dry-run ist das ein Prod-Write
 * (Betreiber-Freigabe). Flags: --dry-run, --since=YYYY-MM-DD (oder
 * --since YYYY-MM-DD). Alle Ausgaben tragen das Prefix [Curation] (Vertrag 0,
 * wie build-published-units); console.table bleibt ohne Prefix.
 * Entscheidungslogik (Tageswahl, Löschmenge, --since, Label-Fallback,
 * as-of) steht getestet in lib/curation/precedents.ts — hier nur Laden,
 * Zählen, Schreiben.
 *
 * Lauf: pnpm curation:precedents -- --dry-run      (gegen ~/.synthszr.env.prod)
 */
import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import type { PrecedentJob, PrecedentQueueRow, PrecedentRow, PrecedentUnit } from '@/lib/curation/precedents'
const prodEnv = `${process.env.HOME}/.synthszr.env.prod`
config({ path: existsSync(prodEnv) ? prodEnv : '.env.local', quiet: true })

// WARUM 200: .in()-Listen ab ~400 UUIDs lösen gegen Prod einen
// HeadersOverflowError (undici) aus (scripts/lib/taste-ground-truth.ts:7-11).
// article_jobs.selected_items ist jsonb mit Volltext — darum auch dort 200.
const PAGE = 200
const IN_CHUNK = 200
// WARUM eigene Seiten für published_units: 200 Posts × 9–10 H2 ≈ 2000 Zeilen,
// PostgREST kappt still bei 1000 (supabase/config.toml:18). Zeilen tragen ein
// 768er-Embedding, also nicht „schmal" → Seiten à 200 (Entscheidung 13).
const UNITS_PAGE = 200
const POOL_PAGE = 1000 // schmale Zeilen (nur id), PostgREST-Cap
const POOL_WINDOW_MS = 48 * 3600 * 1000
const PROGRESS_EVERY = 50

interface UnitRow {
  post_id: string
  position: number
  heading: string
  bundle_type: string | null
  member_ids: string[] | null
  embedding: unknown
}

async function main() {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { loadEventsForItems } = await import('@/lib/news-queue/events')
  const {
    buildPrecedentSelected, classifyPrecedents, parseSinceArg, pickPrecedentJobs, precedentJobsSince,
    precedentSelectedItems, replacePrecedentDay, staleDaysOf,
  } = await import('@/lib/curation/precedents')
  const { parseEmbedding } = await import('@/lib/news-queue/semantic-dedup')
  const supabase = createAdminClient()

  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const since = parseSinceArg(argv)
  if (since === null) {
    // WARUM: ein Tippfehler im Datum darf nicht still zum Volllauf werden,
    // der im Schreib-Lauf jeden Tag ersetzt (parseSinceArg, getestet).
    console.warn('[Curation] WARNUNG: --since ist ungültig oder ohne Wert (erwartet YYYY-MM-DD) — Abbruch statt versehentlichem Volllauf.')
    process.exit(1)
  }
  console.log(`[Curation] build-curation-precedents: ${dryRun ? 'DRY-RUN (kein Write)' : 'WRITE'}${since ? `, seit ${since}` : ''}`)

  // 1) Manuelle Jobs seitenweise (selected_items ist jsonb mit Volltext → PAGE 200),
  //    aufsteigend nach created_at.
  const jobsRaw: PrecedentJob[] = []
  for (let offset = 0; ; offset += PAGE) {
    let q = supabase.from('article_jobs')
      .select('id, created_at, generated_post_id, selected_items')
      .eq('source', 'manual')
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1)
    // Konservative Untergrenze: Berlin-Mitternacht liegt bei 22:00Z (CEST)
    // oder 23:00Z (CET); +02:00 ist nie zu spät, im Winter eine Stunde zu
    // früh — den exakten Berlin-Tag schneidet precedentJobsSince (getestet).
    if (since) q = q.gte('created_at', `${since}T00:00:00+02:00`)
    const { data, error } = await q
    if (error) throw new Error(`article_jobs: ${error.message}`)
    if (!data || data.length === 0) break
    jobsRaw.push(...(data as PrecedentJob[]))
    if (data.length < PAGE) break
  }
  const jobs = precedentJobsSince(jobsRaw, since)

  // 2) Post-Status + Einheiten in Scheiben à 200 Posts (nur Jobs mit Post).
  const postIds = [...new Set(jobs.map((j) => j.generated_post_id).filter((id): id is string => !!id))]
  const postStatusById = new Map<string, string>()
  const unitsByPost = new Map<string, PrecedentUnit[]>()
  for (let i = 0; i < postIds.length; i += IN_CHUNK) {
    const chunk = postIds.slice(i, i + IN_CHUNK)
    const { data: posts, error: postsError } = await supabase.from('generated_posts')
      .select('id, status').in('id', chunk)
    if (postsError) throw new Error(`generated_posts: ${postsError.message}`)
    for (const p of (posts ?? []) as Array<{ id: string; status: string }>) postStatusById.set(p.id, p.status)

    // Seitenweise mit eindeutiger Sortierung (post_id, position — unique je
    // Post), damit .range() keine Zeile doppelt liefert oder auslässt
    // (Entscheidung 13). Die Reihenfolge je Post bleibt aufsteigend nach position.
    for (let offset = 0; ; offset += UNITS_PAGE) {
      const { data: units, error: unitsError } = await supabase.from('published_units')
        .select('post_id, position, heading, bundle_type, member_ids, embedding')
        .in('post_id', chunk)
        .order('post_id', { ascending: true })
        .order('position', { ascending: true })
        .range(offset, offset + UNITS_PAGE - 1)
      if (unitsError) throw new Error(`published_units: ${unitsError.message}`)
      for (const u of (units ?? []) as UnitRow[]) {
        const emb = parseEmbedding(u.embedding)
        const list = unitsByPost.get(u.post_id) ?? []
        list.push({
          position: u.position,
          heading: u.heading,
          bundleType: u.bundle_type ?? null,
          memberIds: u.member_ids ?? [],
          embedding: emb.length > 0 ? emb : null,
        })
        unitsByPost.set(u.post_id, list)
      }
      if (!units || units.length < UNITS_PAGE) break
    }
  }

  // 3) Welche Jobs klassifiziert werden — reine, getestete Regel (Review-Fokus 2).
  //    Nur pick.byDay geht in classifyPrecedents; jeder Skip-Grund wird gezählt.
  const pick = pickPrecedentJobs(jobs, postStatusById, unitsByPost)

  // 4) Je Job: Eingaben sammeln, klassifizieren, Tag ersetzen.
  const counts: Record<PrecedentRow['stage'], number> = {
    published: 0, dropped_after_selection: 0, pending_never_selected: 0, merged: 0,
  }
  let processed = 0
  let missingInQueue = 0
  let poolInUnits = 0
  let unattributableUnits = 0
  let unattributableExcluded = 0
  let failedDays = 0
  let rowsWritten = 0
  const t0 = Date.now()

  for (const [day, job] of pick.byDay) {
    const postId = job.generated_post_id as string
    const units = unitsByPost.get(postId) ?? [] // nicht leer, pickPrecedentJobs prüft das
    const items = precedentSelectedItems(job.selected_items) // nicht leer, dito
    const selectedIds = items.map((p) => p.id)
    const selectedSet = new Set(selectedIds)

    try {
      // 4a) news_queue-Zeilen (Label-Fallback, Metadaten, daily_repo_id).
      const queueById = new Map<string, PrecedentQueueRow>()
      for (let i = 0; i < selectedIds.length; i += IN_CHUNK) {
        const { data, error } = await supabase.from('news_queue')
          .select('id, bundle_type, metadata, daily_repo_id')
          .in('id', selectedIds.slice(i, i + IN_CHUNK))
        if (error) throw new Error(`news_queue: ${error.message}`)
        for (const r of (data ?? []) as PrecedentQueueRow[]) queueById.set(r.id, r)
      }
      missingInQueue += selectedIds.filter((id) => !queueById.has(id)).length

      // 4b) daily_repo.embedding (Techmeme/ohne daily_repo_id → null).
      const repoIds = [...new Set([...queueById.values()].map((r) => r.daily_repo_id).filter((x): x is string => !!x))]
      const embByRepo = new Map<string, number[]>()
      for (let i = 0; i < repoIds.length; i += IN_CHUNK) {
        const { data, error } = await supabase.from('daily_repo')
          .select('id, embedding')
          .in('id', repoIds.slice(i, i + IN_CHUNK))
          .not('embedding', 'is', null)
        if (error) throw new Error(`daily_repo: ${error.message}`)
        for (const r of (data ?? []) as Array<{ id: string; embedding: unknown }>) {
          const emb = parseEmbedding(r.embedding)
          if (emb.length > 0) embByRepo.set(r.id, emb)
        }
      }

      // 4c) Label, Embedding und Hand-Entscheidung je Item (buildPrecedentSelected,
      //     getestet). WARUM Events as-of job.created_at: ein später vom
      //     Nachtlauf neu gewähltes Item verlöre sonst rückwirkend seinen
      //     Hand-Status (Task 4 Entscheidung 2) und fiele aus der Negativmenge —
      //     bei jedem erneuten Backfill-Lauf ein Stück mehr.
      //     loadEventsForItems wirft bei DB-Fehler → catch unten → failed_days.
      const events = await loadEventsForItems(supabase, selectedIds)
      const selected = buildPrecedentSelected(items, queueById, embByRepo, events, job.created_at)

      // 4d) Pool „nie gewählt": [created_at − 48 h, created_at), nur IDs.
      //     Halboffen wie Task 15 (loadDayInputs, Vertrag 2.10 „queued_at < asOf").
      const jobAt = new Date(job.created_at)
      const poolFrom = new Date(jobAt.getTime() - POOL_WINDOW_MS).toISOString()
      const pool: string[] = []
      for (let offset = 0; ; offset += POOL_PAGE) {
        const { data, error } = await supabase.from('news_queue')
          .select('id')
          .gte('queued_at', poolFrom)
          .lt('queued_at', jobAt.toISOString())
          .order('id', { ascending: true })
          .range(offset, offset + POOL_PAGE - 1)
        if (error) throw new Error(`news_queue (pool): ${error.message}`)
        for (const r of (data ?? []) as Array<{ id: string }>) if (!selectedSet.has(r.id)) pool.push(r.id)
        if (!data || data.length < POOL_PAGE) break
      }

      // 4e) Klassifizieren und den Tag ersetzen.
      const rows = classifyPrecedents({
        day,
        jobId: job.id,
        postId,
        selected,
        poolNeverSelected: pool,
        publishedUnits: units,
      })
      let selectedRows = 0
      for (const r of rows) {
        counts[r.stage]++
        if (selectedSet.has(r.item_id)) selectedRows++
        // Entscheidung 6: Pool-Item, das im Post lief (Marker ohne selected_items-Eintrag).
        else if (r.stage === 'published') poolInUnits++
      }
      // Entscheidung 7: Hand-Items, die einer Einheit ohne Marker zugeordnet
      // wurden, bekommen keine Zeile — hier sichtbar machen.
      unattributableUnits += units.filter((u) => u.memberIds.length === 0).length
      unattributableExcluded += selectedIds.length - selectedRows

      // Entscheidung 12: delete where day, dann Upsert — kein Mischen mit
      // Zeilen früherer Läufe/Jobs.
      if (!dryRun) rowsWritten += await replacePrecedentDay(supabase, day, rows)
      processed++
      if (processed % PROGRESS_EVERY === 0) {
        const mins = ((Date.now() - t0) / 60000).toFixed(1)
        console.log(`[Curation] ${processed} Jobs verarbeitet, ${rowsWritten} Zeilen geschrieben (${mins} min)`)
      }
    } catch (err) {
      failedDays++
      console.error(`[Curation] ${day} ${job.id} Tag fehlgeschlagen (übersprungen): ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 5) Veraltete Tage leeren (Entscheidung 12): Berlin-Tage aus dem Job-Bereich
  //    (jobs ist schon auf --since geschnitten), die pickPrecedentJobs nicht
  //    (mehr) wählt — z. B. Post inzwischen archiviert oder neu no_units. Sonst
  //    blieben deren alte Zeilen stehen. Löschmenge = staleDaysOf (getestet).
  const staleDays = staleDaysOf(jobs, pick)
  let staleCleared = 0
  if (!dryRun) {
    for (const d of staleDays) {
      try {
        await replacePrecedentDay(supabase, d, [])
        staleCleared++
      } catch (err) {
        failedDays++
        console.error(`[Curation] ${d} Leeren fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  console.table({
    jobs_manual: jobs.length,
    skipped_no_post: pick.skipped.no_post,
    skipped_not_published: pick.skipped.not_published,
    skipped_superseded: pick.skipped.superseded,
    skipped_no_units: pick.skipped.no_units,
    skipped_no_attributable_units: pick.skipped.no_attributable_units,
    skipped_no_selected: pick.skipped.no_selected,
    failed_days: failedDays,
    processed,
    stale_days: staleDays.length,
    stale_days_cleared: staleCleared,
    missing_in_news_queue: missingInQueue,
    pool_in_units: poolInUnits,
    unattributable_units: unattributableUnits,
    unattributable_excluded: unattributableExcluded,
    published: counts.published,
    merged: counts.merged,
    dropped_after_selection: counts.dropped_after_selection,
    pending_never_selected: counts.pending_never_selected,
    rows_written: rowsWritten,
  })
  console.log(`[Curation] FERTIG: ${processed} Jobs, ${rowsWritten} Zeilen ${dryRun ? '(DRY-RUN, nichts geschrieben)' : 'geschrieben (je Tag ersetzt)'}.`)
  console.log('[Curation] VORBEHALT: dropped_after_selection vor Phase 0 kann Füll-Items aus getBalancedSelection enthalten (nicht trennbar, Task 15 Entscheidung 23).')
  // WARUM kein pnpm-Alias im Hinweis: curation:units trägt erst Task 15 in package.json ein.
  if (pick.skipped.no_units > 0) console.warn(`[Curation] WARNUNG: ${pick.skipped.no_units} Posts ohne published_units — erst pnpm tsx scripts/build-published-units.ts laufen lassen, dann erneut.`)
  if (failedDays > 0) console.warn('[Curation] WARNUNG: mind. ein Tag fehlgeschlagen (ggf. leer) — Log prüfen, erneut laufen lassen (ersetzt je Tag).')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
