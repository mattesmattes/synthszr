/**
 * Messung der Synthszr Takes (Take-Reform 2026-10-19, „Messen vor und nach
 * jeder Stufe"): liest die letzten N veröffentlichten Posts aus Prod und
 * berechnet die Kennzahlen, an denen die Reform gemessen wird — Form (Wörter,
 * Wörter je Satz, kurze Sätze, Doppelpunkte), Präzision (Zahl im Take und im
 * Schlusssatz, Prognosen), Betreiber-Edits (Überleben des letzten Satzes vom
 * KI-Entwurf zur Veröffentlichung) und Leser-Zustimmung (take_feedback).
 *
 *   pnpm takes:measure                 # letzte 20 Posts
 *   pnpm takes:measure -- --posts 40
 *   pnpm takes:measure -- --since 2026-10-20   # nur Posts ab Datum (z. B. ab Reform)
 *   pnpm takes:measure -- --json       # Kennzahlen als JSON
 *
 * Lesend; Env wie die anderen Curation-Scripts (~/.synthszr.env.prod vor .env.local).
 */
import { config } from 'dotenv'
import { existsSync } from 'node:fs'
import { splitSentences, countWords } from '@/lib/claude/take-cap'

const prodEnv = `${process.env.HOME}/.synthszr.env.prod`
config({ path: existsSync(prodEnv) ? prodEnv : '.env.local' })

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function textOf(n: unknown): string {
  if (!n || typeof n !== 'object') return ''
  const node = n as { text?: string; content?: unknown[] }
  return (node.text ?? '') + (Array.isArray(node.content) ? node.content.map(textOf).join('') : '')
}

interface Section { heading: string; anchor: string; take: string | null }
function sectionsOf(doc: unknown): Section[] {
  const content = (doc as { content?: unknown[] } | null)?.content
  if (!Array.isArray(content)) return []
  const out: Section[] = []
  let cur: Section | null = null
  let takeIndex = 0
  for (const raw of content) {
    const n = raw as { type?: string; attrs?: { level?: number; queueItemId?: string | null } }
    if (n.type === 'heading' && n.attrs?.level === 2) { cur = { heading: textOf(n).trim(), anchor: n.attrs.queueItemId ?? '', take: null }; out.push(cur); continue }
    if (n.type !== 'paragraph' || !cur) continue
    const m = textOf(n).match(/^\s*Synthszr Take:\s*([\s\S]*)$/i)
    if (m) { cur.take = m[1].trim(); if (!cur.anchor) cur.anchor = `idx:${takeIndex}`; takeIndex++ }
  }
  return out
}

const parse = (c: unknown) => { try { return typeof c === 'string' ? JSON.parse(c) : c } catch { return null } }
const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0)
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

async function main() {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()
  const limit = Number(arg('--posts') ?? 20)
  const since = arg('--since')
  const asJson = process.argv.includes('--json')

  let q = supabase.from('generated_posts').select('id, title, published_at, content').eq('status', 'published').order('published_at', { ascending: false }).limit(limit)
  if (since) q = q.gte('published_at', since)
  const { data: posts, error } = await q
  if (error) throw new Error(error.message)

  const takes: Array<{ postId: string; anchor: string; take: string }> = []
  const draftLast: Array<{ kept: boolean }> = []
  for (const p of posts ?? []) {
    const pub = sectionsOf(parse(p.content))
    for (const s of pub) if (s.take) takes.push({ postId: p.id, anchor: s.anchor, take: s.take })
    // Entwurf (erste edit_history-Fassung) → überlebt der letzte Entwurfssatz?
    const { data: hist } = await supabase.from('edit_history').select('content_before').eq('post_id', p.id).order('created_at', { ascending: true }).limit(1)
    const draft = sectionsOf(parse(hist?.[0]?.content_before))
    for (const d of draft) {
      if (!d.take) continue
      const match = pub.find((s) => s.heading === d.heading && s.take)
      if (!match?.take) continue
      const last = splitSentences(d.take).at(-1)
      if (last) draftLast.push({ kept: match.take.includes(last.slice(0, 40)) })
    }
  }

  const { data: fb } = await supabase.from('take_feedback').select('post_id, section_anchor, vote').in('post_id', (posts ?? []).map((p) => p.id))
  const votes = new Map<string, { a: number; d: number }>()
  for (const r of fb ?? []) { const k = `${r.post_id}|${r.section_anchor}`; const v = votes.get(k) ?? { a: 0, d: 0 }; r.vote === 'agree' ? v.a++ : v.d++; votes.set(k, v) }

  const sentences = takes.flatMap((t) => splitSentences(t.take))
  const wps = sentences.map(countWords)
  const lastSentences = takes.map((t) => splitSentences(t.take).at(-1) ?? '')
  let agree = 0, disagree = 0
  for (const t of takes) { const v = votes.get(`${t.postId}|${t.anchor}`); if (v) { agree += v.a; disagree += v.d } }

  const m = {
    posts: posts?.length ?? 0,
    takes: takes.length,
    woerter_p50: median(takes.map((t) => countWords(t.take))),
    saetze_p50: median(takes.map((t) => splitSentences(t.take).length)),
    woerter_je_satz_p50: median(wps),
    anteil_saetze_ueber_25: pct(wps.filter((w) => w > 25).length, wps.length),
    anteil_takes_mit_kurzem_satz: pct(takes.filter((t) => splitSentences(t.take).some((s) => countWords(s) < 8)).length, takes.length),
    anteil_takes_mehr_als_ein_doppelpunkt: pct(takes.filter((t) => (t.take.match(/:/g) ?? []).length > 1).length, takes.length),
    anteil_takes_mit_zahl: pct(takes.filter((t) => /\d/.test(t.take)).length, takes.length),
    anteil_schlusssatz_mit_zahl: pct(lastSentences.filter((s) => /\d/.test(s)).length, lastSentences.length),
    anteil_takes_mit_prognose: pct(takes.filter((t) => /\b(wird|werden)\b/.test(t.take)).length, takes.length),
    anteil_auftakt_eigentliche: pct(takes.filter((t) => /^(Der|Die|Das) eigentliche\b/.test(t.take)).length, takes.length),
    letzter_entwurfssatz_ueberlebt: draftLast.length ? pct(draftLast.filter((d) => d.kept).length, draftLast.length) : null,
    leser_votes: agree + disagree,
    leser_zustimmung: agree + disagree ? pct(agree, agree + disagree) : null,
  }
  if (asJson) { console.log(JSON.stringify(m, null, 2)); return }
  console.log(`Takes: ${m.takes} aus ${m.posts} Posts${since ? ` ab ${since}` : ''}`)
  console.table(m)
}

main().catch((err) => { console.error(err); process.exit(1) })
