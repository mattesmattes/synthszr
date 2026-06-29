import { KNOWN_PREMARKET_COMPANIES } from '@/lib/data/companies'

/** Generische AI-Produkt-Indikatoren. Wort-Anfang-Grenze beim Match (\b…) verhindert
 *  Substring-False-Positives wie "tome"→"customer" oder "unity"→"community". */
const AI_TERMS = [
  'gpt', 'chatgpt', 'claude', 'gemini', 'llama', 'qwen', 'deepseek', 'mistral',
  'grok', 'copilot', 'cursor', 'midjourney', 'sora', 'dall-e', 'dall·e', 'stable diffusion',
  'llm', 'language model', 'foundation model', 'frontier model', 'reasoning model',
  'sprachmodell', 'ki-modell', 'ki modell', 'ai model', 'ai-modell', 'multimodal',
  'fine-tun', 'fine tun', 'agentic', 'ai agent', 'ki-agent', 'ki agent',
  'ai tool', 'ki-tool', 'image generat', 'video generat', 'text-to-image', 'text-to-video',
  'mixture of experts', 'hugging face', 'openai', 'anthropic',
]

/** Bekannte AI-Vendoren/-Produkte (glitch.green Premarket). NICHT KNOWN_COMPANIES —
 *  das sind Stock-Ticker (Apple/Google/Meta), die in jeder Tech-News vorkommen und
 *  kein AI-Produkt-Signal sind. ≥4 Zeichen, um generische Kurznamen zu vermeiden. */
const VENDOR_TERMS = Array.from(
  new Set(
    Object.keys(KNOWN_PREMARKET_COMPANIES)
      .map(s => s.toLowerCase())
      .filter(s => s.length >= 4),
  ),
)

const ALL_TERMS = Array.from(new Set([...AI_TERMS, ...VENDOR_TERMS]))

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Ein Regex mit Wort-Anfang-Grenze pro Term (case-insensitive). */
const PATTERN = new RegExp('\\b(' + ALL_TERMS.map(escapeRegex).join('|') + ')', 'i')

/**
 * Billiger, deterministischer Vorfilter: enthält die News einen AI-Produkt-Indikator
 * (bekannter AI-Vendor/-Produkt oder generischer AI-Begriff)? Wenn nicht, lohnt der
 * teure Extract-LLM-Call nicht. Permissiv (hoher Recall) — die finale Precision macht
 * das Extract-LLM.
 */
export function looksAiProductRelevant(title: string, content: string): boolean {
  const hay = `${title} ${content}`
  if (!hay.trim()) return false
  return PATTERN.test(hay)
}
