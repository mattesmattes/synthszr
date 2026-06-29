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
  return `Extrahiere die konkret benannten AI-PRODUKTE aus dieser Tech-News.

EINSCHLIESSEN (nur diese Produktarten):
- KI-/Sprachmodelle (z.B. GPT-5.6, Claude Opus 4.8, Gemini 2.5 Pro, Llama 3.1)
- AI-Apps & -Assistenten (z.B. ChatGPT, Perplexity)
- AI-Coding-Tools/IDEs (z.B. Cursor, Claude Code, Copilot)
- Bild-/Video-/Audio-Generatoren (z.B. Sora, Midjourney, Veo)
- AI-Agenten/-Plattformen mit eigenem Produktnamen

AUSSCHLIESSEN (NICHT extrahieren):
- Firmen/Vendoren OHNE konkret genanntes Produkt (z.B. "OpenAI", "JetBrains", "Google" allein)
- Benchmarks/Evals/Datasets (z.B. "Terminal Bench", "MMLU", "SWE-bench")
- Code-Libraries/Frameworks/SDKs (z.B. "LangChain", "React")
- Dateien/Configs/Repos/Verzeichnisse (z.B. "CLAUDE.md", "README", "package.json")
- Personen, Autoren, Newsletter, Podcasts, Blogs, Kurse, Skill-Sets
- generische Begriffe ("KI", "Chatbot", "Agent", "Modell" ohne Eigennamen)
- Konzepte/Tags/Features ohne eigenständigen Produktnamen
- EINZELNE FEATURES/MODI/PLUGINS/UNTER-FUNKTIONEN eines Produkts NICHT als eigenes Produkt
  (z.B. KEINE "Codex Record & Replay", "Codex Sites", "Cursor /automate", "Claude Code Routines"
  → nur das KERN-Produkt: "Codex", "Cursor", "Claude Code")

REGELN:
- Im Zweifel WEGLASSEN. Erfinde KEINE Produktnamen. Wenn nichts klar passt, gib eine LEERE Liste zurück.
- name: das KERN-Produkt inkl. Version/Variante (z.B. "GPT-5.6 Terra", "Claude Opus 4.8"). NICHT einzelne Features/Modi/Editionen/Versions-Patches anhängen. KEINE Zusätze wie "model"/"Modell"/Versionsnummern wie "v2.1.190".
- vendor: der ETABLIERTE Hersteller-Markenname, KONSISTENT über alle Nennungen (z.B. immer "OpenAI" für GPT/ChatGPT/Codex, "Anysphere" für Cursor, "Anthropic" für Claude, "Google" für Gemini, "xAI" für Grok). Nutze den allgemein bekannten Hersteller — verwende NICHT "unknown", wenn der Hersteller eines bekannten Produkts klar ist.
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
