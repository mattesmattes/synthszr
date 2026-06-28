# Synthszr Rankings — Phase 1a (resolveProduct + Idempotenz) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die deterministische, idempotente `resolveProduct`-Funktion bauen: ein erkannter AI-Produktname (+ Vendor) wird auf einen `products`-Eintrag aufgelöst oder neu angelegt — vendor-sicher, versions-granular, ohne Duplikate bei Wiederanlauf.

**Architecture:** `resolveProduct` nutzt **ausschließlich den exakten `canonical_key`** als Identitäts-Anker (aus Phase-0-`canonicalize`). Pfad: parse → canonical_key → select-or-insert (idempotent, race-safe via `ON CONFLICT DO NOTHING` + re-select) → bei Neu: Identity-Event `created` + Alias registrieren + Family-Embedding (best-effort) → bei Bestehend: `last_seen` aktualisieren. **Keine** Trigram-/Embedding-Fuzzy-Disambiguierung in 1a (die ist Phase 1b mit LLM-Tiebreak und darf Versionen nie mergen). Die reine Payload-Bildung ist als pure Funktion vom DB-Roundtrip getrennt (unit-testbar; SQL-konsistent zum `canonical_key`-GENERATED-Ausdruck).

**Tech Stack:** TypeScript, Supabase (`createAdminClient`, `.upsert`/`.insert` onConflict), `generateEmbedding` (gemini-embedding-001/768), vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-28-synthszr-rankings-design.md` §5 (Kanonisierung). **Memory:** `project_synthszr_rankings.md` (Phase-1-Notizen).
- **Versions-Sicherheit (KRITISCH):** Auflösung NUR über exakten `canonical_key`. Verschiedene version/qualifier ⇒ verschiedene Produkte. In 1a niemals zwei Produkte mergen.
- **Idempotenz:** Mehrfaches `resolveProduct` desselben Namens (und seiner Schreibvarianten) erzeugt GENAU EIN Produkt und GENAU EIN `product_identity_events`-`created`. Race-safe (zwei gleichzeitige Inserts → kein Duplikat).
- **Konsistenz:** Der in JS gebaute `canonical_key` muss exakt dem SQL-GENERATED-Ausdruck entsprechen (`lower(vendor)@lower(family)@coalesce(version,'')@coalesce(qualifier,'')`). Da `products.canonical_key` eine GENERATED column ist, wird er NICHT von JS geschrieben — JS nutzt ihn nur zum Lookup. Schreibe beim Insert `vendor_namespace/family/version/qualifier`, NICHT `canonical_key`.
- **Embeddings sind best-effort:** `generateEmbedding` kann fehlschlagen (API/Key) → Produkt wird trotzdem angelegt (`family_embedding` bleibt null), niemals Abbruch.
- **Tests:** vitest (`npm test`). Pure Logik = echte Unit-Tests. DB-Integrationstest mit `describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)` (läuft nur mit DB-Keys; CI/lokal ohne Keys übersprungen) — zusätzlich Controller-Prod-Verifikation nach der Implementierung.
- **Commits:** ein Commit pro Task, auf `main`, Trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Pure Payload-Bildung `buildProductInsert`

**Files:**
- Create: `lib/rankings/resolve-product.ts`
- Create: `tests/lib/rankings-resolve-product.test.ts`

**Interfaces:**
- Consumes: `parseProductName`, `canonicalKey`, `productSlug` aus `@/lib/rankings/canonicalize` (Phase 0).
- Produces: `interface ProductInsert { vendor_namespace, family, version, qualifier, canonical_name, slug, canonical_key }` und `buildProductInsert(vendor: string, detectedName: string): ProductInsert`. `canonical_key` ist nur zum Lookup (NICHT in den DB-Insert übernehmen — GENERATED). Task 2 konsumiert das.

- [ ] **Step 1: Failing tests schreiben**

```typescript
// tests/lib/rankings-resolve-product.test.ts
import { describe, it, expect } from 'vitest'
import { buildProductInsert } from '@/lib/rankings/resolve-product'

describe('buildProductInsert', () => {
  it('baut vendor/family/version/qualifier + key + slug', () => {
    const r = buildProductInsert('OpenAI', 'GPT-5.6 Earth')
    expect(r.vendor_namespace).toBe('openai')
    expect(r.family).toBe('gpt')
    expect(r.version).toBe('5.6')
    expect(r.qualifier).toBe('earth')
    expect(r.canonical_key).toBe('openai@gpt@5.6@earth')
    expect(r.slug).toBe('openai-gpt-5-6-earth')
    expect(r.canonical_name).toBe('GPT-5.6 Earth')
  })
  it('Schreibvarianten erzeugen denselben canonical_key + slug', () => {
    const a = buildProductInsert('openai', 'GPT-5.6')
    const b = buildProductInsert('OpenAI', 'gpt 5.6')
    expect(a.canonical_key).toBe(b.canonical_key)
    expect(a.slug).toBe(b.slug)
  })
  it('verschiedene Versionen erzeugen verschiedene keys', () => {
    expect(buildProductInsert('openai', 'GPT-5.6').canonical_key)
      .not.toBe(buildProductInsert('openai', 'GPT-5.5').canonical_key)
  })
  it('canonical_name bleibt im Original-Casing erhalten', () => {
    expect(buildProductInsert('anysphere', 'Cursor').canonical_name).toBe('Cursor')
  })
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- rankings-resolve-product`
Expected: FAIL — "Failed to resolve import '@/lib/rankings/resolve-product'".

- [ ] **Step 3: Implementierung**

```typescript
// lib/rankings/resolve-product.ts
import { parseProductName, canonicalKey, productSlug } from '@/lib/rankings/canonicalize'

export interface ProductInsert {
  vendor_namespace: string
  family: string
  version: string | null
  qualifier: string | null
  canonical_name: string
  slug: string
  /** Nur für den Lookup — NICHT in den DB-Insert (products.canonical_key ist GENERATED). */
  canonical_key: string
}

/**
 * Reine, deterministische Payload-Bildung. Vendor wird gelowercased (konsistent
 * zum SQL lower(vendor_namespace)); parseProductName liefert family/version/
 * qualifier bereits lowercase. canonical_name behält das Original-Casing.
 */
export function buildProductInsert(vendor: string, detectedName: string): ProductInsert {
  const parsed = parseProductName(detectedName)
  const vendor_namespace = vendor.toLowerCase()
  return {
    vendor_namespace,
    family: parsed.family,
    version: parsed.version,
    qualifier: parsed.qualifier,
    canonical_name: detectedName,
    slug: productSlug(vendor_namespace, parsed),
    canonical_key: canonicalKey(vendor_namespace, parsed),
  }
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg verifizieren**

Run: `npm test -- rankings-resolve-product`
Expected: PASS (4 Fälle).

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/resolve-product.ts tests/lib/rankings-resolve-product.test.ts
git commit -m "feat(rankings): buildProductInsert (pure Payload-Bildung)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `resolveProduct` (idempotente DB-Auflösung) + Integrationstest

**Files:**
- Modify: `lib/rankings/resolve-product.ts`
- Modify: `tests/lib/rankings-resolve-product.test.ts`

**Interfaces:**
- Consumes: `buildProductInsert` (Task 1); `createAdminClient` aus `@/lib/supabase/admin`; `generateEmbedding` aus `@/lib/embeddings/generator`; `normalizeAlias` aus `@/lib/rankings/canonicalize`.
- Produces: `resolveProduct(opts: { vendor: string; detectedName: string; evidence?: string }): Promise<{ productId: string; canonicalKey: string; isNew: boolean }>`. Phase 1b (extract) konsumiert das pro erkanntem Produkt.

Ablauf (race-safe, idempotent):
1. `buildProductInsert` → `canonical_key`.
2. `SELECT id FROM products WHERE canonical_key = key`. Treffer → `UPDATE last_seen` → return `{isNew:false}`.
3. Kein Treffer → `generateEmbedding(family)` (best-effort, null bei Fehler) → `INSERT ... ON CONFLICT (canonical_key) DO NOTHING` → `.select()`.
   - Insert lieferte Zeile (`isNew=true`): Identity-Event `created` + Alias-Upsert (vendor-scoped, `ON CONFLICT DO NOTHING`).
   - Insert lieferte nichts (Race: parallel angelegt): re-`SELECT` → return `{isNew:false}`.

- [ ] **Step 1: Integrationstest schreiben (skipIf ohne DB-Keys)**

```typescript
import { resolveProduct } from '@/lib/rankings/resolve-product'
import { createAdminClient } from '@/lib/supabase/admin'

const hasDb = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL

describe.skipIf(!hasDb)('resolveProduct — Idempotenz (DB)', () => {
  const supabase = createAdminClient()
  const VENDOR = 'testvendor'
  // Eindeutiger Name pro Lauf, damit parallele Läufe sich nicht stören:
  const NAME = `ZZTest Model 9.9`

  async function cleanup() {
    await supabase.from('products').delete().eq('vendor_namespace', VENDOR)
  }
  beforeAll(cleanup)
  afterAll(cleanup)

  it('mehrfaches resolve + Schreibvariante → genau 1 Produkt, 1 created-Event', async () => {
    const a = await resolveProduct({ vendor: VENDOR, detectedName: NAME })
    const b = await resolveProduct({ vendor: VENDOR, detectedName: 'zztest  model 9.9' }) // Schreibvariante
    const c = await resolveProduct({ vendor: VENDOR, detectedName: NAME })
    expect(a.canonicalKey).toBe(b.canonicalKey)
    expect(a.canonicalKey).toBe(c.canonicalKey)
    expect(a.isNew).toBe(true)
    expect(b.isNew).toBe(false)
    expect(c.isNew).toBe(false)

    const { data: prods } = await supabase.from('products').select('id').eq('vendor_namespace', VENDOR)
    expect(prods).toHaveLength(1)
    const { data: events } = await supabase
      .from('product_identity_events').select('id').eq('product_id', a.productId).eq('event_type', 'created')
    expect(events).toHaveLength(1)
  })

  it('verschiedene Versionen → 2 Produkte', async () => {
    await resolveProduct({ vendor: VENDOR, detectedName: 'ZZVer 1.0' })
    await resolveProduct({ vendor: VENDOR, detectedName: 'ZZVer 2.0' })
    const { data } = await supabase.from('products').select('id').eq('vendor_namespace', VENDOR).like('family', 'zzver')
    expect(data!.length).toBe(2)
  })
})
```

Ergänze `beforeAll, afterAll` (und `describe`) im vitest-Import oben in der Datei.

- [ ] **Step 2: Test laufen lassen**

Run: `npm test -- rankings-resolve-product`
Expected: Ohne DB-Keys → die DB-`describe`-Suite wird SKIPPED (Task-1-Unit-Tests laufen weiter PASS). Falls `.env.local` Prod-Keys hat → FAIL ("resolveProduct is not a function").

- [ ] **Step 3: `resolveProduct` implementieren (an Datei anhängen)**

```typescript
import { createAdminClient } from '@/lib/supabase/admin'
import { generateEmbedding } from '@/lib/embeddings/generator'
import { normalizeAlias } from '@/lib/rankings/canonicalize'

/**
 * Löst einen erkannten Produktnamen idempotent auf den products-Eintrag auf
 * (oder legt ihn an). Identität ausschließlich über den exakten canonical_key.
 */
export async function resolveProduct(opts: {
  vendor: string
  detectedName: string
  evidence?: string
}): Promise<{ productId: string; canonicalKey: string; isNew: boolean }> {
  const supabase = createAdminClient()
  const p = buildProductInsert(opts.vendor, opts.detectedName)

  // 1) Exakter Lookup
  const { data: existing } = await supabase
    .from('products').select('id').eq('canonical_key', p.canonical_key).maybeSingle()
  if (existing) {
    await supabase.from('products').update({ last_seen: new Date().toISOString() }).eq('id', existing.id)
    return { productId: existing.id, canonicalKey: p.canonical_key, isNew: false }
  }

  // 2) Family-Embedding (best-effort)
  let familyEmbedding: number[] | null = null
  try {
    const emb = await generateEmbedding(p.family)
    if (emb.length > 0) familyEmbedding = emb
  } catch { /* non-fatal */ }

  // 3) Race-safe Insert (canonical_key NICHT setzen — GENERATED)
  const { data: inserted } = await supabase
    .from('products')
    .insert({
      vendor_namespace: p.vendor_namespace,
      family: p.family,
      version: p.version,
      qualifier: p.qualifier,
      canonical_name: p.canonical_name,
      slug: p.slug,
      family_embedding: familyEmbedding,
      identity_status: 'candidate',
      visibility_status: 'visible',
      confidence_band: 'low',
    }, { onConflict: 'canonical_key', ignoreDuplicates: true })
    .select('id')
    .maybeSingle()

  if (!inserted) {
    // Race: ein paralleler Lauf hat es angelegt → re-select
    const { data: raced } = await supabase
      .from('products').select('id').eq('canonical_key', p.canonical_key).single()
    return { productId: raced.id, canonicalKey: p.canonical_key, isNew: false }
  }

  // 4) Identity-Event + Alias (beide non-fatal/idempotent)
  await supabase.from('product_identity_events').insert({
    product_id: inserted.id, event_type: 'created', new_key: p.canonical_key,
    confidence: 0, evidence: opts.evidence ?? null,
  })
  await supabase.from('product_aliases').insert({
    product_id: inserted.id, vendor_namespace: p.vendor_namespace,
    alias_raw: opts.detectedName, alias_normalized: normalizeAlias(opts.detectedName), alias_type: 'spelling',
  }, { onConflict: 'vendor_namespace,alias_normalized', ignoreDuplicates: true } as never)

  return { productId: inserted.id, canonicalKey: p.canonical_key, isNew: true }
}
```

- [ ] **Step 4: Test laufen lassen**

Run: `npm test -- rankings-resolve-product`
Expected: Ohne DB-Keys → DB-Suite SKIPPED, Unit-Tests PASS. Mit Keys → alle PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run build` (bis „Compiled successfully") oder `npx tsc --noEmit`
Expected: keine Typfehler in `lib/rankings/resolve-product.ts`.

- [ ] **Step 6: Commit**

```bash
git add lib/rankings/resolve-product.ts tests/lib/rankings-resolve-product.test.ts
git commit -m "feat(rankings): resolveProduct — idempotente, versions-sichere Produktauflösung

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Controller-Prod-Verifikation (nach Task 2, außerhalb vitest)

Da `tests/setup.ts` nur `.env.local` lädt (ohne garantierte DB-Keys), wird die Idempotenz zusätzlich gegen Prod verifiziert: ein temporäres Admin-Skript/Endpoint ruft `resolveProduct` 3× (Name + Schreibvariante) auf, dann REST-Query auf `products` (genau 1 Zeile für den Test-Vendor) + `product_identity_events` (genau 1 `created`), danach Cleanup der Test-Zeilen. (Mit `vercel env pull --environment=production` ins Scratchpad für die Keys.)

## Self-Review

**Spec-Coverage (§5):** Exakter-canonical_key-Anker ✓, idempotenter race-safer Upsert ✓, Identity-Event `created` ✓, vendor-scoped Alias ✓, Family-Embedding gespeichert (best-effort) ✓. Fuzzy-/Embedding-Disambiguierung bewusst Phase 1b (Versions-Merge-Gefahr).

**Phase-1-Notiz-Bezug:** Der Idempotenz-Test adressiert die Review-Notiz „Tick-Abbruch → Wiederanlauf ohne Duplikate" auf Produkt-Ebene. (Observation-Ebene folgt in 1b/1c.)

**Placeholder-Scan:** Keine TODO/TBD. Der `as never`-Cast bei der Alias-Upsert-Option ist nötig, weil supabase-js' Typen `ignoreDuplicates` für `.insert` enger typen — funktional korrekt (Insert mit onConflict).

**Typ-Konsistenz:** `ProductInsert`/`buildProductInsert` (Task 1) → konsumiert in `resolveProduct` (Task 2). `canonical_key` wird nur gelesen, nie geschrieben (GENERATED column).

## Nicht in Phase 1a

- Trigram-/Family-Embedding-Fuzzy-Disambiguierung + LLM-Tiebreak → Phase 1b (find_product_by_alias / find_similar_products_by_family RPCs inkl. anon-REVOKE).
- extract/enrich/aggregate-Bodies, Taxonomie-Resolve, Score → Phase 1b/1c.
