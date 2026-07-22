/**
 * Kanonische Vendor-Zuordnung: bildet Vendor-Namespace-Schreibvarianten und Konzern-
 * Sub-Brands auf EINEN kanonischen Vendor-Namespace ab (z.B. aws/amazon-web-services →
 * amazon). Rein & DB-frei — nutzbar im Server-Render, Resolve und in Tests.
 *
 * Konservativ: nur eindeutige Konzern-Zugehörigkeiten. Im Zweifel NICHT aliasen.
 */
export const VENDOR_ALIASES: Record<string, string> = {
  // Amazon
  'amazon-web-services': 'amazon', 'aws': 'amazon', 'aws-ai': 'amazon', 'amazon-agi': 'amazon',
  // Google / Alphabet
  'google-deepmind': 'google', 'deepmind': 'google', 'google-cloud': 'google',
  'google-research': 'google', 'google-labs': 'google', 'gcp': 'google', 'alphabet': 'google',
  // Microsoft
  'github': 'microsoft', 'microsoft-research': 'microsoft', 'microsoft-ai': 'microsoft', 'azure': 'microsoft',
  // Meta
  'instagram': 'meta', 'whatsapp': 'meta', 'facebook': 'meta', 'fair': 'meta', 'meta-ai': 'meta',
  // Mistral
  'mistral-ai': 'mistral',
  // Moonshot AI (Kimi) — häufige Namespace-Varianten desselben Herstellers
  'moonshot-ai': 'moonshot', 'moonshots': 'moonshot', 'beijing-moonshot-ai-technology': 'moonshot',
  'moonshotai': 'moonshot',
  // IBM
  'ibm-research': 'ibm',
  // ByteDance
  'tiktok': 'bytedance',
}

/** Lesbare Anzeigenamen für häufige Vendors (nach Alias-Auflösung). */
const DISPLAY_NAMES: Record<string, string> = {
  amazon: 'Amazon', google: 'Google', microsoft: 'Microsoft', meta: 'Meta', apple: 'Apple',
  nvidia: 'Nvidia', openai: 'OpenAI', anthropic: 'Anthropic', xai: 'xAI', mistral: 'Mistral AI',
  ibm: 'IBM', bytedance: 'ByteDance', deepseek: 'DeepSeek', alibaba: 'Alibaba', adobe: 'Adobe',
  perplexity: 'Perplexity', cohere: 'Cohere', huggingface: 'Hugging Face', salesforce: 'Salesforce',
  tencent: 'Tencent', anysphere: 'Anysphere', elevenlabs: 'ElevenLabs', runway: 'Runway',
  moonshot: 'Moonshot AI',
}

/** Vendor-Namespace → kanonischer Vendor-Namespace (Casing/Whitespace-normalisiert). */
export function canonicalVendor(ns: string | null | undefined): string {
  const k = (ns ?? '').trim().toLowerCase()
  if (!k) return ''
  return VENDOR_ALIASES[k] ?? k
}

/** Kanonischer Vendor → lesbarer Firmenname; Fallback: Bindestrich-Slug kapitalisieren. */
export function vendorDisplayName(ns: string | null | undefined): string {
  const c = canonicalVendor(ns)
  if (!c) return ''
  if (DISPLAY_NAMES[c]) return DISPLAY_NAMES[c]
  return c.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
}

/** Reverse: alle Namespaces (Kanon + Aliase), die zu einer Company gehören. */
export function namespacesForCompany(companySlug: string): string[] {
  const canon = canonicalVendor(companySlug)
  const out = new Set<string>([canon])
  for (const [alias, target] of Object.entries(VENDOR_ALIASES)) {
    if (target === canon) out.add(alias)
  }
  return [...out]
}
