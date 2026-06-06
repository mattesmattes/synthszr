#!/usr/bin/env npx tsx
/**
 * Backfill podcast show notes for episodes published on a given date.
 *
 * Episodes published before the show-notes-persistence change have no
 * show_notes / show_notes_short stored locally. This script fetches the real
 * summary from Podigee, shortens it to ~50% via Haiku, and writes both fields
 * to all post_podcasts rows of that episode (one Podigee episode → several
 * locale rows). Idempotent: re-running overwrites.
 *
 * Env: loads .env.backfill.local (pull via `vercel env pull`).
 * Usage: npx tsx scripts/backfill-podcast-shownotes.ts 2026-06-06
 */
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { summarizeShowNotes } from '@/lib/podcast/show-notes'

config({ path: '.env.backfill.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const PODIGEE_API_KEY = process.env.PODIGEE_API_KEY || ''
const PODIGEE_BASE = 'https://app.podigee.com/api/v1'

/** Strip HTML tags + collapse whitespace — Podigee may return rich-text summaries. */
function toPlainText(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

async function podigeeEpisode(id: number): Promise<{ title?: string; subtitle?: string; summary?: string; description?: string }> {
  const res = await fetch(`${PODIGEE_BASE}/episodes/${id}`, {
    headers: { Token: PODIGEE_API_KEY, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`Podigee GET /episodes/${id} → ${res.status} ${await res.text().catch(() => '')}`)
  return res.json()
}

async function main() {
  const date = process.argv[2]
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('Usage: npx tsx scripts/backfill-podcast-shownotes.ts <YYYY-MM-DD>')
    process.exit(1)
  }
  if (!SUPABASE_URL || !SERVICE_KEY || !PODIGEE_API_KEY) {
    console.error('Missing env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / PODIGEE_API_KEY). Run `vercel env pull .env.backfill.local --environment=production`.')
    process.exit(1)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  const { data: rows, error } = await supabase
    .from('post_podcasts')
    .select('id, locale, podigee_episode_id, podigee_published_at')
    .not('podigee_episode_id', 'is', null)
    .gte('podigee_published_at', `${date}T00:00:00Z`)
    .lt('podigee_published_at', `${date}T23:59:59.999Z`)

  if (error) throw error
  if (!rows || rows.length === 0) {
    console.log(`No published episodes found for ${date}.`)
    return
  }

  // One Podigee episode can back several locale rows — group by episode id.
  const byEpisode = new Map<number, typeof rows>()
  for (const r of rows) {
    const k = r.podigee_episode_id as number
    if (!byEpisode.has(k)) byEpisode.set(k, [])
    byEpisode.get(k)!.push(r)
  }

  console.log(`Found ${rows.length} row(s) across ${byEpisode.size} episode(s) for ${date}.`)

  for (const [epId, group] of byEpisode) {
    const ep = await podigeeEpisode(epId)
    const raw = (ep.summary || ep.description || '').trim()
    const showNotes = toPlainText(raw)
    if (!showNotes) {
      console.warn(`Episode ${epId}: no summary on Podigee — skipping.`)
      continue
    }
    const short = await summarizeShowNotes(showNotes, 'en')
    const ids = group.map((g) => g.id)
    const { error: upErr } = await supabase
      .from('post_podcasts')
      .update({ show_notes: showNotes, show_notes_short: short, episode_title: ep.title ?? null, episode_subtitle: ep.subtitle ?? null })
      .in('id', ids)
    if (upErr) {
      console.error(`Episode ${epId}: update failed —`, upErr.message)
      continue
    }
    console.log(`Episode ${epId}: backfilled ${ids.length} row(s) [${group.map((g) => g.locale).join(', ')}]  full=${showNotes.length} → short=${short.length} chars`)
    console.log(`  short: ${short}`)
  }
  console.log('Done.')
}

main().catch((e) => { console.error(e); process.exit(1) })
