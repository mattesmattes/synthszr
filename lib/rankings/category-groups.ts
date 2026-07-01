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
  /** Gruppenspezifische, MESSBARE Vergleichs-Dimensionen (zusätzlich zum Backbone). */
  dimensions: string[]
}

/** Universeller Backbone: fast immer auf der Anbieter-Seite belegbar → füllt fast jedes
 *  Produkt und macht auch Cross-Kategorie-Vergleiche aussagekräftig. */
export const BACKBONE_DIMENSIONS = ['Preis', 'Release-Datum', 'Plattform', 'Lizenz']

export const CATEGORY_GROUPS: CategoryGroup[] = [
  { slug: 'sprachmodelle', name: 'Sprachmodelle', short: 'Sprachmodelle', categories: ['frontier-llms', 'open-source-llms', 'reasoning-models', 'small-language-models', 'multimodal-models'], dimensions: ['Kontextfenster (Token)', 'Key-Benchmark (%)', 'Preis pro 1M Token', 'Multimodalität'] },
  { slug: 'coding', name: 'Coding & Entwicklung', short: 'Coding', categories: ['coding-agents', 'ai-ides', 'ide-extensions', 'code-review', 'cli-tools'], dimensions: ['SWE-bench Verified (%)', 'Schnittstelle (IDE/CLI/Web)', 'Unterstützte Sprachen', 'Basis-Modell'] },
  { slug: 'agenten', name: 'Assistenten & Agenten', short: 'Agenten', categories: ['consumer-assistants', 'enterprise-copilots', 'chatbots', 'agent-frameworks', 'browser-desktop-agents'], dimensions: ['Autonomie-Grad', 'Tool-/MCP-Integrationen', 'Modalitäten', 'Kanäle'] },
  { slug: 'medien', name: 'Bild, Video & 3D', short: 'Medien', categories: ['text-to-image', 'text-to-video', 'image-editing', 'world-generation'], dimensions: ['Max-Auflösung', 'Generierungszeit', 'Max. Videolänge', 'Fine-tuning'] },
  { slug: 'audio', name: 'Audio & Sprache', short: 'Audio', categories: ['text-to-speech', 'speech-to-text', 'voice-agents', 'music-generation', 'translation'], dimensions: ['Sprachen', 'Latenz', 'Echtzeit-Streaming', 'Voice-Cloning'] },
  { slug: 'produktivitaet', name: 'Produktivität & Content', short: 'Produktivität', categories: ['ai-search', 'knowledge-management', 'presentation-design', 'video-editing', 'no-code-builders', 'web-development', 'learning-productivity'], dimensions: ['Integrationen', 'Ausgabeformate', 'Kollaboration', 'Basis-Modell'] },
  { slug: 'infrastruktur', name: 'Infrastruktur & Tooling', short: 'Infrastruktur', categories: ['inference-serving', 'local-runtimes', 'llm-gateways', 'observability-evals', 'ai-detection', 'embeddings-vector', 'prompt-dev-tools'], dimensions: ['Unterstützte Modelle/Provider', 'Durchsatz/Latenz', 'Deployment (Self-host/Cloud)', 'Protokoll-Kompatibilität'] },
  { slug: 'hardware', name: 'Hardware & Cloud', short: 'Hardware', categories: ['training-chips', 'inference-chips', 'cloud-mlops'], dimensions: ['Rechenleistung (FLOPS/TOPS)', 'Speicher', 'Fertigungsprozess (nm)', 'Verfügbarkeit'] },
  { slug: 'branchen', name: 'Branchen & Einsatz', short: 'Branchen', categories: ['enterprise-agent-platforms', 'science-bio', 'robotics', 'autonomous-driving', 'healthcare', 'legal-compliance', 'customer-service', 'marketing-sales', 'automation-workflow'], dimensions: ['Einsatzbereich', 'Integrationen', 'Compliance/Zertifizierung', 'Deployment-Modell'] },
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

/** Kuratierte, belegbare Feature-Dimensionen einer Kategorie: Backbone + gruppenspezifisch.
 *  Kategorien ohne Gruppe (z.B. "other") bekommen nur den Backbone. */
export function dimensionsForCategory(categorySlug: string): string[] {
  const groupSlug = groupForCategory(categorySlug)
  const group = groupSlug ? groupBySlug(groupSlug) : undefined
  return [...BACKBONE_DIMENSIONS, ...(group?.dimensions ?? [])]
}
