/**
 * Orchestriert einen vollstaendigen Dedupe-Lauf (Laden -> Erkennen -> Entscheiden
 * -> optional Schreiben) als importierbare Funktion — Gegenstueck zu
 * scripts/dedupe-glossary-terms.ts, das dieselbe Logik bisher nur als CLI mit
 * `main()` bei Modul-Import kannte (dotenv/argv/process.exit, nicht
 * routentauglich). lib/glossary/dedupe.ts bleibt bewusst reine
 * Entscheidungslogik (s. dessen Kopfkommentar) — diese Datei haelt die
 * Nebenwirkungen (DB-Reads/-Writes), damit beide Aufrufer (CLI-Skript,
 * Cron-Route app/api/cron/glossary-dedupe) dieselbe Funktion nutzen statt
 * zweier divergierender Implementierungen.
 *
 * Erkennung: veroeffentlichte Begriffe, deren Slug normalisiert (ohne
 * Bindestriche/End-"s", normalizeSlugForDedup) ODER deren canonical_name
 * normalisiert (getrimmt, kleingeschrieben) gleich ist. Gruppen aus beiden
 * Kriterien werden per Union-Find ueber gemeinsame Slugs zu disjunkten
 * Clustern vereinigt, damit ein Begriff nie in zwei widerspruechlichen
 * Entscheidungen landet. Kriterium je Cluster: decidePair() aus dedupe.ts
 * (Verlinkungen -> Inhaltslaenge -> Alter), unterstuetzt nativ >2 Kandidaten.
 *
 * Verlierer werden auf status='hidden' gesetzt (reversibel, kein
 * Datenverlust), ihr canonical_name plus eigene Aliasse wandern als Alias an
 * den Gewinner, betroffene generated_posts-Verlinkungen werden ueber
 * linkPostContent (lib/glossary/backfill.ts) neu injiziert — dieselbe
 * Mark-Logik wie ueberall sonst im Projekt, keine dritte Stelle, die Marks
 * schreibt.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { normalizeSlugForDedup } from '@/lib/glossary/generate'
import { decidePair, mergeAliases, type DedupeDecision, type DedupeRow } from '@/lib/glossary/dedupe'
import { linkPostContent } from '@/lib/glossary/backfill'
import { getMatcherTerms, getChartProductNames, buildReservedNames } from '@/lib/glossary/terms'
import { safeParseJSON } from '@/lib/utils/safe-json'

type AdminClient = ReturnType<typeof createAdminClient>

export interface SlugRow {
  id: string
  slug: string
  canonical_name: string
  created_at: string
}

export interface DedupeRunResult {
  publishedCount: number
  clusterCount: number
  decisions: Array<{
    winnerSlug: string
    winnerName: string
    loserSlugs: string[]
    criterion: DedupeDecision['decidingCriterion']
    reasoning: string[]
  }>
  markChangesNeeded: number
  applied: boolean
  hiddenSlugs: string[]
  articlesRelinked: number
  articlesAffected: number
  errors: string[]
}

async function loadPublishedSlugs(supabase: AdminClient): Promise<SlugRow[]> {
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

async function findLinkingArticles(
  supabase: AdminClient,
  slug: string,
): Promise<Array<{ id: string; slug: string }>> {
  const { data, error } = await supabase
    .from('generated_posts')
    .select('id, slug')
    .eq('status', 'published')
    .ilike('content', `%"attrs":{"slug":"${slug}"}%`)
  if (error) throw new Error(`Verlinkungs-Check fuer "${slug}" fehlgeschlagen: ${error.message}`)
  return (data ?? []) as Array<{ id: string; slug: string }>
}

/** Gruppiert veroeffentlichte Begriffe ueber Slug- UND Name-Normalisierung,
 *  vereinigt ueberlappende Gruppen per Union-Find zu disjunkten Clustern. */
export function buildClusters(published: SlugRow[]): SlugRow[][] {
  const normalizeName = (name: string) => name.trim().toLowerCase()
  const bySlugKey = new Map<string, SlugRow[]>()
  const byNameKey = new Map<string, SlugRow[]>()
  for (const row of published) {
    const sk = normalizeSlugForDedup(row.slug)
    const nk = normalizeName(row.canonical_name)
    ;(bySlugKey.get(sk) ?? bySlugKey.set(sk, []).get(sk)!).push(row)
    ;(byNameKey.get(nk) ?? byNameKey.set(nk, []).get(nk)!).push(row)
  }

  const parent = new Map<string, string>()
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x)
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)!
    let cur = x
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const g of [...bySlugKey.values(), ...byNameKey.values()]) {
    if (g.length < 2) continue
    for (let i = 1; i < g.length; i++) union(g[0].slug, g[i].slug)
  }

  const clusters = new Map<string, SlugRow[]>()
  for (const row of published) {
    if (!parent.has(row.slug)) continue
    const root = find(row.slug)
    ;(clusters.get(root) ?? clusters.set(root, []).get(root)!).push(row)
  }
  return [...clusters.values()].filter((g) => g.length > 1)
}

/**
 * Fuehrt einen vollstaendigen Dedupe-Lauf aus. `apply: false` (Default) liest
 * nur und berichtet, ohne zu schreiben — sicher fuer wiederholte Aufrufe.
 */
export async function runGlossaryDedupe(
  supabase: AdminClient,
  opts: { apply: boolean },
): Promise<DedupeRunResult> {
  const errors: string[] = []
  const published = await loadPublishedSlugs(supabase)
  const dupeGroups = buildClusters(published)

  const result: DedupeRunResult = {
    publishedCount: published.length,
    clusterCount: dupeGroups.length,
    decisions: [],
    markChangesNeeded: 0,
    applied: false,
    hiddenSlugs: [],
    articlesRelinked: 0,
    articlesAffected: 0,
    errors,
  }
  if (dupeGroups.length === 0) return result

  const affectedSlugs = dupeGroups.flat().map((r) => r.slug)
  const { data: fullRows, error: fullErr } = await supabase
    .from('glossary_terms')
    .select('id, slug, canonical_name, aliases, summary, body, created_at')
    .in('slug', affectedSlugs)
  if (fullErr) throw new Error(`Volle Begriffsdaten nicht ladbar: ${fullErr.message}`)
  const bySlug = new Map(((fullRows ?? []) as DedupeRow[]).map((r) => [r.slug, r]))

  const linkedArticlesBySlug = new Map<string, Array<{ id: string; slug: string }>>()
  for (const group of dupeGroups) {
    for (const g of group) {
      const posts = await findLinkingArticles(supabase, g.slug)
      linkedArticlesBySlug.set(g.slug, posts)
    }
  }
  const linkCounts = new Map(
    [...linkedArticlesBySlug.entries()].map(([slug, posts]) => [slug, posts.length]),
  )

  const decisions: DedupeDecision[] = []
  for (const group of dupeGroups) {
    const rows = group.map((g) => bySlug.get(g.slug)).filter((r): r is DedupeRow => Boolean(r))
    if (rows.length < 2) continue
    decisions.push(decidePair(rows, linkCounts))
  }

  for (const d of decisions) {
    result.decisions.push({
      winnerSlug: d.winner.slug,
      winnerName: d.winner.canonical_name,
      loserSlugs: d.losers.map((l) => l.slug),
      criterion: d.decidingCriterion,
      reasoning: d.reasoning,
    })
    for (const loser of d.losers) result.markChangesNeeded += linkCounts.get(loser.slug) ?? 0
  }

  if (!opts.apply) return result

  // --- Schreiblauf ---
  for (const d of decisions) {
    for (const loser of d.losers) {
      const mergedAliases = mergeAliases(d.winner, loser)

      const { error: hideErr } = await supabase
        .from('glossary_terms')
        .update({ status: 'hidden', updated_at: new Date().toISOString() })
        .eq('id', loser.id)
      if (hideErr) {
        errors.push(`Verstecken von ${loser.slug}: ${hideErr.message}`)
        continue
      }

      const { error: aliasErr } = await supabase
        .from('glossary_terms')
        .update({ aliases: mergedAliases, updated_at: new Date().toISOString() })
        .eq('id', d.winner.id)
      if (aliasErr) {
        errors.push(`Alias-Merge auf ${d.winner.slug}: ${aliasErr.message}`)
        continue
      }

      d.winner.aliases = mergedAliases
      result.hiddenSlugs.push(loser.slug)
    }
  }
  result.applied = true

  const affectedPosts = new Map<string, { id: string; slug: string }>()
  for (const d of decisions) {
    for (const loser of d.losers) {
      for (const p of linkedArticlesBySlug.get(loser.slug) ?? []) affectedPosts.set(p.id, p)
    }
  }
  result.articlesAffected = affectedPosts.size

  if (affectedPosts.size > 0) {
    const terms = await getMatcherTerms('de')
    if (terms === null) {
      errors.push(
        'Begriffsliste nach dem Schreiblauf nicht ladbar — Verlinkungen NICHT korrigiert. ' +
        'Status/Alias-Aenderungen sind bereits geschrieben; naechster Lauf findet keine ' +
        'Dubletten-Paare mehr und muss die Verlinkung separat nachziehen.',
      )
    } else {
      const reserved = buildReservedNames(await getChartProductNames())
      for (const post of affectedPosts.values()) {
        const { data: postRow, error: postErr } = await supabase
          .from('generated_posts')
          .select('content')
          .eq('id', post.id)
          .maybeSingle()
        if (postErr || !postRow) {
          errors.push(`Artikel ${post.slug} nicht ladbar`)
          continue
        }
        const parsed = typeof postRow.content === 'string' ? safeParseJSON(postRow.content) : postRow.content
        const relinkResult = linkPostContent(parsed, terms, reserved)
        if (!relinkResult.changed) continue
        const { error: upErr } = await supabase
          .from('generated_posts')
          .update({ content: JSON.stringify(relinkResult.content) })
          .eq('id', post.id)
        if (upErr) {
          errors.push(`${post.slug} nicht speicherbar: ${upErr.message}`)
          continue
        }
        result.articlesRelinked++
      }
    }
  }

  return result
}
