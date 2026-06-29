import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'

export interface CategorizableProduct {
  id: string
  name: string
  vendor: string
}
export interface CategoryDef {
  slug: string
  name: string
  description: string | null
}

const ResponseSchema = z.object({ assignments: z.array(z.unknown()) })
const AssignmentSchema = z.object({ index: z.number().int(), category: z.string() })
const LLM_TIMEOUT_MS = 50_000

/** Pure: baut den Klassifikations-Prompt (nummerierte Produkte, gültige Kategorien). */
export function buildCategorizePrompt(products: CategorizableProduct[], categories: CategoryDef[]): string {
  const cats = categories.map((c) => `- ${c.slug}: ${c.name}${c.description ? ` — ${c.description}` : ''}`).join('\n')
  const items = products.map((p, i) => `${i}. ${p.name} (${p.vendor})`).join('\n')
  return `Ordne jedem AI-Produkt GENAU EINE primäre Kategorie zu.

KATEGORIEN (nutze exakt den slug links):
${cats}

REGELN:
- Wähle die treffendste Kategorie per slug. Wenn nichts klar passt: "other".
- Sprachmodelle/LLMs (GPT, Claude, Gemini, Llama, Qwen, DeepSeek …) → language-models.
- Antworte für JEDES Produkt mit seinem Index.

PRODUKTE:
${items}`
}

/** Pure: validiert die LLM-Antwort gegen gültige Slugs + Index-Bereich. */
export function parseCategorizeResponse(raw: unknown, validSlugs: Set<string>, count: number): Map<number, string> {
  const out = new Map<number, string>()
  const outer = ResponseSchema.safeParse(raw)
  if (!outer.success) return out
  for (const a of outer.data.assignments) {
    const parsed = AssignmentSchema.safeParse(a)
    if (!parsed.success) continue
    const { index, category } = parsed.data
    if (index < 0 || index >= count) continue
    if (!validSlugs.has(category)) continue
    out.set(index, category)
  }
  return out
}

/** LLM-Klassifikation eines Batches → Map<productId, categorySlug>. Fehler ⇒ leere Map. */
export async function classifyProducts(
  products: CategorizableProduct[],
  categories: CategoryDef[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (products.length === 0) return result
  if (!process.env.ANTHROPIC_API_KEY) return result

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { getModelForUseCase } = await import('@/lib/ai/model-config')
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const validSlugs = new Set(categories.map((c) => c.slug))
  const tool = {
    name: 'assign_categories',
    description: 'Ordne jedem Produkt-Index eine Kategorie zu',
    input_schema: {
      type: 'object' as const,
      properties: {
        assignments: {
          type: 'array',
          items: { type: 'object', properties: { index: { type: 'integer' }, category: { type: 'string' } }, required: ['index', 'category'] },
        },
      },
      required: ['assignments'],
    },
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  try {
    const model = await getModelForUseCase('ranking_extract')
    const resp = await client.messages.create({
      model, max_tokens: 2048, tools: [tool],
      tool_choice: { type: 'tool', name: 'assign_categories' },
      messages: [{ role: 'user', content: buildCategorizePrompt(products, categories) }],
    }, { signal: controller.signal })
    const block = resp.content.find((b) => b.type === 'tool_use')
    const byIndex = parseCategorizeResponse(block && 'input' in block ? block.input : null, validSlugs, products.length)
    for (const [idx, slug] of byIndex) result.set(products[idx].id, slug)
    return result
  } catch {
    return result // Fehler ⇒ nichts zuordnen (retrybar im nächsten Lauf)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Klassifiziert alle sichtbaren, noch nicht kategorisierten Produkte batchweise
 * und schreibt die primäre Kategorie nach product_category_membership.
 */
export async function runCategorization(batchSize = 25): Promise<{ categorized: number; pending: number }> {
  const supabase = createAdminClient()

  const { data: cats, error: cErr } = await supabase
    .from('product_categories')
    .select('slug, name, description')
    .eq('status', 'active')
    .order('display_order')
  if (cErr) throw new Error(`categories: ${cErr.message}`)
  if (!cats?.length) return { categorized: 0, pending: 0 }

  const { data: products, error: pErr } = await supabase
    .from('products')
    .select('id, canonical_name, vendor_namespace')
    .eq('visibility_status', 'visible')
  if (pErr) throw new Error(`products: ${pErr.message}`)

  const { data: existing, error: eErr } = await supabase
    .from('product_category_membership')
    .select('product_id')
  if (eErr) throw new Error(`memberships: ${eErr.message}`)
  const done = new Set((existing ?? []).map((e) => e.product_id as string))

  const todo = (products ?? [])
    .filter((p) => !done.has(p.id))
    .map((p) => ({ id: p.id as string, name: p.canonical_name as string, vendor: p.vendor_namespace as string }))

  let categorized = 0
  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize)
    const assignments = await classifyProducts(batch, cats)
    const rows = [...assignments].map(([product_id, category]) => ({ product_id, category, is_primary: true }))
    if (rows.length) {
      const { error } = await supabase
        .from('product_category_membership')
        .upsert(rows, { onConflict: 'product_id,category' })
      if (error) throw new Error(`membership upsert: ${error.message}`)
      categorized += rows.length
    }
  }
  return { categorized, pending: todo.length - categorized }
}
