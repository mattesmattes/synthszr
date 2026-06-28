import { z } from 'zod'

export interface ExtractedProduct { name: string; vendor: string; excerpt?: string }
export type ExtractProductsResult =
  | { ok: true; products: ExtractedProduct[]; usage?: { inputTokens: number; outputTokens: number } }
  | { ok: false; error: string; retryable: boolean }

const ProductSchema = z.object({
  name: z.string().trim().min(1).transform(s => s.slice(0, 120)),
  vendor: z.string().trim().min(1).transform(s => s.slice(0, 120)),
  excerpt: z.string().trim().transform(s => s.slice(0, 2000)).optional(),
})
const ResponseSchema = z.object({ products: z.array(z.unknown()) })

const LLM_TIMEOUT_MS = 50_000

/** Baut den Extraktions-Prompt (pure, gehärtet). */
export function buildExtractPrompt(title: string, content: string): string {
  return `Extrahiere ALLE konkret benannten AI-PRODUKTE aus dieser Tech-News.

REGELN:
- Nur echte Produkte/Modelle/Tools (z.B. ein konkretes Sprachmodell, eine IDE, ein Bild-/Video-Generator), KEINE Firmen ohne konkretes Produkt, keine generischen Begriffe ("KI", "Chatbot").
- Erfinde KEINE Produktnamen. Wenn kein konkretes AI-Produkt genannt wird, gib eine LEERE Liste zurück.
- name: exakter im Text genannter Produktname inkl. Version/Qualifier.
- vendor: der Hersteller/Eigentümer des Produkts (NICHT der zitierte Publisher/das Newsportal), als kurzer Markenname OHNE Rechtsform ("OpenAI", nicht "OpenAI Inc.").
- excerpt: kurzer wörtlicher Beleg-Ausschnitt aus dem Text.

TITEL: ${title}

INHALT:
${content.slice(0, 8000)}`
}

/** Validiert/filtert + begrenzt Längen. Müll ⇒ []. */
export function parseExtractResponse(raw: unknown): ExtractedProduct[] {
  const outer = ResponseSchema.safeParse(raw)
  if (!outer.success) return []
  const out: ExtractedProduct[] = []
  for (const item of outer.data.products) {
    const p = ProductSchema.safeParse(item)
    if (p.success) out.push({ name: p.data.name, vendor: p.data.vendor, excerpt: p.data.excerpt })
  }
  return out
}

/** LLM-Extraktion via Anthropic tool-use. Provider-/Timeout-Fehler ⇒ {ok:false,retryable}. */
export async function extractProducts(title: string, content: string): Promise<ExtractProductsResult> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { getModelForUseCase } = await import('@/lib/ai/model-config')
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: 'ANTHROPIC_API_KEY missing', retryable: true }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  try {
    const model = await getModelForUseCase('ranking_extract')
    const tool = {
      name: 'report_products',
      description: 'Melde alle in der News genannten AI-Produkte',
      input_schema: {
        type: 'object' as const,
        properties: {
          products: {
            type: 'array',
            items: { type: 'object', properties: { name: { type: 'string' }, vendor: { type: 'string' }, excerpt: { type: 'string' } }, required: ['name', 'vendor'] },
          },
        },
        required: ['products'],
      },
    }
    const resp = await client.messages.create({
      model, max_tokens: 1536, tools: [tool],
      tool_choice: { type: 'tool', name: 'report_products' },
      messages: [{ role: 'user', content: buildExtractPrompt(title, content) }],
    }, { signal: controller.signal })
    const block = resp.content.find((b) => b.type === 'tool_use')
    const products = parseExtractResponse(block && 'input' in block ? block.input : null)
    return { ok: true, products, usage: { inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: true }
  } finally {
    clearTimeout(timer)
  }
}
