// Meta-Gruppen für die Rankings-Navigation (Zwei-Ebenen). Rein präsentativ: bündelt
// die ~50 feinen Kategorien in 9 Gruppen. KEINE DB-Spalte — die Filterung läuft weiter
// über product_metrics.primary_category (die Gruppe expandiert zur Slug-Liste für .in()).
//
// ⚠️ Neue Kategorie? Hier in die passende Gruppe eintragen, sonst ist sie über die
// Gruppen-Navigation nicht erreichbar (nur noch unter „Alle"). "other" ist bewusst
// keiner Gruppe zugeordnet (eigener „Sonstige"-Pill).

export interface CategoryGroup {
  slug: string
  name: string
  /** Kurzlabel für die Section-Tab-Navigation (Ein-Wort, damit Ebene 1 kompakt bleibt). */
  short: string
  categories: string[]
}

export const CATEGORY_GROUPS: CategoryGroup[] = [
  { slug: 'sprachmodelle', name: 'Sprachmodelle', short: 'Sprachmodelle', categories: ['frontier-llms', 'open-source-llms', 'reasoning-models', 'small-language-models', 'multimodal-models'] },
  { slug: 'coding', name: 'Coding & Entwicklung', short: 'Coding', categories: ['coding-agents', 'ai-ides', 'ide-extensions', 'code-review', 'cli-tools'] },
  { slug: 'agenten', name: 'Assistenten & Agenten', short: 'Agenten', categories: ['consumer-assistants', 'enterprise-copilots', 'chatbots', 'agent-frameworks', 'browser-desktop-agents'] },
  { slug: 'medien', name: 'Bild, Video & 3D', short: 'Medien', categories: ['text-to-image', 'text-to-video', 'image-editing', 'world-generation'] },
  { slug: 'audio', name: 'Audio & Sprache', short: 'Audio', categories: ['text-to-speech', 'speech-to-text', 'voice-agents', 'music-generation', 'translation'] },
  { slug: 'produktivitaet', name: 'Produktivität & Content', short: 'Produktivität', categories: ['ai-search', 'knowledge-management', 'presentation-design', 'video-editing', 'no-code-builders', 'web-development', 'learning-productivity'] },
  { slug: 'infrastruktur', name: 'Infrastruktur & Tooling', short: 'Infrastruktur', categories: ['inference-serving', 'local-runtimes', 'llm-gateways', 'observability-evals', 'ai-detection', 'embeddings-vector', 'prompt-dev-tools'] },
  { slug: 'hardware', name: 'Hardware & Cloud', short: 'Hardware', categories: ['training-chips', 'inference-chips', 'cloud-mlops'] },
  { slug: 'branchen', name: 'Branchen & Einsatz', short: 'Branchen', categories: ['enterprise-agent-platforms', 'science-bio', 'robotics', 'autonomous-driving', 'healthcare', 'legal-compliance', 'customer-service', 'marketing-sales', 'automation-workflow'] },
]

const CAT_TO_GROUP = new Map<string, string>()
for (const g of CATEGORY_GROUPS) for (const c of g.categories) CAT_TO_GROUP.set(c, g.slug)

/** Meta-Gruppen-Slug für eine Kategorie (null, falls in keiner Gruppe — z.B. "other"). */
export function groupForCategory(categorySlug: string): string | null {
  return CAT_TO_GROUP.get(categorySlug) ?? null
}

/** Meta-Gruppe per Slug. */
export function groupBySlug(groupSlug: string): CategoryGroup | undefined {
  return CATEGORY_GROUPS.find((g) => g.slug === groupSlug)
}
