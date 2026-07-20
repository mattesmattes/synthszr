// Reine Hersteller-/Unternehmensnamen, die KEINE eigenständigen Produkte sind.
// Der Extract legt sie sonst fälschlich als Chart-Produkte an (z.B. "Anthropic",
// "OpenAI"). resolveProduct markiert solche als visibility_status='excluded'.
// Modell-/Produktnamen MIT Zusatz (z.B. "Mistral Large") bleiben erlaubt — hier
// stehen nur die nackten Vendor-Namen (family-Match).
export const EXCLUDED_PRODUCT_NAMES = new Set<string>([
  'anthropic', 'openai', 'google', 'alphabet', 'google deepmind', 'deepmind',
  'microsoft', 'meta', 'amazon', 'aws', 'nvidia', 'apple', 'xai', 'x ai',
  'alibaba', 'baidu', 'tencent', 'bytedance', 'huawei',
  'salesforce', 'oracle', 'sap', 'adobe', 'ibm', 'intel', 'amd', 'samsung', 'qualcomm',
  'mistral', 'mistral ai', 'cohere', 'stability ai', 'stability', 'databricks',
  'snowflake', 'palantir', 'sakana', 'sakana ai',
])

/** family/Name ist ein reiner Hersteller (kein Produkt). */
export function isExcludedProduct(name: string | null | undefined): boolean {
  if (!name) return false
  return EXCLUDED_PRODUCT_NAMES.has(name.trim().toLowerCase())
}

// Produktnamen, die zugleich GÄNGIGE Wörter sind (v.a. im deutschen Text): sie
// dürfen NICHT automatisch aus News-Text heraus verlinkt werden, weil das Wort dort
// fast immer die Alltagsbedeutung hat ("im Tempo", "Vibe Coding"), nicht das Produkt.
// Das Produkt bleibt in den Charts sichtbar — nur das Auto-Matching überspringt es.
// Konservativ halten (nur eindeutig mehrdeutige Wörter); bei Bedarf erweitern.
export const AUTOLINK_STOPWORDS = new Set<string>([
  'tempo', 'vibe',
  // Namen, für die es zwar ein echtes Produkt gibt (z.B. Bland AI "Norm",
  // Apple "Vision", Simon Willisons "LLM"-CLI, Meta "Edits", pitch.com), das
  // Wort im deutschen Fließtext aber fast immer die Alltagsbedeutung hat
  // ("die Vision", "der Pitch", "Datei-Edits", "LLM-gestützt", "die Norm").
  // Das Produkt bleibt in den Charts — nur die Auto-Verlinkung/der Vote-Block
  // im Blog überspringt es. Der LLM-Kontext-Pass (product-validity-qa) entscheidet
  // zusätzlich pro Erwähnung, ob es fürs Ranking zählt.
  'llm', 'llms', 'pitch', 'edit', 'edits', 'norm', 'vision',
])

/** Produktname ist ein gängiges Wort → nicht automatisch aus Fließtext verlinken. */
export function isAutolinkStopword(name: string | null | undefined): boolean {
  if (!name) return false
  return AUTOLINK_STOPWORDS.has(name.trim().toLowerCase())
}

// Reine Konzept-/Allerweltswörter, für die es KEIN gleichnamiges echtes AI-Produkt
// gibt — der Extraktor legt sie kontextlos als Chart-Produkt an. Anders als
// AUTOLINK_STOPWORDS (nur Blog-Anzeige) werden diese hart aus den Charts genommen
// (visibility_status='excluded'). NUR eindeutige Nicht-Produkte aufnehmen; sobald
// ein reales Produkt denselben Namen trägt, gehört das Wort in AUTOLINK_STOPWORDS
// + den LLM-Kontext-Pass, NICHT hierher.
export const COMMON_WORD_NONPRODUCTS = new Set<string>([
  'agents', 'apps', 'chatbots', 'chatbot', 'reasoning', 'inference',
  'prompt', 'prompts', 'benchmark', 'benchmarks', 'dataset', 'datasets',
])

/** family/Name ist ein reines Konzept-/Allerweltswort (kein reales Produkt). */
export function isCommonWordNonProduct(name: string | null | undefined): boolean {
  if (!name) return false
  return COMMON_WORD_NONPRODUCTS.has(name.trim().toLowerCase())
}

// Modell-FAMILIEN: der nackte Familienname (ohne Version/Variante) ist ein
// Oberbegriff, KEIN Produkt. "GPT" / "Claude" / "Gemini" sind Familien — das
// Produkt ist "GPT-5.6" / "Claude Opus 4.8" / "Gemini 2.5 Pro". Wird in den
// Leaderboards ausgeblendet, sobald family in der Liste UND Version+Qualifier leer.
export const FAMILY_UMBRELLAS = new Set<string>([
  'gpt', 'chatgpt', 'claude', 'gemini', 'qwen', 'llama', 'grok', 'gemma',
  'deepseek', 'mistral', 'glm', 'kimi', 'phi', 'command', 'nova', 'ernie',
  'hunyuan', 'yi', 'doubao', 'minimax', 'falcon', 'dbrx', 'jamba', 'codestral',
  'mixtral', 'pixtral', 'aya', 'olmo', 'reka', 'sonar',
])

/** Nackter Modell-Familienname (ohne Version/Qualifier) — Oberbegriff, kein Produkt. */
export function isFamilyUmbrella(
  family: string | null | undefined,
  version: string | null,
  qualifier: string | null,
): boolean {
  if (!family || version || qualifier) return false
  return FAMILY_UMBRELLAS.has(family.trim().toLowerCase())
}
