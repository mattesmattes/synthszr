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
