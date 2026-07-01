import { createAdminClient } from '@/lib/supabase/admin'

const LLM_TIMEOUT_MS = 90_000

/**
 * Destilliert aus den Belegen der Produkte einer Kategorie die 5-8 wichtigsten
 * VERGLEICHS-Dimensionen (datengetrieben statt hardcoded) und schreibt sie nach
 * product_categories.feature_dimensions — die einheitliche Tabelle der Kategorie.
 */
export async function distillCategoryDimensions(categorySlug: string, categoryName: string): Promise<string[] | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const supabase = createAdminClient()

  // Kategorie-Mitglieder (paginiert)
  const catIds = new Set<string>()
  for (let off = 0; ; off += 1000) {
    const { data } = await supabase.from('product_category_membership').select('product_id').eq('category', categorySlug).range(off, off + 999)
    if (!data?.length) break
    for (const m of data) catIds.add(m.product_id as string)
    if (data.length < 1000) break
  }
  if (catIds.size === 0) return null

  // Stichprobe: bis zu 24 Produkte mit je bis zu 4 Belegen
  const ids = [...catIds].slice(0, 24)
  const samples: string[] = []
  for (const id of ids) {
    const { data: p } = await supabase.from('products').select('canonical_name').eq('id', id).maybeSingle()
    if (!p) continue
    const { data: ms } = await supabase.from('product_mentions').select('excerpt').eq('product_id', id).not('excerpt', 'is', null).limit(4)
    const ex = (ms ?? []).map((m) => (m.excerpt as string)?.trim()).filter(Boolean)
    if (ex.length) samples.push(`- ${p.canonical_name}: ${ex.join(' | ')}`)
  }
  if (samples.length === 0) return null

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const tool = {
    name: 'report_dimensions',
    description: 'Melde die Vergleichs-Dimensionen der Kategorie',
    input_schema: { type: 'object' as const, properties: { dimensions: { type: 'array', items: { type: 'string' } } }, required: ['dimensions'] },
  }
  const prompt = `Kategorie "${categoryName}". Produkte dieser Kategorie mit Auszügen aus AI-News:

${samples.join('\n').slice(0, 8000)}

Leite die 5-8 wichtigsten VERGLEICHS-DIMENSIONEN ab, anhand derer man diese Produkte in EINER gemeinsamen Feature-Tabelle für die GESAMTE Kategorie sinnvoll vergleicht. Nur Dimensionen, die für die Kategorie klar relevant sind und in solchen News typischerweise vorkommen (z.B. Kontextfenster, Benchmark-Ergebnis, Latenz, Auflösung). "Preis-Tier" und – wo sinnvoll – ein Benchmark/Leistungswert sollten enthalten sein. Kurze, prägnante deutsche Dimensionsnamen, keine Erklärungen.`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 500,
      tools: [tool], tool_choice: { type: 'tool', name: 'report_dimensions' },
      messages: [{ role: 'user', content: prompt }],
    }, { signal: controller.signal })
    const block = resp.content.find((b: { type: string; name?: string }) => b.type === 'tool_use' && b.name === 'report_dimensions')
    const input = block && 'input' in block ? (block.input as { dimensions?: unknown }) : null
    const dims = Array.isArray(input?.dimensions)
      ? [...new Set((input.dimensions as unknown[]).map((d) => String(d).trim()).filter(Boolean))].slice(0, 8)
      : []
    if (dims.length === 0) return null
    await supabase.from('product_categories').update({ feature_dimensions: dims }).eq('slug', categorySlug)
    return dims
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
