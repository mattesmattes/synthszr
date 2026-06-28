# Synthszr Rankings — Phase 1a (resolveProduct + Idempotenz) Implementation Plan v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die deterministische, idempotente, vendor-sichere `resolveProduct`-Funktion bauen: ein erkannter AI-Produktname (+ Vendor) wird auf einen `products`-Eintrag aufgelöst oder neu angelegt — versions-granular, ohne Duplikate und mit selbstheilender „genau ein created-Event"-Invariante bei Wiederanlauf/Crash.

**Architecture:** Auflösung ausschließlich über den exakten `canonical_key` (Phase-0-`canonicalize`). Pure Payload-Bildung (`resolve-product-payload.ts`) ist DB-/Embedding-frei und damit echt unit-testbar. `resolveProduct` (`resolve-product.ts`) macht race-safe Upsert + selbstheilendes `ensureCreatedEvent`/`ensureAlias` (INSERT + `23505`-Catch gegen DB-Unique-Constraints), läuft in allen Branches → ein Crash zwischen Produkt-Insert und Event/Alias heilt beim nächsten Lauf. Keine Fuzzy-/Embedding-Disambiguierung in 1a.

**Tech Stack:** TypeScript, Supabase (`.upsert` onConflict, INSERT mit 23505-Catch), `generateEmbedding` (gemini-768, best-effort), vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-28-synthszr-rankings-design.md` §5. **Memory:** `project_synthszr_rankings.md`.
- **Phase-0-Prerequisite (erfüllt):** vendor-namespaced Slugs (`productSlug(vendorNamespace, parsed)`) + vendor-scoped Aliases (`product_aliases.vendor_namespace`, `UNIQUE(vendor_namespace, alias_normalized)`) sind migriert. `products.canonical_key` ist GENERATED (`lower(vendor_namespace)@lower(family)@coalesce(version,'')@coalesce(qualifier,'')`).
- **Versions-Sicherheit (KRITISCH):** Auflösung NUR über exakten `canonical_key`. Verschiedene version/qualifier ⇒ verschiedene Produkte. Verschiedene Vendors mit gleichem Namen ⇒ verschiedene Produkte. Kein Merge in 1a.
- **Idempotenz + Crash-Safety:** Mehrfaches resolve (inkl. Schreibvarianten) ⇒ genau 1 Produkt, genau 1 `created`-Event, genau 1 vendor-scoped Alias. Race-safe; ein Crash zwischen Inserts heilt selbst.
- **Input-Validierung:** leerer Vendor, leerer Name oder leere geparste `family` ⇒ `throw`. Keine leeren Identity-Zeilen.
- **canonical_key wird NIE von JS geschrieben** (GENERATED) — nur zum Lookup gebildet. Insert schreibt `vendor_namespace/family/version/qualifier`.
- **Embedding best-effort:** Fehler ODER falsche Dimension (≠768) ⇒ `family_embedding=null`, nie Abbruch.
- **Tests:** vitest. Pure Logik = Unit-Tests (keine DB/Embedding-Imports). DB-Test: `describe.skipIf(!hasDbKeys)`, **dynamischer** Import von `resolveProduct` in der Suite, **random Vendor pro Lauf**, Embedding **gemockt**. Plus Controller-Prod-Verifikation.
- **Commits:** ein Commit pro Task, auf `main`, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Pure Payload-Bildung (`resolve-product-payload.ts`)

**Files:**
- Create: `lib/rankings/resolve-product-payload.ts`
- Create: `tests/lib/rankings-resolve-payload.test.ts`

**Interfaces:**
- Consumes: `parseProductName`, `canonicalKey`, `productSlug` aus `@/lib/rankings/canonicalize`.
- Produces: `normalizeVendorNamespace(raw: string): string`; `interface ProductInsert { vendor_namespace, family, version, qualifier, canonical_name, slug, canonical_key }`; `buildProductInsert(vendor: string, detectedName: string): ProductInsert` (wirft bei leerem Vendor/Name/family). DB-frei. Task 3 konsumiert es.

- [ ] **Step 1: Failing tests schreiben**

```typescript
// tests/lib/rankings-resolve-payload.test.ts
import { describe, it, expect } from 'vitest'
import { buildProductInsert, normalizeVendorNamespace } from '@/lib/rankings/resolve-product-payload'

describe('normalizeVendorNamespace', () => {
  it('normalisiert Casing, Whitespace und Sonderzeichen', () => {
    expect(normalizeVendorNamespace(' Open AI ')).toBe('open-ai')
    expect(normalizeVendorNamespace('OpenAI')).toBe('openai')
    expect(normalizeVendorNamespace('open-ai')).toBe('open-ai')
  })
})

describe('buildProductInsert', () => {
  it('baut Felder + key + slug', () => {
    const r = buildProductInsert('OpenAI', 'GPT-5.6 Earth')
    expect(r.vendor_namespace).toBe('openai')
    expect(r.family).toBe('gpt'); expect(r.version).toBe('5.6'); expect(r.qualifier).toBe('earth')
    expect(r.canonical_key).toBe('openai@gpt@5.6@earth')
    expect(r.slug).toBe('openai-gpt-5-6-earth')
    expect(r.canonical_name).toBe('GPT-5.6 Earth')
  })
  it('Schreibvarianten → selber key + slug', () => {
    expect(buildProductInsert('openai', 'GPT-5.6').canonical_key)
      .toBe(buildProductInsert('OpenAI', 'gpt 5.6').canonical_key)
  })
  it('verschiedene Versionen → verschiedene keys', () => {
    expect(buildProductInsert('openai', 'GPT-5.6').canonical_key)
      .not.toBe(buildProductInsert('openai', 'GPT-5.5').canonical_key)
  })
  it('robuste Vendor-Normalisierung im key/slug', () => {
    expect(buildProductInsert(' Open AI ', 'GPT-5.6').vendor_namespace).toBe('open-ai')
    expect(buildProductInsert(' Open AI ', 'GPT-5.6').slug).toBe('open-ai-gpt-5-6')
  })
  it('lehnt leere Inputs ab', () => {
    expect(() => buildProductInsert('', 'GPT-5.6')).toThrow()
    expect(() => buildProductInsert('openai', '')).toThrow()
    expect(() => buildProductInsert('openai', '   ')).toThrow()
  })
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- rankings-resolve-payload` → FAIL ("Failed to resolve import …").

- [ ] **Step 3: Implementierung**

```typescript
// lib/rankings/resolve-product-payload.ts
import { parseProductName, canonicalKey, productSlug } from '@/lib/rankings/canonicalize'

export interface ProductInsert {
  vendor_namespace: string
  family: string
  version: string | null
  qualifier: string | null
  canonical_name: string
  slug: string
  /** Nur zum Lookup — NICHT in den DB-Insert (products.canonical_key ist GENERATED). */
  canonical_key: string
}

/** Robuste Vendor-Namespace-Normalform: casefold + Sonderzeichen→'-' (konsistent zu slug). */
export function normalizeVendorNamespace(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Reine, deterministische Payload-Bildung. Wirft bei leerem Vendor/Name/family. */
export function buildProductInsert(vendor: string, detectedName: string): ProductInsert {
  const vendor_namespace = normalizeVendorNamespace(vendor)
  if (!vendor_namespace) throw new Error('buildProductInsert: vendor_namespace leer')
  const name = detectedName.trim()
  if (!name) throw new Error('buildProductInsert: detectedName leer')
  const parsed = parseProductName(name) // wirft selbst bei leerem Namen (Phase-0-guard)
  if (!parsed.family) throw new Error('buildProductInsert: family leer')
  return {
    vendor_namespace,
    family: parsed.family,
    version: parsed.version,
    qualifier: parsed.qualifier,
    canonical_name: name,
    slug: productSlug(vendor_namespace, parsed),
    canonical_key: canonicalKey(vendor_namespace, parsed),
  }
}
```

- [ ] **Step 4: Test laufen lassen** → `npm test -- rankings-resolve-payload` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/resolve-product-payload.ts tests/lib/rankings-resolve-payload.test.ts
git commit -m "feat(rankings): pure buildProductInsert + normalizeVendorNamespace

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Migration — Partial-Unique-Index für created-Event

**Files:**
- Create: `supabase/migrations/20260628180000_rankings_one_created_event.sql`

**Interfaces:**
- Produces: garantiert höchstens EIN `product_identity_events`-Eintrag mit `event_type='created'` pro `product_id` (DB-Ebene). Task 3 verlässt sich darauf (INSERT + 23505-Catch = race-safe ohne Duplikat).

- [ ] **Step 1: Migration schreiben**

```sql
-- Genau-ein-created-Event pro Produkt auf DB-Ebene garantieren (Phase 1a).
-- resolveProduct macht INSERT + fängt 23505 (unique_violation) ab → race-safe,
-- selbstheilend, ohne auf PostgREST-onConflict gegen einen Partial-Index zu setzen.
CREATE UNIQUE INDEX IF NOT EXISTS product_identity_events_one_created_per_product
  ON product_identity_events(product_id)
  WHERE event_type = 'created';
```

- [ ] **Step 2: Anwenden** → `supabase db push --dry-run` (zeigt nur diese Migration), dann `echo "y" | supabase db push` → "Finished" ohne Fehler.

- [ ] **Step 3: Verifizieren** (Prod-Keys via `vercel env pull --environment=production` ins Scratchpad):

```bash
# Index existiert (zwei created-Events auf dieselbe product_id → 2. schlägt fehl):
curl -s "$SUPABASE_URL/rest/v1/product_identity_events?select=id&limit=1" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK" -o /dev/null -w "%{http_code}\n"   # 200
```
(Die echte Duplikat-Abwehr wird im Task-3-Integrationstest geprüft.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260628180000_rankings_one_created_event.sql
git commit -m "feat(rankings): Partial-Unique-Index — genau ein created-Event pro Produkt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `resolveProduct` (idempotent, selbstheilend) + Integrationstest

**Files:**
- Create: `lib/rankings/resolve-product.ts`
- Create: `tests/lib/rankings-resolve-product-db.test.ts`

**Interfaces:**
- Consumes: `buildProductInsert`/`ProductInsert` (Task 1); `createAdminClient` (`@/lib/supabase/admin`); `generateEmbedding` (`@/lib/embeddings/generator`); `normalizeAlias` (`@/lib/rankings/canonicalize`). DB-/Embedding-Imports liegen NUR in dieser Datei (Pure-Tests aus Task 1 bleiben sauber).
- Produces: `resolveProduct(opts: { vendor: string; detectedName: string; evidence?: string }): Promise<{ productId: string; canonicalKey: string; isNew: boolean }>`.

Ablauf: `buildProductInsert` → exakter `canonical_key`-SELECT (Treffer → `last_seen`-Update + `ensureCreatedEvent`/`ensureAlias` [Heilung] → isNew:false) → sonst `generateEmbedding` (best-effort, nur wenn `length===768`) → `.upsert({...}, {onConflict:'canonical_key', ignoreDuplicates:true}).select('id').maybeSingle()` → wenn null (Race) re-SELECT (+Heilung, isNew:false) → sonst `ensureCreatedEvent`+`ensureAlias` (isNew:true). `ensureCreatedEvent`/`ensureAlias`: INSERT, bei `error.code==='23505'` ignorieren, sonst throw.

- [ ] **Step 1: Integrationstest schreiben (skipIf, dynamic import, random vendor, Embedding gemockt)**

```typescript
// tests/lib/rankings-resolve-product-db.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('@/lib/embeddings/generator', () => ({ generateEmbedding: vi.fn(async () => [] as number[]) }))

const hasDb = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL

describe.skipIf(!hasDb)('resolveProduct — Idempotenz & Vendor-Sicherheit (DB)', () => {
  const RUN = Math.abs(Date.now() % 100000).toString(36)
  const VENDOR = `zztestvendor-${RUN}`
  let supabase: ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>

  beforeAll(async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    supabase = createAdminClient()
  })
  afterAll(async () => { await supabase.from('products').delete().like('vendor_namespace', `zztestvendor-${RUN}%`) })

  it('mehrfaches resolve + Schreibvariante → 1 Produkt, 1 created, 1 alias', async () => {
    const { resolveProduct } = await import('@/lib/rankings/resolve-product')
    const a = await resolveProduct({ vendor: VENDOR, detectedName: 'ZZModel 9.9' })
    const b = await resolveProduct({ vendor: VENDOR, detectedName: 'zzmodel  9.9' })
    const c = await resolveProduct({ vendor: VENDOR, detectedName: 'ZZModel 9.9' })
    expect(b.canonicalKey).toBe(a.canonicalKey); expect(c.canonicalKey).toBe(a.canonicalKey)
    expect(a.isNew).toBe(true); expect(b.isNew).toBe(false); expect(c.isNew).toBe(false)
    const { data: prods } = await supabase.from('products').select('id').eq('vendor_namespace', VENDOR)
    expect(prods).toHaveLength(1)
    const { data: ev } = await supabase.from('product_identity_events').select('id').eq('product_id', a.productId).eq('event_type', 'created')
    expect(ev).toHaveLength(1)
    const { data: al } = await supabase.from('product_aliases').select('id').eq('product_id', a.productId)
    expect(al!.length).toBeGreaterThanOrEqual(1)
  })

  it('verschiedene Versionen/Qualifier → verschiedene Produkte', async () => {
    const { resolveProduct } = await import('@/lib/rankings/resolve-product')
    const v1 = await resolveProduct({ vendor: VENDOR, detectedName: 'ZZSplit 1.0' })
    const v2 = await resolveProduct({ vendor: VENDOR, detectedName: 'ZZSplit 2.0' })
    const q = await resolveProduct({ vendor: VENDOR, detectedName: 'ZZSplit 1.0 mini' })
    expect(new Set([v1.productId, v2.productId, q.productId]).size).toBe(3)
  })

  it('gleicher Name, verschiedene Vendors → verschiedene Produkte', async () => {
    const { resolveProduct } = await import('@/lib/rankings/resolve-product')
    const a = await resolveProduct({ vendor: `${VENDOR}-a`, detectedName: 'Studio' })
    const b = await resolveProduct({ vendor: `${VENDOR}-b`, detectedName: 'Studio' })
    expect(a.canonicalKey).not.toBe(b.canonicalKey)
    expect(a.productId).not.toBe(b.productId)
  })
})
```

- [ ] **Step 2: Test laufen lassen** → `npm test -- rankings-resolve-product-db` → ohne DB-Keys SKIPPED; mit Keys FAIL (resolveProduct fehlt).

- [ ] **Step 3: Implementierung**

```typescript
// lib/rankings/resolve-product.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { generateEmbedding } from '@/lib/embeddings/generator'
import { normalizeAlias } from '@/lib/rankings/canonicalize'
import { buildProductInsert } from '@/lib/rankings/resolve-product-payload'

type Admin = ReturnType<typeof createAdminClient>

/** INSERT, das eine DB-Unique-Verletzung (23505) als „schon da" toleriert. */
async function insertIgnoreDup(supabase: Admin, table: string, row: Record<string, unknown>) {
  const { error } = await supabase.from(table).insert(row)
  if (error && error.code !== '23505') throw error
}

async function ensureCreatedEvent(supabase: Admin, productId: string, key: string, evidence?: string) {
  await insertIgnoreDup(supabase, 'product_identity_events', {
    product_id: productId, event_type: 'created', new_key: key, confidence: 0, evidence: evidence ?? null,
  })
}

async function ensureAlias(supabase: Admin, productId: string, vendor: string, detectedName: string) {
  await insertIgnoreDup(supabase, 'product_aliases', {
    product_id: productId, vendor_namespace: vendor,
    alias_raw: detectedName, alias_normalized: normalizeAlias(detectedName), alias_type: 'spelling',
  })
}

/**
 * Löst einen erkannten Produktnamen idempotent + selbstheilend auf den
 * products-Eintrag auf. Identität ausschließlich über den exakten canonical_key.
 */
export async function resolveProduct(opts: {
  vendor: string; detectedName: string; evidence?: string
}): Promise<{ productId: string; canonicalKey: string; isNew: boolean }> {
  const supabase = createAdminClient()
  const p = buildProductInsert(opts.vendor, opts.detectedName)

  // 1) Exakter Lookup → Heilung + last_seen
  const { data: existing } = await supabase
    .from('products').select('id').eq('canonical_key', p.canonical_key).maybeSingle()
  if (existing) {
    await supabase.from('products').update({ last_seen: new Date().toISOString() }).eq('id', existing.id)
    await ensureCreatedEvent(supabase, existing.id, p.canonical_key, opts.evidence)
    await ensureAlias(supabase, existing.id, p.vendor_namespace, opts.detectedName)
    return { productId: existing.id, canonicalKey: p.canonical_key, isNew: false }
  }

  // 2) Family-Embedding (best-effort, nur exakte Dimension)
  let familyEmbedding: number[] | null = null
  try { const e = await generateEmbedding(p.family); if (Array.isArray(e) && e.length === 768) familyEmbedding = e } catch { /* non-fatal */ }

  // 3) Race-safe Upsert (canonical_key NICHT setzen — GENERATED)
  const { data: inserted, error: insErr } = await supabase
    .from('products')
    .upsert({
      vendor_namespace: p.vendor_namespace, family: p.family, version: p.version, qualifier: p.qualifier,
      canonical_name: p.canonical_name, slug: p.slug, family_embedding: familyEmbedding,
      identity_status: 'candidate', visibility_status: 'visible', confidence_band: 'low',
    }, { onConflict: 'canonical_key', ignoreDuplicates: true })
    .select('id').maybeSingle()
  if (insErr) throw insErr

  if (!inserted) {
    // Race: parallel angelegt → re-select + Heilung
    const { data: raced } = await supabase
      .from('products').select('id').eq('canonical_key', p.canonical_key).single()
    await ensureCreatedEvent(supabase, raced.id, p.canonical_key, opts.evidence)
    await ensureAlias(supabase, raced.id, p.vendor_namespace, opts.detectedName)
    return { productId: raced.id, canonicalKey: p.canonical_key, isNew: false }
  }

  await ensureCreatedEvent(supabase, inserted.id, p.canonical_key, opts.evidence)
  await ensureAlias(supabase, inserted.id, p.vendor_namespace, opts.detectedName)
  return { productId: inserted.id, canonicalKey: p.canonical_key, isNew: true }
}
```

- [ ] **Step 4: Test laufen lassen** → `npm test -- rankings-resolve-product-db` (ohne Keys SKIPPED, mit Keys PASS) + `npm test -- rankings-resolve-payload` (weiter PASS).

- [ ] **Step 5: Typecheck** → `npm run build` (bis „Compiled successfully") oder `npx tsc --noEmit` → keine Typfehler.

- [ ] **Step 6: Commit**

```bash
git add lib/rankings/resolve-product.ts tests/lib/rankings-resolve-product-db.test.ts
git commit -m "feat(rankings): resolveProduct — idempotent, selbstheilend, versions-/vendor-sicher

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Controller-Prod-Verifikation (nach Task 3)

`vercel env pull --environment=production` ins Scratchpad. Da `tests/setup.ts` nur `.env.local` lädt (ohne garantierte DB-Keys), Idempotenz zusätzlich gegen Prod prüfen: ein Wegwerf-Skript importiert `resolveProduct`, ruft es 3× (Name + Schreibvariante) mit einem random Test-Vendor, dann REST-Query: `products` (genau 1), `product_identity_events` created (genau 1), `product_aliases` (≥1). Vendor-Isolation: gleicher Name unter zwei Test-Vendors → 2 Produkte. Danach Test-Zeilen löschen.

## Self-Review

**Review-Feedback eingearbeitet (P0):** `.upsert` statt `.insert(onConflict)` ✓; created-Event crash-safe via Partial-Unique-Index + 23505-Catch, selbstheilend in allen Branches ✓; dynamic import im DB-Test (kein Bruch vor Skip) ✓; Pure/DB-Datei-Split (Pure-Tests DB-frei) ✓; `normalizeVendorNamespace` ✓; Empty-Guards + Tests ✓; Phase-0-Prerequisite in Constraints ✓. **P1:** Embedding-Dim-Check (===768) ✓; random Vendor pro Lauf ✓; Embedding gemockt ✓.

**Konsistenz:** `buildProductInsert`/`ProductInsert` (Task 1) → `resolveProduct` (Task 3). `canonical_key` nur gelesen (GENERATED). Vendor-Normalisierung in JS deckungsgleich zur DB (SQL `lower()` ändert den schon-normalisierten Wert nicht).

**Placeholder-Scan:** keine TODO/TBD.

## Nicht in Phase 1a (→ 1b/1c)

Trigram-/Family-Embedding-Fuzzy + LLM-Tiebreak (find_product_by_alias / find_similar_products_by_family RPCs, anon-REVOKE); extract/enrich/aggregate-Bodies; Taxonomie-Resolve; Score. `canonical_name`-„bester Display-Name"-Regel + `normalizeAlias`-letter/digit-Angleichung: P1-Notizen für 1b.
