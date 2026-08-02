# Rankings Attribution-QS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jedes Charts-Produkt wird korrekt einem Unternehmen zugeordnet — via kanonischer Vendor-Alias-Schicht (Display + Resolve) und einer täglichen QS-Cron-Phase, die `unknown`-/falsch-attribuierte Fragmente deterministisch bzw. LLM-verifiziert in ihren Kanon merged.

**Architecture:** Zwei Hälften. **Prävention:** reines Modul `vendor-canonical.ts` (Alias-Map) wird im Display der Produktseite/Company-Liste und im Resolve neuer Produkte angewandt; der Extract-Prompt bekommt Kanon-Regeln. **Heilung:** neue Cron-Phase `runAttributionQA` (budget-/limit-gedeckelt, marker-basiert wie `runProductResearch`) merged deterministisch (`unknown` + eindeutiges Geschwister) und LLM-verifiziert (Sonnet, Name+Excerpts, Merge nur in ein bereits existierendes Kanon-Produkt bei Confidence ≥ 0,8); Unklares wird in `attribution_qa_flags` protokolliert und im Admin gezeigt.

**Tech Stack:** Next.js 16, TypeScript, Supabase (PostgREST), Anthropic SDK (tool-use), vitest, Supabase-CLI-Migration.

## Global Constraints

- **Merges nur nicht-destruktiv-für-Kanon:** `mergeProductsInto(sb, toId, fromIds)` hängt Mentions/Features um und **löscht** die Quell-(Fragment-)Produkte. Das Ziel (Kanon) behält Slug/URL. Fragment-Slug darf danach 404en (akzeptiert, konsistent zur bestehenden Konsolidierung).
- **Keine Slug-Änderung an bestehenden Produkten** (SEO): Alias wirkt im Display, nie durch Umschreiben von `vendor_namespace`/`slug` bestehender Zeilen.
- **LLM-Merge-Guard:** nur wenn `merge_into_slug` ein **existierendes, sichtbares** Produkt ist UND `confidence ≥ 0.8`. Nie Daten löschen außerhalb `mergeProductsInto`.
- **Budget/Cap:** QS-Phase verarbeitet pro Lauf höchstens `limit` Kandidaten (Default 15), genau ein LLM-Call je Kandidat, Marker `__attribution_qa_at` verhindert Re-Processing.
- **Version ist KEIN QS-Kriterium** (77% der Produkte haben legitim keine).
- **PostgREST 1000-Row-Cap:** jede wachsende `.select()` paginieren (`.range()` + `.order('id')`).
- **Test-Konvention:** vitest, `tests/lib/<name>.test.ts`, `environment: 'node'`. Reine Funktionen testen; DB-/LLM-Orchestrierung wird per Prod-Lauf verifiziert (lokaler `npm run build` scheitert in der Export-Phase — `npx tsc --noEmit` + `npm test` sind die lokalen Gates).
- **Migration** via Supabase-CLI (`supabase db push` bzw. `supabase migration up`); Projekt ist NICHT im MCP.

---

### Task 1: Vendor-Canonical-Modul (rein) + Tests

**Files:**
- Create: `lib/rankings/vendor-canonical.ts`
- Test: `tests/lib/rankings-vendor-canonical.test.ts`

**Interfaces:**
- Produces: `canonicalVendor(ns: string | null | undefined): string`, `vendorDisplayName(ns: string | null | undefined): string`, `namespacesForCompany(companySlug: string): string[]`, `VENDOR_ALIASES: Record<string,string>`

- [ ] **Step 1: Write the failing test**

`tests/lib/rankings-vendor-canonical.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { canonicalVendor, vendorDisplayName, namespacesForCompany } from '@/lib/rankings/vendor-canonical'

describe('canonicalVendor', () => {
  it('mappt Konzern-Sub-Brands auf den Kanon', () => {
    expect(canonicalVendor('amazon-web-services')).toBe('amazon')
    expect(canonicalVendor('aws')).toBe('amazon')
    expect(canonicalVendor('google-deepmind')).toBe('google')
    expect(canonicalVendor('deepmind')).toBe('google')
    expect(canonicalVendor('github')).toBe('microsoft')
    expect(canonicalVendor('mistral-ai')).toBe('mistral')
    expect(canonicalVendor('instagram')).toBe('meta')
  })
  it('lässt bekannte Kanon-Vendors unverändert', () => {
    expect(canonicalVendor('amazon')).toBe('amazon')
    expect(canonicalVendor('openai')).toBe('openai')
  })
  it('normalisiert Casing/Whitespace und lässt unbekannte durch', () => {
    expect(canonicalVendor('  AWS ')).toBe('amazon')
    expect(canonicalVendor('acme-labs')).toBe('acme-labs')
    expect(canonicalVendor('')).toBe('')
    expect(canonicalVendor(null)).toBe('')
  })
})

describe('vendorDisplayName', () => {
  it('liefert schöne Namen für bekannte Vendors (nach Alias)', () => {
    expect(vendorDisplayName('amazon-web-services')).toBe('Amazon')
    expect(vendorDisplayName('openai')).toBe('OpenAI')
    expect(vendorDisplayName('xai')).toBe('xAI')
    expect(vendorDisplayName('mistral-ai')).toBe('Mistral AI')
  })
  it('kapitalisiert unbekannte Slugs lesbar', () => {
    expect(vendorDisplayName('acme-labs')).toBe('Acme Labs')
    expect(vendorDisplayName('unknown')).toBe('Unknown')
  })
})

describe('namespacesForCompany', () => {
  it('liefert den Kanon plus alle Aliase', () => {
    const ns = namespacesForCompany('amazon')
    expect(ns).toContain('amazon')
    expect(ns).toContain('aws')
    expect(ns).toContain('amazon-web-services')
  })
  it('liefert für aliasfreie Company nur sich selbst', () => {
    expect(namespacesForCompany('openai')).toEqual(['openai'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- rankings-vendor-canonical`
Expected: FAIL (`Cannot find module '@/lib/rankings/vendor-canonical'`)

- [ ] **Step 3: Write the module**

`lib/rankings/vendor-canonical.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- rankings-vendor-canonical`
Expected: PASS (alle Assertions grün)

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/vendor-canonical.ts tests/lib/rankings-vendor-canonical.test.ts
git commit -m "feat(rankings): kanonische Vendor-Alias-Schicht (vendor-canonical)"
```

---

### Task 2: Display-Wiring auf der Produktseite

**Files:**
- Modify: `app/[lang]/rankings/[slug]/page.tsx` (Zeilen ~93, 105, 142, 154, 222–223)

**Interfaces:**
- Consumes: `canonicalVendor`, `vendorDisplayName` (Task 1); `getVendorStockSynthszr`/`getVendorSynthesis` (unverändert, bekommen jetzt den Kanon-Vendor).

- [ ] **Step 1: Import ergänzen** (oben bei den Imports)

```ts
import { canonicalVendor, vendorDisplayName } from '@/lib/rankings/vendor-canonical'
```

- [ ] **Step 2: Kanon-Vendor einmal berechnen** — direkt nach `const p = await getProductDetail(...)`/`notFound()` (vor `getVendorSynthesis`), ersetze die betroffenen Aufrufe. Suche:

```ts
  const [vendorSyn, translations] = await Promise.all([getVendorSynthesis(p.vendor), getTranslations(lang as LanguageCode)])
  const vendorStock = vendorSyn ? null : await getVendorStockSynthszr(p.vendor)
```
Ersetze durch:
```ts
  const companyVendor = canonicalVendor(p.vendor)          // aws/amazon-web-services → amazon
  const companyName = vendorDisplayName(p.vendor)          // → „Amazon"
  const [vendorSyn, translations] = await Promise.all([getVendorSynthesis(companyVendor), getTranslations(lang as LanguageCode)])
  const vendorStock = vendorSyn ? null : await getVendorStockSynthszr(companyVendor)
```

- [ ] **Step 3: JSON-LD publisher** — ersetze `publisher: { '@type': 'Organization', name: p.vendor }` durch:
```ts
    publisher: { '@type': 'Organization', name: companyName },
```

- [ ] **Step 4: Avatar** (Zeile ~142) — ersetze `<VendorAvatar vendor={p.vendor} size={44} />` durch:
```tsx
        <VendorAvatar vendor={companyVendor} size={44} />
```

- [ ] **Step 5: Company-Link + Label** (Zeile ~154) — ersetze
```tsx
            <Link href={`/${lang}/companies/${p.vendor}`} className="hover:underline">{p.vendor}</Link>
```
durch:
```tsx
            <Link href={`/${lang}/companies/${companyVendor}`} className="hover:underline">{companyName}</Link>
```

- [ ] **Step 6: Verify + Commit**

Run: `npx tsc --noEmit` → Expected: keine neuen Fehler in dieser Datei.
```bash
git add "app/[lang]/rankings/[slug]/page.tsx"
git commit -m "feat(rankings): Produktseite nutzt Kanon-Vendor für Company-Link/Stock/Avatar/JSON-LD"
```

---

### Task 3: Company-Listing schließt Aliase ein

**Files:**
- Modify: `components/rankings/vendor-products.tsx` (Zeilen ~17, 23)

**Interfaces:**
- Consumes: `namespacesForCompany` (Task 1). Ersetzt den bestehenden `normalizeVendorNamespace`-Import-Nutzen für den Filter.

- [ ] **Step 1: Import + Filter anpassen** — die Komponente filtert Produkte per exaktem `vendor_namespace`. Ersetze den Import
```ts
import { normalizeVendorNamespace } from '@/lib/rankings/resolve-product-payload'
```
durch
```ts
import { normalizeVendorNamespace } from '@/lib/rankings/resolve-product-payload'
import { namespacesForCompany } from '@/lib/rankings/vendor-canonical'
```
und ersetze den Gleichheits-Filter `.eq('products.vendor_namespace', ns)` durch einen IN-Filter über alle zugehörigen Namespaces:
```ts
    const ns = normalizeVendorNamespace(companySlug)
    const namespaces = namespacesForCompany(ns)
    // … in der Query: .in('products.vendor_namespace', namespaces)
```
(Exakter Kontext: die vorhandene `ns`-Zeile beibehalten, `namespaces` daraus ableiten, `.eq(...)` → `.in('products.vendor_namespace', namespaces)`.)

- [ ] **Step 2: Verify + Commit**

Run: `npx tsc --noEmit`
```bash
git add components/rankings/vendor-products.tsx
git commit -m "feat(rankings): Company-Liste zeigt auch aliasierte Vendor-Produkte (aws → amazon)"
```

---

### Task 4: Resolve-Layer kanonisiert neue Produkte

**Files:**
- Modify: `lib/rankings/resolve-product-payload.ts:20-21`
- Test: `tests/lib/rankings-resolve-payload.test.ts` (Alias-Fall ergänzen)

**Interfaces:**
- Consumes: `canonicalVendor` (Task 1).

- [ ] **Step 1: Failing test ergänzen** — in `tests/lib/rankings-resolve-payload.test.ts` einen Fall hinzufügen:
```ts
  it('kanonisiert Konzern-Sub-Brand-Vendors (AWS → amazon)', () => {
    const r = buildProductInsert('Amazon Web Services', 'Bedrock AgentCore')
    expect(r.vendor_namespace).toBe('amazon')
    expect(r.slug.startsWith('amazon-')).toBe(true)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- rankings-resolve-payload`
Expected: FAIL (`vendor_namespace` ist `amazon-web-services`)

- [ ] **Step 3: Kanonisierung einbauen** — in `buildProductInsert` (`resolve-product-payload.ts`) Import ergänzen und Zeile 21 anpassen:
```ts
import { canonicalVendor } from '@/lib/rankings/vendor-canonical'
// …
  const vendor_namespace = canonicalVendor(normalizeVendorNamespace(vendor))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- rankings-resolve-payload`
Expected: PASS (neuer + bestehende Fälle grün)

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/resolve-product-payload.ts tests/lib/rankings-resolve-payload.test.ts
git commit -m "feat(rankings): neue Produkte bekommen Kanon-Vendor beim Resolve"
```

---

### Task 5: Extract-Prompt härten (Prävention)

**Files:**
- Modify: `lib/rankings/extract-products.ts` (System-Prompt, Zeile ~43)

- [ ] **Step 1: Vendor-Regel erweitern** — die bestehende `vendor:`-Prompt-Zeile um Kanon-/Anti-Falsch-Zuordnungs-Regeln ergänzen. Nach der bestehenden Regel diese zwei Sätze anhängen:
```
Konzern-Kanon: nutze immer die Dachmarke — AWS/Amazon Web Services → "Amazon"; DeepMind/Google Cloud/Google Research → "Google"; GitHub/Azure → "Microsoft"; Instagram/WhatsApp → "Meta". Ordne ein etabliertes Produkt (Codex, Gemini, Claude, GPT, Copilot) NIEMALS einer Firma zu, die es nur erwähnt oder integriert — immer dem echten Hersteller (Codex → OpenAI).
```

- [ ] **Step 2: Verify + Commit**

Run: `npm test -- rankings-extract-products` → Expected: bestehende Tests grün (Prompt-Text-Änderung bricht keine Assertion).
```bash
git add lib/rankings/extract-products.ts
git commit -m "feat(rankings): Extract-Prompt mit Vendor-Kanon + Anti-Falsch-Zuordnung"
```

---

### Task 6: Migration — `attribution_qa_flags`

**Files:**
- Create: `supabase/migrations/20260704120000_attribution_qa_flags.sql`

- [ ] **Step 1: Migration schreiben**

```sql
-- QS-Protokoll der Attribution-Cron-Phase (nur intern/service_role).
create table if not exists public.attribution_qa_flags (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  slug text not null,
  current_vendor text not null,
  action text not null check (action in ('merged','flagged','aliased','kept')),
  merged_into_slug text,
  suggested_company text,
  confidence numeric,
  reasoning text,
  created_at timestamptz not null default now()
);
create index if not exists attribution_qa_flags_action_idx
  on public.attribution_qa_flags(action, created_at desc);

alter table public.attribution_qa_flags enable row level security;
-- Keine Policy → nur service_role (bypass RLS). Kein public/anon-Zugriff.
```

- [ ] **Step 2: Anwenden + verifizieren**

Run: `supabase db push` (bzw. `supabase migration up`) gegen das Prod-Projekt.
Verify: `select * from attribution_qa_flags limit 1;` → leer, kein Fehler.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260704120000_attribution_qa_flags.sql
git commit -m "feat(rankings): Migration attribution_qa_flags (QS-Protokoll)"
```

---

### Task 7: `attribution-qa.ts` — QS-Kern (deterministisch + LLM) + Tests

**Files:**
- Create: `lib/rankings/attribution-qa.ts`
- Modify: `lib/ai/model-config.ts` (Use-Case `ranking_attribution_qa` ergänzen)
- Test: `tests/lib/rankings-attribution-qa.test.ts` (reine Funktionen)

**Interfaces:**
- Consumes: `mergeProductsInto` (`consolidate.ts`), `createAdminClient`, `getModelForUseCase`, `canonicalVendor` (Task 1).
- Produces: `runAttributionQA(opts: { limit?: number; minMentions?: number }): Promise<{ merged: number; flagged: number; marked: number }>`, `ATTRIBUTION_QA_AT_DIM`, `buildAttributionPrompt`, `parseAttributionDecision`.

- [ ] **Step 1: Model-Use-Case ergänzen** — in `lib/ai/model-config.ts` die Union (nach `'ranking_extract'`) und `USE_CASE_DEFINITIONS` erweitern:
```ts
  | 'ranking_extract'
  | 'ranking_attribution_qa'
```
```ts
  ranking_attribution_qa: {
    label: 'Rankings — Attribution-QS',
    description: 'Company-Zuordnung von unknown/Fragment-Produkten verifizieren',
    defaultModel: 'claude-sonnet-5',
    allowedProviders: ['anthropic'],
  },
```

- [ ] **Step 2: Failing test für die reinen Funktionen**

`tests/lib/rankings-attribution-qa.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildAttributionPrompt, parseAttributionDecision } from '@/lib/rankings/attribution-qa'

const cand = {
  id: 'p1', slug: 'unknown-watermelon', vendor: 'unknown', family: 'watermelon',
  name: 'Watermelon', mentions: 2, context: 'Meta released Watermelon, a new model.',
  siblings: [{ id: 'p2', slug: 'meta-watermelon', vendor: 'meta', mentions: 4 }],
}

describe('buildAttributionPrompt', () => {
  it('enthält Name, Kontext und die Kandidaten-Slugs', () => {
    const prompt = buildAttributionPrompt(cand)
    expect(prompt).toContain('Watermelon')
    expect(prompt).toContain('meta-watermelon')
    expect(prompt).toContain('Meta released Watermelon')
  })
})

describe('parseAttributionDecision', () => {
  it('parst eine gültige Merge-Entscheidung', () => {
    const d = parseAttributionDecision({ merge_into_slug: 'meta-watermelon', confidence: 0.95, company: 'Meta', reasoning: 'gleiches Produkt' })
    expect(d).toEqual({ mergeIntoSlug: 'meta-watermelon', confidence: 0.95, company: 'Meta', reasoning: 'gleiches Produkt' })
  })
  it('parst null-Merge (kein Kanon-Match)', () => {
    const d = parseAttributionDecision({ merge_into_slug: null, confidence: 0.4, company: null, reasoning: 'unklar' })
    expect(d?.mergeIntoSlug).toBeNull()
  })
  it('liefert null bei kaputter Struktur', () => {
    expect(parseAttributionDecision({ foo: 1 })).toBeNull()
    expect(parseAttributionDecision(null)).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- rankings-attribution-qa`
Expected: FAIL (`Cannot find module '@/lib/rankings/attribution-qa'`)

- [ ] **Step 4: Modul schreiben**

`lib/rankings/attribution-qa.ts`:
```ts
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { mergeProductsInto } from '@/lib/rankings/consolidate'

/** Pseudo-Dimension als Verarbeitungs-Marker (analog __researched_at). */
export const ATTRIBUTION_QA_AT_DIM = '__attribution_qa_at'
const MARKER_CATEGORY = '__meta'
const LLM_TIMEOUT_MS = 50_000
const MERGE_CONFIDENCE = 0.8

export interface QaSibling { id: string; slug: string; vendor: string; mentions: number }
export interface QaCandidate {
  id: string; slug: string; vendor: string; family: string; name: string
  mentions: number; context?: string; siblings: QaSibling[]
}

/** Pure: baut den Verifikations-Prompt. Das Modell darf NUR in eines der gelisteten
 *  Kanon-Produkte mergen (oder null) — keine freie Firmen-Erfindung. */
export function buildAttributionPrompt(c: QaCandidate): string {
  const sibs = c.siblings.length
    ? c.siblings.map((s) => `- ${s.slug} (Hersteller: ${s.vendor}, ${s.mentions} Erwähnungen)`).join('\n')
    : '(keine)'
  return `Ein AI-Produkt in unseren Charts ist evtl. dem falschen/keinem Unternehmen zugeordnet.

PRODUKT: "${c.name}" (aktueller Hersteller-Namespace: "${c.vendor}", ${c.mentions} Erwähnungen)
KONTEXT (aus einer Nachricht): ${c.context ?? '(keiner)'}

MÖGLICHE KANON-PRODUKTE (gleiche Modell-Familie, anderer Hersteller):
${sibs}

Entscheide, ob "${c.name}" in Wahrheit DASSELBE Produkt wie eines der Kanon-Produkte ist
(dann gehört es dorthin gemerged). Beispiele: "Codex" gehört zu OpenAI; ein Artikel, in dem
JetBrains Codex-Support ankündigt, macht Codex NICHT zu einem JetBrains-Produkt.

Antworte via Tool:
- merge_into_slug: der slug des Kanon-Produkts, in das gemerged werden soll — ODER null, wenn es ein eigenständiges/anderes Produkt ist oder unklar.
- confidence: 0..1.
- company: der korrekte Hersteller-Name (auch wenn kein Merge), oder null.
- reasoning: kurz.`
}

const DecisionSchema = z.object({
  merge_into_slug: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  company: z.string().nullable(),
  reasoning: z.string(),
})

export interface AttributionDecision { mergeIntoSlug: string | null; confidence: number; company: string | null; reasoning: string }

/** Pure: validiert die Tool-Antwort. Ungültig ⇒ null. */
export function parseAttributionDecision(raw: unknown): AttributionDecision | null {
  const p = DecisionSchema.safeParse(raw)
  if (!p.success) return null
  return { mergeIntoSlug: p.data.merge_into_slug, confidence: p.data.confidence, company: p.data.company, reasoning: p.data.reasoning }
}

async function decideAttribution(c: QaCandidate): Promise<AttributionDecision | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { getModelForUseCase } = await import('@/lib/ai/model-config')
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const tool = {
    name: 'attribute_product',
    description: 'Company-Zuordnung eines Produkts verifizieren',
    input_schema: {
      type: 'object' as const,
      properties: {
        merge_into_slug: { type: ['string', 'null'] },
        confidence: { type: 'number' },
        company: { type: ['string', 'null'] },
        reasoning: { type: 'string' },
      },
      required: ['merge_into_slug', 'confidence', 'company', 'reasoning'],
    },
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  try {
    const model = await getModelForUseCase('ranking_attribution_qa')
    const resp = await client.messages.create({
      model, max_tokens: 512, tools: [tool],
      tool_choice: { type: 'tool', name: 'attribute_product' },
      messages: [{ role: 'user', content: buildAttributionPrompt(c) }],
    }, { signal: controller.signal })
    const block = resp.content.find((b) => b.type === 'tool_use')
    return parseAttributionDecision(block && 'input' in block ? block.input : null)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

type Sb = ReturnType<typeof createAdminClient>

async function setMarker(sb: Sb, productId: string): Promise<void> {
  await sb.from('product_features_current').upsert(
    { product_id: productId, category: MARKER_CATEGORY, dimension_key: ATTRIBUTION_QA_AT_DIM, value_text: new Date().toISOString() },
    { onConflict: 'product_id,category,dimension_key' },
  )
}

async function flag(sb: Sb, row: Record<string, unknown>): Promise<void> {
  await sb.from('attribution_qa_flags').insert(row)
}

/**
 * Tägliche QS: unknown-/Fragment-Produkte korrekt zuordnen. Deterministisch (eindeutiges
 * Geschwister) bzw. LLM-verifiziert (Merge in existierendes Kanon-Produkt bei Confidence
 * ≥ 0.8). Marker verhindert Re-Processing; `limit` deckelt LLM-Kosten.
 */
export async function runAttributionQA(opts: { limit?: number; minMentions?: number } = {}): Promise<{ merged: number; flagged: number; marked: number }> {
  const limit = opts.limit ?? 15
  const minMentions = opts.minMentions ?? 2
  const sb = createAdminClient()

  // 1. Mention-Counts (chartable) aus product_metrics
  const mc = new Map<string, number>()
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.from('product_metrics').select('product_id, mention_count').gte('mention_count', minMentions).order('product_id').range(off, off + 999)
    if (!data?.length) break
    for (const m of data) mc.set(m.product_id as string, (m.mention_count as number) ?? 0)
    if (data.length < 1000) break
  }
  // 2. alle sichtbaren Produkte
  const prods: Array<{ id: string; slug: string; vendor_namespace: string; family: string; canonical_name: string }> = []
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.from('products').select('id, slug, vendor_namespace, family, canonical_name').eq('visibility_status', 'visible').order('id').range(off, off + 999)
    if (!data?.length) break
    prods.push(...(data as typeof prods))
    if (data.length < 1000) break
  }
  // 3. bereits verarbeitete (Marker)
  const marked = new Set<string>()
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.from('product_features_current').select('product_id').eq('dimension_key', ATTRIBUTION_QA_AT_DIM).order('product_id').range(off, off + 999)
    if (!data?.length) break
    for (const r of data) marked.add(r.product_id as string)
    if (data.length < 1000) break
  }
  // 4. Family-Index (nur sichtbare)
  const byFamily = new Map<string, typeof prods>()
  for (const p of prods) byFamily.set(p.family, [...(byFamily.get(p.family) ?? []), p])

  const mentionsOf = (id: string) => mc.get(id) ?? 0
  const isChartable = (id: string) => mc.has(id)

  // 5. Kandidaten: chartable, unmarkiert, entweder unknown ODER Minderheits-Fragment.
  const candidates = prods.filter((p) => {
    if (marked.has(p.id) || !isChartable(p.id)) return false
    if (p.vendor_namespace === 'unknown') return true
    // Minderheits-Fragment: gleicher family, anderer Vendor dominiert deutlich
    const fam = byFamily.get(p.family) ?? []
    const dominant = fam.find((q) => q.id !== p.id && q.vendor_namespace !== p.vendor_namespace && mentionsOf(q.id) >= 3 * Math.max(1, mentionsOf(p.id)))
    return !!dominant && mentionsOf(p.id) < 5
  }).sort((a, b) => mentionsOf(b.id) - mentionsOf(a.id)).slice(0, limit)

  let merged = 0, flagged = 0, markedCount = 0

  for (const c of candidates) {
    const fam = (byFamily.get(c.family) ?? []).filter((q) => q.id !== c.id && q.vendor_namespace !== c.vendor_namespace)
    // 5a. Deterministisch: unknown + genau EIN bekannter Vendor in der family
    const knownVendors = new Set(fam.filter((q) => q.vendor_namespace !== 'unknown').map((q) => q.vendor_namespace))
    if (c.vendor_namespace === 'unknown' && knownVendors.size === 1) {
      const target = fam.filter((q) => q.vendor_namespace !== 'unknown').sort((a, b) => mentionsOf(b.id) - mentionsOf(a.id))[0]
      await mergeProductsInto(sb, target.id, [c.id])
      await flag(sb, { product_id: c.id, slug: c.slug, current_vendor: c.vendor_namespace, action: 'merged', merged_into_slug: target.slug, confidence: 1, reasoning: 'deterministisch: eindeutiges Vendor-Geschwister' })
      merged++; continue // Quelle gelöscht → kein Marker nötig
    }
    // 5b. LLM: Kontext-Excerpt + Kandidaten-Geschwister
    const { data: ex } = await sb.from('product_mentions').select('excerpt').eq('product_id', c.id).not('excerpt', 'is', null).limit(1)
    const siblings: QaSibling[] = fam.map((q) => ({ id: q.id, slug: q.slug, vendor: q.vendor_namespace, mentions: mentionsOf(q.id) }))
      .sort((a, b) => b.mentions - a.mentions).slice(0, 5)
    const decision = await decideAttribution({
      id: c.id, slug: c.slug, vendor: c.vendor_namespace, family: c.family, name: c.canonical_name,
      mentions: mentionsOf(c.id), context: (ex?.[0]?.excerpt as string | undefined)?.trim().slice(0, 220), siblings,
    })
    const target = decision?.mergeIntoSlug ? siblings.find((s) => s.slug === decision.mergeIntoSlug) : undefined
    if (decision && target && decision.confidence >= MERGE_CONFIDENCE) {
      await mergeProductsInto(sb, target.id, [c.id])
      await flag(sb, { product_id: c.id, slug: c.slug, current_vendor: c.vendor_namespace, action: 'merged', merged_into_slug: target.slug, suggested_company: decision.company, confidence: decision.confidence, reasoning: decision.reasoning })
      merged++; continue // gelöscht → kein Marker
    }
    // 5c. kein sicherer Merge → flaggen (falls Firma vorgeschlagen) bzw. „kept", dann Marker
    await flag(sb, {
      product_id: c.id, slug: c.slug, current_vendor: c.vendor_namespace,
      action: decision?.company ? 'flagged' : 'kept',
      suggested_company: decision?.company ?? null, confidence: decision?.confidence ?? null, reasoning: decision?.reasoning ?? 'kein LLM-Ergebnis',
    })
    if (decision?.company) flagged++
    await setMarker(sb, c.id); markedCount++
  }
  return { merged, flagged, marked: markedCount }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- rankings-attribution-qa`
Expected: PASS (Prompt- + Parser-Tests grün)

Run: `npx tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 6: Commit**

```bash
git add lib/rankings/attribution-qa.ts lib/ai/model-config.ts tests/lib/rankings-attribution-qa.test.ts
git commit -m "feat(rankings): runAttributionQA (deterministische + LLM-verifizierte Company-Zuordnung)"
```

---

### Task 8: Cron-Einhängung + manueller Erst-Lauf

**Files:**
- Modify: `app/api/cron/precompute-metrics/route.ts` (nach `runCategorization`, vor `precomputeMetrics`)

**Interfaces:**
- Consumes: `runAttributionQA` (Task 7).

- [ ] **Step 1: Import + Phase einhängen** — Import ergänzen:
```ts
import { runAttributionQA } from '@/lib/rankings/attribution-qa'
```
Nach dem `categorized`-Block (vor `const { computed } = await precomputeMetrics()`) einfügen:
```ts
    // Attribution-QS: unknown/Fragment-Produkte korrekt zuordnen (Merge in Kanon).
    // Läuft VOR precompute, damit gemergte Fragmente aus den Metriken fallen.
    let attribution = { merged: 0, flagged: 0, marked: 0 }
    try {
      attribution = await runAttributionQA({ limit: 15, minMentions: 2 })
    } catch (e) {
      console.error('[cron] attribution-qa:', e instanceof Error ? e.message : e)
    }
```
und die Response um `attribution` erweitern:
```ts
    return NextResponse.json({ success: true, defrag, categorized, attribution, computed, promos, researched })
```

- [ ] **Step 2: Verify + Commit + Deploy**

Run: `npx tsc --noEmit`
```bash
git add "app/api/cron/precompute-metrics/route.ts"
git commit -m "feat(rankings): Attribution-QS-Phase in den täglichen Cron"
git push origin main
```

- [ ] **Step 3: Manueller Erst-Lauf + Prod-Verifikation (nach Deploy)**

Der Cron ist der einzige Trigger. Für den Sofort-Test die Phase gezielt anstoßen (via Wegwerf-Skript mit Prod-Env, das `runAttributionQA({ limit: 30 })` ruft) ODER den Cron-Endpoint mit gültigem Secret aufrufen. Danach prüfen:
- `unknown-watermelon` existiert nicht mehr / 404 (in `meta-watermelon` gemerged).
- `jetbrains-codex` existiert nicht mehr / 404 (in `openai-codex` gemerged).
- `https://www.synthszr.com/de/rankings/amazon-web-services-aws-finops-agent` zeigt in Header/Company-Link **Amazon** (Alias, ohne Merge — Slug bleibt).
- `select action, count(*) from attribution_qa_flags group by action;` zeigt merged/flagged/kept.

Cache busten: `POST /api/revalidate-rankings` mit `Authorization: Bearer $REVALIDATE_SECRET` (SEC-014 — das Secret gehört nie in die URL).

---

### Task 9: Admin-QS-Report

**Files:**
- Create: `app/api/admin/attribution-qa/route.ts`
- Modify: `app/admin/rankings/page.tsx` (Report-Sektion)

**Interfaces:**
- Consumes: `attribution_qa_flags` (Task 6), `getSession` (Auth, wie andere Admin-Routen).

- [ ] **Step 1: API-Route**

`app/api/admin/attribution-qa/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  const sb = createAdminClient()
  const { data: recent } = await sb.from('attribution_qa_flags')
    .select('slug, current_vendor, action, merged_into_slug, suggested_company, confidence, reasoning, created_at')
    .order('created_at', { ascending: false }).limit(50)
  const counts: Record<string, number> = { merged: 0, flagged: 0, kept: 0, aliased: 0 }
  for (const r of recent ?? []) counts[r.action as string] = (counts[r.action as string] ?? 0) + 1
  return NextResponse.json({ counts, recent: recent ?? [] })
}
```

- [ ] **Step 2: Report-Sektion auf der Admin-Rankings-Seite** — in `app/admin/rankings/page.tsx` einen State + Fetch ergänzen und unterhalb der bestehenden Status-Sektion rendern:
```tsx
  const [qa, setQa] = useState<{ counts: Record<string, number>; recent: Array<{ slug: string; current_vendor: string; action: string; merged_into_slug: string | null; suggested_company: string | null; confidence: number | null; reasoning: string }> } | null>(null)
  useEffect(() => { fetch('/api/admin/attribution-qa').then((r) => r.json()).then(setQa).catch(() => {}) }, [])
```
```tsx
  {qa && (
    <section className="mt-8">
      <h2 className="text-sm font-semibold mb-2">Attribution-QS</h2>
      <p className="text-xs text-gray-500 mb-2">Gemergt {qa.counts.merged ?? 0} · Geflaggt {qa.counts.flagged ?? 0} · Behalten {qa.counts.kept ?? 0}</p>
      <ul className="text-xs space-y-1">
        {qa.recent.filter((r) => r.action === 'flagged').map((r, i) => (
          <li key={i} className="text-gray-700">
            <span className="font-mono">{r.slug}</span> ({r.current_vendor}) → Vorschlag: <strong>{r.suggested_company}</strong> · {r.reasoning}
          </li>
        ))}
      </ul>
    </section>
  )}
```

- [ ] **Step 3: Verify + Commit**

Run: `npx tsc --noEmit`
```bash
git add "app/api/admin/attribution-qa/route.ts" "app/admin/rankings/page.tsx"
git commit -m "feat(rankings): Admin-Report für Attribution-QS-Flags"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- Vendor-Alias-Schicht + Display-Wiring → Tasks 1–3 ✓
- Resolve-Layer-Kanonisierung → Task 4 ✓
- Extract-Prompt-Härtung → Task 5 ✓
- Migration attribution_qa_flags → Task 6 ✓
- runAttributionQA (deterministisch + LLM-verifiziert, budget-gedeckelt) → Task 7 ✓
- Cron-Einhängung → Task 8 ✓
- Admin-QS-Report → Task 9 ✓
- Non-Goal „Version": nirgends geprüft ✓; Standalone-Re-Attribution: v1 flag-only (Task 7 5c) ✓

**Typ-Konsistenz:** `canonicalVendor`/`vendorDisplayName`/`namespacesForCompany` (Task 1) → konsumiert in 2/3/4. `runAttributionQA`-Signatur (Task 7) → konsumiert in 8. `attribution_qa_flags`-Spalten (Task 6) ↔ Insert-Felder (Task 7) ↔ Select (Task 9) stimmen überein.

**Offene Präzisierung bei Umsetzung:** In Task 3 den exakten Query-Ausdruck in `vendor-products.tsx` an die dort vorhandene Supabase-Query anpassen (`.eq(...)` → `.in(...)`); Kontext beim Editieren lesen.
