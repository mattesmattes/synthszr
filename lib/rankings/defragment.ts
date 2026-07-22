import { createAdminClient } from '@/lib/supabase/admin'
import { mergeProductsInto } from '@/lib/rankings/consolidate'
import { canonicalVendor } from '@/lib/rankings/vendor-canonical'

// Selbstheilende De-Fragmentierung: bündelt Produkte, die dasselbe Modell mit
// abweichender Benennung sind (Marken-/Vendor-Präfix, family-vs-qualifier-Inkonsistenz
// des Parsers), und mergt sie in das Produkt mit den meisten Mentions.
//
// Konservativ: kombiniert family+qualifier und strippt NUR führende Marken-/Vendor-
// Wörter (solange ein Rest bleibt). Dadurch verschmelzen "Google Gemini"="Gemini" und
// "Opus 4.7"="Claude Opus 4.7", aber Opus/Sonnet/Haiku, Versionen und Varianten
// (Thinking, Cyber, Pro) bleiben getrennt.

const BRANDS = new Set([
  'claude', 'gpt', 'chatgpt', 'gemini', 'gemma', 'llama', 'qwen', 'deepseek', 'grok',
  'mistral', 'phi', 'ernie', 'doubao', 'hunyuan', 'glm', 'kimi', 'yi', 'command', 'nova',
  'openai', 'google', 'anthropic', "anthropic's", 'meta', 'microsoft', 'alibaba', 'baidu',
  'tencent', 'nvidia', 'amazon', 'cohere', 'databricks', 'xai', 'moonshot', 'the',
])

/** Normalisierte Modell-Identität: family+qualifier, führende Marken-/Vendor-Wörter
 *  entfernt (nur wenn ein Rest bleibt). Strippt zusätzlich das führende Wort, das dem
 *  eigenen vendor entspricht (fängt github/google/openai/… automatisch, ohne Pflege-
 *  liste). Leerer String ⇒ reine Marke ohne Modell. */
export function normModel(family: string, qualifier: string | null, vendor?: string | null): string {
  let toks = `${family || ''} ${qualifier || ''}`.trim().toLowerCase().split(/\s+/).filter(Boolean)
  // Klammer-Zusätze ignorieren: "Agent Development Kit (ADK)" == "Agent Development Kit".
  toks = toks.filter((t) => !t.startsWith('('))
  const v = (vendor || '').trim().toLowerCase()
  // Führende Marken-/Vendor-Wörter strippen (solange ein Rest bleibt).
  while (toks.length > 1 && (BRANDS.has(toks[0]) || toks[0] === v)) toks = toks.slice(1)
  // Trailing "AI" strippen: "Siri AI" == "Siri", "Kling AI" == "Kling".
  if (toks.length > 1 && toks[toks.length - 1] === 'ai') toks = toks.slice(0, -1)
  return toks.join(' ')
}

/**
 * Findet Fragmentierungs-Cluster (vendor|normModel|version) und mergt je Cluster alle
 * Varianten in das Produkt mit den meisten Mentions. Deterministisch, keine LLM-Kosten.
 * Für den täglichen Cron: hält den Katalog dauerhaft konsolidiert.
 */
export async function runDefragmentation(): Promise<{ clusters: number; merged: number }> {
  const supabase = createAdminClient()

  type P = { id: string; vendor_namespace: string; family: string; version: string | null; qualifier: string | null }
  const products: P[] = []
  for (let off = 0; ; off += 1000) {
    const { data } = await supabase.from('products')
      .select('id, vendor_namespace, family, version, qualifier')
      .eq('visibility_status', 'visible').range(off, off + 999)
    if (!data?.length) break
    products.push(...(data as P[]))
    if (data.length < 1000) break
  }

  const clusters = new Map<string, P[]>()
  for (const p of products) {
    const nm = normModel(p.family, p.qualifier, p.vendor_namespace)
    if (!nm) continue // reine Marke ohne Modell (Umbrella) — nicht mergen
    // KANONISCHER Vendor: sonst clustern Namespace-Varianten desselben Herstellers
    // (moonshot vs moonshot-ai, google vs google-deepmind) getrennt und bleiben als
    // Duplikate im Chart stehen (z.B. "Kimi K3" mehrfach).
    const key = `${canonicalVendor(p.vendor_namespace)}|${nm}|${p.version ?? ''}`
    if (!clusters.has(key)) clusters.set(key, [])
    clusters.get(key)!.push(p)
  }

  let clustersDone = 0
  let merged = 0
  for (const [, ps] of clusters) {
    if (ps.length < 2) continue
    // Mention-Zahl je Mitglied → das größte wird zum Kanon (nur für Multi-Cluster).
    const counts = await Promise.all(ps.map(async (p) => {
      const { count } = await supabase.from('product_mentions').select('id', { count: 'exact', head: true }).eq('product_id', p.id)
      return { p, n: count ?? 0 }
    }))
    counts.sort((a, b) => b.n - a.n)
    const canonical = counts[0].p
    const rest = counts.slice(1).map((c) => c.p.id)
    if (rest.length) {
      await mergeProductsInto(supabase, canonical.id, rest)
      merged += rest.length
      clustersDone++
    }
  }
  return { clusters: clustersDone, merged }
}
