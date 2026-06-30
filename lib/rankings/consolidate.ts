import { createAdminClient } from '@/lib/supabase/admin'
import { mentionHash } from '@/lib/rankings/mention'

// Kern-Produkte, deren Sub-Funktionen (family beginnt mit dem Kern) zusammengeführt werden.
const CORES = [
  { fam: 'github copilot', name: 'GitHub Copilot', vendor: 'github' },
  { fam: 'claude code', name: 'Claude Code', vendor: 'anthropic' },
  { fam: 'microsoft copilot', name: 'Microsoft Copilot', vendor: 'microsoft' },
  { fam: 'cursor', name: 'Cursor', vendor: 'anysphere' },
  { fam: 'copilot', name: 'Copilot', vendor: 'github' },
]

type Sb = ReturnType<typeof createAdminClient>

/** Hängt alle Mentions von `fromIds` an `toId` um (dedupliziert pro daily_repo) und
 *  löscht die Quell-Produkte. */
async function mergeInto(supabase: Sb, toId: string, fromIds: string[]): Promise<void> {
  const { data: tm } = await supabase.from('product_mentions').select('daily_repo_id').eq('product_id', toId)
  const days = new Set((tm ?? []).map((m) => m.daily_repo_id))
  for (const fromId of fromIds) {
    const { data: fm } = await supabase.from('product_mentions').select('id, daily_repo_id').eq('product_id', fromId)
    for (const m of fm ?? []) {
      if (days.has(m.daily_repo_id)) await supabase.from('product_mentions').delete().eq('id', m.id)
      else { await supabase.from('product_mentions').update({ product_id: toId, excerpt_hash: mentionHash(toId) }).eq('id', m.id); days.add(m.daily_repo_id) }
    }
    await supabase.from('products').delete().eq('id', fromId)
  }
}

// Qualifier-Tokens, die KEINE eigene Produktidentität bilden (Größen + Performance-Tiers).
const SIZE_RE = /^\d+(?:\.\d+)?b$|^a\d+b$|^\d+x\d+b$/
const TIER_WORDS = new Set([
  'mini', 'nano', 'pro', 'plus', 'max', 'instant', 'lite', 'preview', 'turbo',
  'flash', 'ultra', 'air', 'small', 'medium', 'large', 'high', 'low', 'exp', 'beta',
])

/** qualifier besteht NUR aus Größen-/Tier-Tokens (7b, 72b, 35b a3b, mini, pro, max,
 *  preview …) → auf family+version rollen. Funktionale Varianten (coder, vl, omni,
 *  codex, sol, cyber, tts …) und echte Modell-Versionen bleiben getrennt. */
function isRollupQualifier(q: string | null): boolean {
  if (!q) return false
  const tokens = q.toLowerCase().split(/[\s\-_/]+/).filter(Boolean)
  return tokens.length > 0 && tokens.every((t) => SIZE_RE.test(t) || TIER_WORDS.has(t))
}

/** Anzeigename fürs Basis-Produkt, wenn keine qualifier-freie Basis existiert. */
function baseName(family: string, version: string | null): string {
  const fam = family
    .split(/\s+/)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
  return version ? `${fam} ${version}` : fam
}

/**
 * D) Größen-/Tier-Varianten auf das family+version-Basis-Produkt rollen
 *    (z.B. „GPT-5.5 Pro/Instant/72B" → „GPT-5.5"); Versionen + funktionale
 *    Varianten bleiben unangetastet.
 */
export async function rollupSizeTierVariants(supabase: Sb): Promise<{ rolledUp: number }> {
  const all: Array<{ id: string; family: string; version: string | null; qualifier: string | null; vendor_namespace: string }> = []
  for (let off = 0; ; off += 1000) {
    const { data } = await supabase.from('products').select('id, family, version, qualifier, vendor_namespace').eq('visibility_status', 'visible').range(off, off + 999)
    if (!data?.length) break
    all.push(...(data as typeof all))
    if (data.length < 1000) break
  }
  const mc: Record<string, number> = {}
  for (let off = 0; ; off += 1000) {
    const { data } = await supabase.from('product_mentions').select('product_id').range(off, off + 999)
    if (!data?.length) break
    for (const m of data) mc[m.product_id] = (mc[m.product_id] ?? 0) + 1
    if (data.length < 1000) break
  }

  const byKey = new Map<string, typeof all>()
  for (const p of all) {
    const k = `${p.family}|${p.version ?? ''}|${p.vendor_namespace}`
    byKey.set(k, [...(byKey.get(k) ?? []), p])
  }

  let rolledUp = 0
  for (const [, grp] of byKey) {
    const variants = grp.filter((p) => isRollupQualifier(p.qualifier))
    if (variants.length === 0) continue
    let base = grp.find((p) => !p.qualifier)
    let mergeFrom = variants
    if (!base) {
      variants.sort((a, b) => (mc[b.id] ?? 0) - (mc[a.id] ?? 0))
      base = variants[0]
      mergeFrom = variants.slice(1)
      await supabase.from('products').update({ qualifier: null, canonical_name: baseName(base.family, base.version) }).eq('id', base.id)
    }
    if (mergeFrom.length) {
      await mergeInto(supabase, base.id, mergeFrom.map((v) => v.id))
      rolledUp += mergeFrom.length
    }
  }
  return { rolledUp }
}

/**
 * Bereinigt die Produkt-Daten nach einem Extraktions-/Backfill-Lauf:
 *  A) 0-Mention-Leichen löschen
 *  B) Vendor-Duplikate (gleiche family/version/qualifier, verschiedene vendor) mergen
 *  C) Sub-Produkte (family beginnt mit einem Kern) zum Kern-Produkt normalisieren
 *  D) Größen-/Tier-Varianten auf family+version rollen
 */
export async function runConsolidation(): Promise<{ deadDeleted: number; vendorMerged: number; subMerged: number; rolledUp: number; productsAfter: number }> {
  const supabase = createAdminClient()

  // alle Produkte + Mention-Counts
  const allProds: Array<{ id: string; family: string; version: string | null; qualifier: string | null; vendor_namespace: string }> = []
  for (let off = 0; ; off += 1000) {
    const { data } = await supabase.from('products').select('id, family, version, qualifier, vendor_namespace').range(off, off + 999)
    if (!data?.length) break
    allProds.push(...(data as typeof allProds))
    if (data.length < 1000) break
  }
  const mc: Record<string, number> = {}
  for (let off = 0; ; off += 1000) {
    const { data } = await supabase.from('product_mentions').select('product_id').range(off, off + 999)
    if (!data?.length) break
    for (const m of data) mc[m.product_id] = (mc[m.product_id] ?? 0) + 1
    if (data.length < 1000) break
  }

  // A: 0-Mention-Leichen
  const dead = allProds.filter((p) => !mc[p.id]).map((p) => p.id)
  for (let i = 0; i < dead.length; i += 200) {
    const { error } = await supabase.from('products').delete().in('id', dead.slice(i, i + 200))
    if (error) throw new Error(`consolidate dead: ${error.message}`)
  }

  // B: Vendor-Duplikate (gleiche family+version+qualifier)
  const live = allProds.filter((p) => mc[p.id])
  const groups = new Map<string, typeof live>()
  for (const p of live) {
    const key = `${p.family} ${p.version ?? ''} ${p.qualifier ?? ''}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(p)
  }
  let vendorMerged = 0
  for (const [, grp] of groups) {
    if (grp.length < 2) continue
    grp.sort((a, b) => (a.vendor_namespace === 'unknown' ? 1 : 0) - (b.vendor_namespace === 'unknown' ? 1 : 0) || (mc[b.id] ?? 0) - (mc[a.id] ?? 0))
    await mergeInto(supabase, grp[0].id, grp.slice(1).map((p) => p.id))
    vendorMerged += grp.length - 1
  }

  // C: Sub-Produkt-Merge zu Kern-Produkten
  const claimed = new Set<string>()
  let subMerged = 0
  for (const core of CORES) {
    const { data: prods } = await supabase.from('products').select('id, family').or(`family.eq.${core.fam},family.like.${core.fam} %`)
    const members = (prods ?? []).filter((p) => !claimed.has(p.id))
    if (members.length === 0) continue
    for (const p of members) claimed.add(p.id)
    const counts: Record<string, number> = {}
    for (const p of members) {
      const { count } = await supabase.from('product_mentions').select('id', { count: 'exact', head: true }).eq('product_id', p.id)
      counts[p.id] = count ?? 0
    }
    members.sort((a, b) => counts[b.id] - counts[a.id])
    const base = members[0]
    await mergeInto(supabase, base.id, members.slice(1).map((p) => p.id))
    await supabase.from('products').update({ family: core.fam, version: null, qualifier: null, canonical_name: core.name, vendor_namespace: core.vendor }).eq('id', base.id)
    subMerged += members.length - 1
  }

  // D: Größen-/Tier-Varianten auf family+version rollen
  const { rolledUp } = await rollupSizeTierVariants(supabase)

  const { count: productsAfter } = await supabase.from('products').select('id', { count: 'exact', head: true })
  return { deadDeleted: dead.length, vendorMerged, subMerged, rolledUp, productsAfter: productsAfter ?? 0 }
}
