# Synthszr Rankings — Phase 0 (Identity-Fundament) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das versions-granulare, vendor-sichere Identity-Fundament für den Synthszr-Rankings-Bereich bauen — deterministische, vendor-namespaced Kanonisierung (getestet), das vollständige DB-Schema (alle Tabellen mit RLS, CHECK-Constraints, FKs, typisierten Feature-Werten) und das resumable Job-Skelett mit atomarem Claim. Kein UI, keine Extraktions-/Score-Logik.

**Architecture:** Reine, DB-freie Kanonisierungs-Logik in `lib/rankings/canonicalize.ts` (voll unit-getestet, Herzstück gegen Versions-/Vendor-Verwechslung) + eine vollständige Supabase-Migration (Schema komplett ab Phase 0, inkl. RLS-Policies, CHECK-Constraints, atomarer `claim_ranking_job`-RPC) + ein `ranking_jobs`-Skelett mit isolierter Lease-Logik (`jobs-lease.ts` rein, `jobs.ts` DB). Spätere Phasen füllen Phasen-Bodies, UI und Anreicherung.

**Tech Stack:** Next.js 16, TypeScript, Supabase Postgres (pgvector, pg_trgm, RLS, plpgsql RPC), vitest, Supabase CLI (`supabase db push`).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-28-synthszr-rankings-design.md` (Konzept v2) ist die Referenz.
- **Tests:** vitest. Lauf: `npm test` (= `vitest run`). Filter: `npm test -- <pattern>`. Import: `import { describe, it, expect } from 'vitest'`. Pfad-Alias `@/` → Projektwurzel. `tests/setup.ts` lädt `.env.local`.
- **Migrationen:** `supabase/migrations/<UTC-timestamp>_<name>.sql`, idempotent. Anwendung via `supabase db push` (CLI gelinkt, Keychain-Credentials). Projekt NICHT im Supabase-MCP → ausschließlich CLI.
- **RLS (Projekt-Konvention + Spec):** öffentliche Seiten lesen über den Anon-Server-Client (`@/lib/supabase/server`) → öffentliche Tabellen brauchen `SELECT`-Policies; interne Tabellen: RLS aktiviert, KEINE Policy (nur Service-Role greift zu, bypassed RLS). Schreibzugriff läuft ausschließlich über Service-Role (Cron/Pipeline/Admin) → keine INSERT/UPDATE-Policies nötig.
- **Versionsidentität (KRITISCH):** identische `(vendor, family, version, qualifier)` ⇒ dasselbe Produkt; jede Differenz in `version` ODER `qualifier` ⇒ eigenes Produkt. Schreibvarianten mergen; Versionen/Varianten NIE. Keine Embeddings für Versions-/Vendor-Entscheidungen.
- **Vendor-Sicherheit:** generische Namen („Studio", „Agent", „Operator", „Comet", „Pro") kollidieren über Vendors → `canonical_key`, `slug` UND Alias-Eindeutigkeit sind alle vendor-namespaced.
- **Commits:** ein Commit pro Task, auf `main`. Message endet mit `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Vollständige DB-Schema-Migration (mit RLS, CHECK, FKs, RPC)

**Files:**
- Create: `supabase/migrations/20260628150000_rankings_schema.sql`

**Interfaces:**
- Produces: alle Tabellen aus Spec §4 + `daily_repo`-Erweiterung + RPC `claim_ranking_job(stale_before timestamptz) → ranking_jobs`. Task 4 ruft die RPC; spätere Phasen schreiben/lesen die Tabellen.

- [ ] **Step 1: Migration-Datei schreiben**

```sql
-- Synthszr Rankings — vollständiges Schema (Phase 0). Siehe Konzept v2 §4.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Produkt-Registry (Identity) ---------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_namespace    text NOT NULL,
  family              text NOT NULL,
  version             text,
  qualifier           text,
  canonical_key       text GENERATED ALWAYS AS (
                        lower(vendor_namespace) || '@' || lower(family) || '@' ||
                        coalesce(version,'') || '@' || coalesce(qualifier,'')
                      ) STORED,
  canonical_name      text NOT NULL,
  slug                text NOT NULL,
  vendor_company_slug text,
  vendor_company_type text,
  family_embedding    vector(768),
  identity_status     text NOT NULL DEFAULT 'candidate',
  visibility_status   text NOT NULL DEFAULT 'visible',
  confidence_band     text NOT NULL DEFAULT 'low',
  identity_confidence real NOT NULL DEFAULT 0,
  superseded_by_id    uuid REFERENCES products(id) ON DELETE SET NULL,
  first_seen          timestamptz NOT NULL DEFAULT now(),
  last_seen           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_identity_status_chk CHECK (identity_status IN ('candidate','resolved','merged','archived')),
  CONSTRAINT products_visibility_status_chk CHECK (visibility_status IN ('visible','hidden','suppressed')),
  CONSTRAINT products_confidence_band_chk CHECK (confidence_band IN ('low','medium','high')),
  CONSTRAINT products_identity_confidence_chk CHECK (identity_confidence >= 0 AND identity_confidence <= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS products_canonical_key_uq ON products(canonical_key);
CREATE UNIQUE INDEX IF NOT EXISTS products_slug_uq ON products(slug);
CREATE INDEX IF NOT EXISTS products_family_idx ON products(lower(family));

CREATE TABLE IF NOT EXISTS product_identity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('created','vendor_resolved','merged','split','rebrand','codename_release')),
  old_key text, new_key text, confidence real, evidence text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_identity_events_product_idx ON product_identity_events(product_id);

-- Aliases: vendor-scoped unique (generische Aliase dürfen bei mehreren Vendors existieren)
CREATE TABLE IF NOT EXISTS product_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  vendor_namespace text NOT NULL,
  alias_raw text NOT NULL,
  alias_normalized text NOT NULL,
  alias_type text NOT NULL DEFAULT 'spelling' CHECK (alias_type IN ('spelling','codename','rebrand','locale')),
  confidence real NOT NULL DEFAULT 1,
  source_url text,
  first_seen timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_aliases_vendor_alias_uq ON product_aliases(vendor_namespace, alias_normalized);
CREATE INDEX IF NOT EXISTS product_aliases_trgm_idx ON product_aliases USING gin (alias_normalized gin_trgm_ops);

-- Taxonomie ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_categories (
  slug text PRIMARY KEY,
  name text NOT NULL,
  description text,
  feature_dimensions jsonb NOT NULL DEFAULT '[]'::jsonb,
  display_order int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated','hidden')),
  replaced_by_slug text,
  taxonomy_version text,
  created_by_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  deprecated_at timestamptz
);

CREATE TABLE IF NOT EXISTS product_category_membership (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category text NOT NULL REFERENCES product_categories(slug) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  PRIMARY KEY (product_id, category)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_primary_category_per_product
  ON product_category_membership(product_id) WHERE is_primary = true;

-- News↔Produkt + Kategorie-Relevanz ---------------------------------------------
CREATE TABLE IF NOT EXISTS product_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  daily_repo_id uuid NOT NULL REFERENCES daily_repo(id) ON DELETE CASCADE,
  excerpt text, excerpt_hash text NOT NULL,
  sentiment real CHECK (sentiment IS NULL OR (sentiment >= -1 AND sentiment <= 1)),
  source_credibility text,
  mention_date timestamptz, model text,
  UNIQUE (product_id, daily_repo_id, excerpt_hash)
);
CREATE INDEX IF NOT EXISTS product_mentions_product_date_idx ON product_mentions(product_id, mention_date);

CREATE TABLE IF NOT EXISTS product_mention_categories (
  mention_id uuid NOT NULL REFERENCES product_mentions(id) ON DELETE CASCADE,
  category text NOT NULL REFERENCES product_categories(slug) ON DELETE CASCADE,
  relevance real CHECK (relevance IS NULL OR (relevance >= 0 AND relevance <= 1)),
  evidence_quote text,
  PRIMARY KEY (mention_id, category)
);

-- Feature-Beobachtungen + aufgelöster Zustand (typisierte Werte) -----------------
CREATE TABLE IF NOT EXISTS product_feature_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category text NOT NULL REFERENCES product_categories(slug) ON DELETE CASCADE,
  dimension_key text NOT NULL,
  value_raw text,                 -- Originaltext aus der Quelle ("30s", "4K", "1M tokens")
  value_text text,                -- normalisierter Anzeigewert
  value_numeric real,             -- für Score-Normalisierung
  value_bool boolean,
  value_json jsonb,               -- enum/strukturiert
  source_type text NOT NULL CHECK (source_type IN ('news','research','vendor','independent_review')),
  source_url text, evidence_quote text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  confidence real NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  extraction_model text, extraction_version text
);
CREATE INDEX IF NOT EXISTS pfo_product_cat_dim_idx ON product_feature_observations(product_id, category, dimension_key);

CREATE TABLE IF NOT EXISTS product_features_current (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category text NOT NULL REFERENCES product_categories(slug) ON DELETE CASCADE,
  dimension_key text NOT NULL,
  value_text text, value_numeric real, value_bool boolean, value_json jsonb,
  confidence real NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  evidence_count int NOT NULL DEFAULT 0,
  source_count int NOT NULL DEFAULT 0,
  conflict_status text,
  valid_until timestamptz,
  is_category_leader boolean NOT NULL DEFAULT false,
  PRIMARY KEY (product_id, category, dimension_key)
);

-- Assets ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_family text NOT NULL, vendor_company_slug text,
  type text NOT NULL CHECK (type IN ('logo','screenshot','og_image','monogram')),
  source text NOT NULL CHECK (source IN ('logodev','brandfetch','favicon','og','screenshot_api','press_kit','generated')),
  blob_url text, theme text, width int, height int, blur_data_url text,
  license text, attribution_required boolean NOT NULL DEFAULT false,
  confidence real NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'fallback' CHECK (status IN ('ok','fallback','failed')),
  fetched_at timestamptz, expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS product_assets_family_idx ON product_assets(product_family, type);

-- Tägliche Snapshots ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category text NOT NULL REFERENCES product_categories(slug) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  synthszr_score int NOT NULL CHECK (synthszr_score >= 0 AND synthszr_score <= 100),
  rank int NOT NULL CHECK (rank > 0),
  mention_count int NOT NULL DEFAULT 0,
  momentum real, score_breakdown jsonb, methodology_version text,
  UNIQUE (product_id, category, snapshot_date)
);
CREATE INDEX IF NOT EXISTS product_rankings_cat_date_rank_idx ON product_rankings(category, snapshot_date DESC, rank);

-- Resumabler Job-State ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS ranking_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL DEFAULT 'daily' CHECK (mode IN ('daily','backfill')),
  phase text NOT NULL DEFAULT 'extract' CHECK (phase IN ('extract','enrich','research','aggregate','assets')),
  cursor int NOT NULL DEFAULT 0,
  attempts int NOT NULL DEFAULT 0, max_attempts int NOT NULL DEFAULT 12,
  last_advanced_at timestamptz,
  budget_extract int, budget_research int, budget_assets int,
  spend_tokens int NOT NULL DEFAULT 0, spend_web_searches int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','error')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS ranking_jobs_open_idx ON ranking_jobs(status, created_at) WHERE status IN ('pending','processing');

-- Hilfstabellen -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_slug_redirects (
  old_slug text PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS product_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  field text NOT NULL, value text, reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_product_id uuid, into_product_id uuid, reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS split_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_product_id uuid, new_product_id uuid, reason text, created_at timestamptz NOT NULL DEFAULT now()
);

-- daily_repo: versioniertes Processing + Retry-Metadaten ------------------------
ALTER TABLE daily_repo ADD COLUMN IF NOT EXISTS processed_for_products_at      timestamptz;
ALTER TABLE daily_repo ADD COLUMN IF NOT EXISTS processed_for_products_version text;
ALTER TABLE daily_repo ADD COLUMN IF NOT EXISTS processed_for_products_model   text;
ALTER TABLE daily_repo ADD COLUMN IF NOT EXISTS product_processing_attempts    int NOT NULL DEFAULT 0;
ALTER TABLE daily_repo ADD COLUMN IF NOT EXISTS product_processing_error       text;

-- Atomarer Job-Claim (FOR UPDATE SKIP LOCKED) gegen Cron/Browser-Races ----------
CREATE OR REPLACE FUNCTION claim_ranking_job(stale_before timestamptz)
RETURNS ranking_jobs LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE claimed ranking_jobs;
BEGIN
  UPDATE ranking_jobs SET
    status = 'processing', attempts = attempts + 1,
    started_at = coalesce(started_at, now()), last_advanced_at = now()
  WHERE id = (
    SELECT id FROM ranking_jobs
    WHERE status IN ('pending','processing') AND attempts < max_attempts
      AND (last_advanced_at IS NULL OR last_advanced_at < stale_before)
    ORDER BY created_at LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING * INTO claimed;
  RETURN claimed;
END; $$;

-- RLS: öffentliche Tabellen = public SELECT; interne = RLS an, keine Policy ------
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_category_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_mention_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_features_current ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_assets ENABLE ROW LEVEL SECURITY;
-- interne Tabellen: RLS an, KEINE Policy (nur Service-Role greift zu)
ALTER TABLE product_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_identity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_feature_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranking_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_slug_redirects ENABLE ROW LEVEL SECURITY;
ALTER TABLE merge_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE split_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rankings public read products" ON products FOR SELECT USING (visibility_status = 'visible');
CREATE POLICY "rankings public read categories" ON product_categories FOR SELECT USING (status = 'active');
CREATE POLICY "rankings public read membership" ON product_category_membership FOR SELECT USING (true);
CREATE POLICY "rankings public read mentions" ON product_mentions FOR SELECT USING (true);
CREATE POLICY "rankings public read mention_categories" ON product_mention_categories FOR SELECT USING (true);
CREATE POLICY "rankings public read features" ON product_features_current FOR SELECT USING (true);
CREATE POLICY "rankings public read rankings" ON product_rankings FOR SELECT USING (true);
CREATE POLICY "rankings public read assets" ON product_assets FOR SELECT USING (true);
```

- [ ] **Step 2: Migration anwenden**

Run: `supabase db push --dry-run` (zeigt nur `20260628150000_rankings_schema.sql`), dann `echo "y" | supabase db push`
Expected: `Applying migration 20260628150000_rankings_schema.sql...` … `Finished supabase db push.` ohne Fehler.

- [ ] **Step 3: Schema + RPC verifizieren**

Run (Prod-Keys via `vercel env pull --environment=production` ins Scratchpad):
```bash
curl -s "$SUPABASE_URL/rest/v1/products?select=id,canonical_key,visibility_status&limit=1" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK" -o /dev/null -w "%{http_code}\n"   # 200
curl -s "$SUPABASE_URL/rest/v1/rpc/claim_ranking_job" -X POST -H "apikey: $SRK" \
  -H "Authorization: Bearer $SRK" -H "Content-Type: application/json" \
  -d '{"stale_before":"2020-01-01T00:00:00Z"}' -o /dev/null -w "%{http_code}\n"        # 200 (leer, kein offener Job)
```
Expected: beide `200`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260628150000_rankings_schema.sql
git commit -m "feat(rankings): Phase-0 DB-Schema (RLS, CHECK, FKs, typisierte Features, claim-RPC)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Produktnamen-Parser `parseProductName`

**Files:**
- Create: `lib/rankings/canonicalize.ts`
- Create: `tests/lib/rankings-canonicalize.test.ts`

**Interfaces:**
- Produces: `interface ParsedProduct { family: string; version: string | null; qualifier: string | null }` und `parseProductName(raw: string): ParsedProduct` (wirft bei leerem Namen). Task 3 + spätere Phasen konsumieren beides.

- [ ] **Step 1: Failing tests schreiben**

```typescript
// tests/lib/rankings-canonicalize.test.ts
import { describe, it, expect } from 'vitest'
import { parseProductName } from '@/lib/rankings/canonicalize'

describe('parseProductName', () => {
  it('trennt family, version und qualifier', () => {
    expect(parseProductName('GPT-5.6 Earth')).toEqual({ family: 'gpt', version: '5.6', qualifier: 'earth' })
  })
  it('hält verschiedene Versionen getrennt', () => {
    expect(parseProductName('GPT-5.5')).toEqual({ family: 'gpt', version: '5.5', qualifier: null })
    expect(parseProductName('GPT-5.6')).toEqual({ family: 'gpt', version: '5.6', qualifier: null })
  })
  it('qualifier vor der version (Claude Opus 4.8)', () => {
    expect(parseProductName('Claude Opus 4.8')).toEqual({ family: 'claude', version: '4.8', qualifier: 'opus' })
  })
  it('repariert fehlendes Leerzeichen (GPT5.6 → 5.6)', () => {
    expect(parseProductName('GPT5.6')).toEqual({ family: 'gpt', version: '5.6', qualifier: null })
  })
  it('mergt Schreibvarianten auf dieselbe Zerlegung', () => {
    expect(parseProductName('gpt 5.6')).toEqual(parseProductName('GPT-5.6'))
  })
  it('produkt ohne version', () => {
    expect(parseProductName('Cursor')).toEqual({ family: 'cursor', version: null, qualifier: null })
  })
  it('version mit Buchstaben-Suffix (GPT-4o)', () => {
    expect(parseProductName('GPT-4o')).toEqual({ family: 'gpt', version: '4o', qualifier: null })
  })
  it('Gemini 2.5 Pro', () => {
    expect(parseProductName('Gemini 2.5 Pro')).toEqual({ family: 'gemini', version: '2.5', qualifier: 'pro' })
  })
  it('Claude 3.5 Sonnet', () => {
    expect(parseProductName('Claude 3.5 Sonnet')).toEqual({ family: 'claude', version: '3.5', qualifier: 'sonnet' })
  })
  it('DALL-E 3', () => {
    expect(parseProductName('DALL-E 3')).toEqual({ family: 'dall e', version: '3', qualifier: null })
  })
  it('o3-mini', () => {
    expect(parseProductName('o3-mini')).toEqual({ family: 'o', version: '3', qualifier: 'mini' })
  })
  it('Llama 3.1 405B (size-token als qualifier)', () => {
    expect(parseProductName('Llama 3.1 405B')).toEqual({ family: 'llama', version: '3.1', qualifier: '405b' })
  })
  it('wirft bei leerem Namen', () => {
    expect(() => parseProductName('   ')).toThrow()
  })
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- rankings-canonicalize`
Expected: FAIL — "Failed to resolve import '@/lib/rankings/canonicalize'".

- [ ] **Step 3: Minimal-Implementierung**

```typescript
// lib/rankings/canonicalize.ts

/** Bekannte Produkt-Qualifier (Größen-/Varianten-Tiers), reihenfolge-unabhängig erkannt. */
const QUALIFIERS = new Set([
  'mini', 'nano', 'micro', 'small', 'medium', 'large', 'pro', 'max', 'plus',
  'turbo', 'flash', 'lite', 'air', 'ultra', 'preview', 'beta', 'alpha', 'rc',
  'experimental', 'opus', 'sonnet', 'haiku', 'earth', 'luna', 'instant',
  'thinking', 'vision',
])

/** Modell-Größen-Token wie 405b, 70b, 8b, 1.5b — identitätsrelevant, gelten als qualifier. */
const SIZE_TOKEN = /^\d+(?:\.\d+)?[bmk]$/i

export interface ParsedProduct {
  family: string
  version: string | null
  qualifier: string | null
}

/**
 * Zerlegt einen rohen Produktnamen deterministisch in {family, version, qualifier}.
 * Versionsnummer und Qualifier sind Teil der Produktidentität — Schreibvarianten
 * (Casing, Bindestriche, fehlende Leerzeichen) mergen, Versionen/Varianten nie.
 */
export function parseProductName(raw: string): ParsedProduct {
  const cleaned = raw.trim().replace(/_+/g, ' ').replace(/([a-zA-Z])(\d)/g, '$1 $2')
  const tokens = cleaned.split(/[\s\-/]+/).filter(Boolean)
  if (tokens.length === 0) throw new Error('parseProductName: leerer Produktname')

  let version: string | null = null
  const qualifiers: string[] = []
  const familyTokens: string[] = []

  for (const tok of tokens) {
    const low = tok.toLowerCase()
    if (SIZE_TOKEN.test(low)) { qualifiers.push(low); continue }       // 405b → qualifier (vor version!)
    const vMatch = low.match(/^v?(\d+(?:\.\d+)*[a-z]?)$/)               // 5.6, v3, 4o
    if (vMatch && version === null) { version = vMatch[1]; continue }
    if (QUALIFIERS.has(low)) { qualifiers.push(low); continue }
    familyTokens.push(low)
  }

  return {
    family: familyTokens.join(' ').trim(),
    version,
    qualifier: qualifiers.length ? qualifiers.join(' ') : null,
  }
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg verifizieren**

Run: `npm test -- rankings-canonicalize`
Expected: PASS (alle 13 Fälle).

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/canonicalize.ts tests/lib/rankings-canonicalize.test.ts
git commit -m "feat(rankings): deterministischer Produktnamen-Parser (size-token + empty-guard)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `canonicalKey`, `productSlug` (vendor-namespaced), `normalizeAlias`

**Files:**
- Modify: `lib/rankings/canonicalize.ts`
- Modify: `tests/lib/rankings-canonicalize.test.ts`

**Interfaces:**
- Consumes: `ParsedProduct`, `parseProductName` aus Task 2.
- Produces: `canonicalKey(vendorNamespace: string, p: ParsedProduct): string`, `productSlug(vendorNamespace: string, p: ParsedProduct): string`, `normalizeAlias(raw: string): string`. Pipeline (Phase 1): `canonicalKey` für `ON CONFLICT`-Upsert, `productSlug` für die URL (vendor-namespaced gegen Kollision), `normalizeAlias` für `product_aliases.alias_normalized` (vendor-scoped unique).

- [ ] **Step 1: Failing tests schreiben (anhängen)**

```typescript
import { canonicalKey, productSlug, normalizeAlias } from '@/lib/rankings/canonicalize'

describe('canonicalKey', () => {
  it('baut vendor@family@version@qualifier', () => {
    expect(canonicalKey('openai', parseProductName('GPT-5.6 Earth'))).toBe('openai@gpt@5.6@earth')
  })
  it('trennt verschiedene Vendors bei generischem Namen', () => {
    expect(canonicalKey('google', parseProductName('Studio')))
      .not.toBe(canonicalKey('adobe', parseProductName('Studio')))
  })
  it('leere version/qualifier als leerer Slot', () => {
    expect(canonicalKey('anysphere', parseProductName('Cursor'))).toBe('anysphere@cursor@@')
  })
})

describe('productSlug', () => {
  it('vendor-namespaced, lesbar', () => {
    expect(productSlug('openai', parseProductName('GPT-5.6 Earth'))).toBe('openai-gpt-5-6-earth')
  })
  it('generische Namen kollidieren nicht über Vendors', () => {
    expect(productSlug('google', parseProductName('Studio'))).toBe('google-studio')
    expect(productSlug('adobe', parseProductName('Studio'))).toBe('adobe-studio')
  })
})

describe('normalizeAlias', () => {
  it('casefold + Separator-Normalisierung', () => {
    expect(normalizeAlias('GPT-5.6')).toBe(normalizeAlias('gpt 5.6'))
    expect(normalizeAlias('  Cursor  ')).toBe('cursor')
  })
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- rankings-canonicalize`
Expected: FAIL — "canonicalKey is not a function".

- [ ] **Step 3: Implementierung anhängen**

```typescript
/** Eindeutiger Identitäts-Anker. Vendor zuerst, damit generische Namen nicht kollidieren. */
export function canonicalKey(vendorNamespace: string, p: ParsedProduct): string {
  return `${vendorNamespace.toLowerCase()}@${p.family}@${p.version ?? ''}@${p.qualifier ?? ''}`
}

/** Permanenter, lesbarer URL-Slug — vendor-namespaced gegen Kollision generischer Namen. */
export function productSlug(vendorNamespace: string, p: ParsedProduct): string {
  return [vendorNamespace, p.family, p.version, p.qualifier]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Normalform für product_aliases.alias_normalized (vendor-scoped unique + Trigram-Lookup). */
export function normalizeAlias(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s\-_]+/g, ' ').trim()
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg verifizieren**

Run: `npm test -- rankings-canonicalize`
Expected: PASS (alle Fälle aus Task 2 + Task 3).

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/canonicalize.ts tests/lib/rankings-canonicalize.test.ts
git commit -m "feat(rankings): canonicalKey + vendor-namespaced productSlug + normalizeAlias

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Lease-Logik (isoliert, pure) + `ranking_jobs`-Service mit atomarem Claim

**Files:**
- Create: `lib/rankings/jobs-lease.ts`  (pure, DB-frei → unit-testbar ohne DB-Import)
- Create: `lib/rankings/jobs.ts`        (DB-Service, nutzt `claim_ranking_job`-RPC)
- Create: `tests/lib/rankings-jobs-lease.test.ts`

**Interfaces:**
- Produces (`jobs-lease.ts`): `LEASE_STALE_MS: number`, `isLeaseStale(lastAdvancedAt: string | null, nowMs: number): boolean`, `staleBeforeIso(nowMs: number): string`.
- Produces (`jobs.ts`): `advanceRankingJob(jobId?: string): Promise<string>` — Phase-0-Skelett: atomarer Claim via RPC + Phasen-Dispatch-Stub (`'noop_phase'`). Phase 1 füllt die Bodies.
- Consumes: `createAdminClient` aus `@/lib/supabase/admin`; RPC `claim_ranking_job` aus Task 1.

Begründung: Die reine Lease-Logik liegt in `jobs-lease.ts`, damit der Unit-Test keinen DB-Service-Code lädt (saubere Trennung). Der atomare Claim (`FOR UPDATE SKIP LOCKED` in der RPC) eliminiert das Select-then-Update-Race zwischen Cron und Browser-Treiber.

- [ ] **Step 1: Failing test für die reine Lease-Logik**

```typescript
// tests/lib/rankings-jobs-lease.test.ts
import { describe, it, expect } from 'vitest'
import { LEASE_STALE_MS, isLeaseStale, staleBeforeIso } from '@/lib/rankings/jobs-lease'

describe('isLeaseStale', () => {
  const now = 1_700_000_000_000
  it('null-Stempel ist stale', () => { expect(isLeaseStale(null, now)).toBe(true) })
  it('frischer Stempel ist nicht stale', () => {
    expect(isLeaseStale(new Date(now - 60_000).toISOString(), now)).toBe(false)
  })
  it('alter Stempel ist stale', () => {
    expect(isLeaseStale(new Date(now - LEASE_STALE_MS - 1000).toISOString(), now)).toBe(true)
  })
})

describe('staleBeforeIso', () => {
  it('liegt LEASE_STALE_MS in der Vergangenheit', () => {
    const now = 1_700_000_000_000
    expect(staleBeforeIso(now)).toBe(new Date(now - LEASE_STALE_MS).toISOString())
  })
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- rankings-jobs-lease`
Expected: FAIL — "Failed to resolve import '@/lib/rankings/jobs-lease'".

- [ ] **Step 3: Pure Lease-Logik implementieren**

```typescript
// lib/rankings/jobs-lease.ts

/** Fenster, in dem ein aktiv getriebener Job für den Cron tabu ist (länger als jeder Tick). */
export const LEASE_STALE_MS = 6 * 60 * 1000

/** Darf der Cron den Job übernehmen (Stempel alt genug)? */
export function isLeaseStale(lastAdvancedAt: string | null, nowMs: number): boolean {
  if (!lastAdvancedAt) return true
  return nowMs - new Date(lastAdvancedAt).getTime() >= LEASE_STALE_MS
}

/** ISO-Schwelle für die claim_ranking_job-RPC. */
export function staleBeforeIso(nowMs: number): string {
  return new Date(nowMs - LEASE_STALE_MS).toISOString()
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg verifizieren**

Run: `npm test -- rankings-jobs-lease`
Expected: PASS (4 Fälle).

- [ ] **Step 5: DB-Service-Skelett implementieren**

```typescript
// lib/rankings/jobs.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { staleBeforeIso } from '@/lib/rankings/jobs-lease'

interface RankingJob {
  id: string; phase: string; cursor: number
  attempts: number; max_attempts: number; status: string
}

/**
 * Advance-Skelett. Atomarer Claim via claim_ranking_job-RPC (FOR UPDATE SKIP LOCKED)
 * statt Select-then-Update → kein Race zwischen Cron und Browser-Treiber.
 * Phase 0: Claim + Dispatch-Stub. Phase 1+ füllt die case-Bodies.
 */
export async function advanceRankingJob(_jobId?: string): Promise<string> {
  const supabase = createAdminClient()
  const { data: job, error } = await supabase
    .rpc('claim_ranking_job', { stale_before: staleBeforeIso(Date.now()) })
    .maybeSingle()
  if (error) { console.error('[RankingJobs] claim failed:', error); return 'claim_error' }
  if (!job) return 'no_job'

  const j = job as RankingJob
  switch (j.phase) {
    case 'extract':
    case 'enrich':
    case 'research':
    case 'aggregate':
    case 'assets':
    default:
      return 'noop_phase'   // Phase 1+ implementiert die Phasen-Bodies
  }
}
```

- [ ] **Step 6: Lint + Build-Check (kein neuer Test — DB-Pfad wird in Phase 1 integrationsgetestet)**

Run: `npm test -- rankings-jobs-lease` (weiterhin PASS) und `npx tsc --noEmit` (oder `npm run build` bis „Compiled successfully")
Expected: keine Typfehler in `lib/rankings/jobs.ts`.

- [ ] **Step 7: Commit**

```bash
git add lib/rankings/jobs-lease.ts lib/rankings/jobs.ts tests/lib/rankings-jobs-lease.test.ts
git commit -m "feat(rankings): isolierte Lease-Logik + ranking_jobs-Skelett mit atomarem Claim

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec-Coverage (§4):** Alle Tabellen + `daily_repo`-Erweiterung in Task 1. RLS (öffentlich vs. intern differenziert), CHECK-Constraints (Status-Enums, Wertebereiche sentiment/relevance/confidence/score/rank), Kategorie-FKs (observations/current/rankings/mention_categories), vendor-scoped Alias-Unique, typisierte Feature-Werte (text/numeric/bool/json), Retry-Metadaten auf daily_repo, atomarer claim_ranking_job — alle aus dem Review eingearbeitet.

**Spec-Coverage (§5):** Parser + vendor-namespaced canonicalKey + vendor-namespaced slug + normalizeAlias in Tasks 2–3, getestet inkl. generischer Vendor-Kollision, size-token (Llama 405B), o3-mini, DALL-E, empty-guard. Volle resolveProduct-Logik (Alias→Trigram→Embedding→Upsert, vendor-scoped) ist Phase 1.

**Phase-0-Grenze (§12):** Schema komplett ✓, canonicalize ✓, ranking_jobs-Skelett mit atomarem Claim + isolierter Lease ✓. Kein UI/LLM ✓. Taxonomie-Resolve-Logik + Phasen-Bodies bewusst Phase 1 (Schema steht).

**Placeholder-Scan:** Keine TODO/TBD. `'noop_phase'`-Dispatch ist das definierte Phase-0-Deliverable (Skelett), kein Plan-Platzhalter.

**Typ-Konsistenz:** `ParsedProduct` (Task 2) → konsumiert in Task 3. `canonicalKey(vendorNamespace, p)` / `productSlug(vendorNamespace, p)` Signaturen konsistent Test↔Impl. `LEASE_STALE_MS`/`isLeaseStale`/`staleBeforeIso` in `jobs-lease.ts` definiert, in `jobs.ts` (staleBeforeIso) + Test konsumiert. RPC-Name `claim_ranking_job` konsistent zwischen Migration (Task 1) und `jobs.ts` (Task 4).

---

## Nicht in Phase 0 (bewusst verschoben)

- **`source_domain_reputation`-Tabelle** (Review P1-4): Reviewer akzeptiert Phase 0 mit `source_credibility text` → Tabelle in Phase 4.
- **resolveProduct / Taxonomie-Resolve / Phasen-Bodies / Score / UI / Assets / Web-Research:** Phasen 1–4, eigene Pläne.

## Nächste Phasen (eigene Pläne)

- **Phase 1:** Pipeline-Bodies (extract/enrich/aggregate), resolveProduct (vendor-scoped Alias→Trigram→Family-Embedding→Upsert), Taxonomie-Resolve, Score (Shrinkage, normalisierte feature_strength aus typisierten Werten), Idempotenz-Integrationstest.
- **Phase 2:** Asset-Pipeline + vier Seiten + ISR + A11y-Leader + Multi-Kategorie-Canonical.
- **Phase 3:** Web-Research, Feature-Konflikt-Resolution, Merge/Split + Reconciler, Korrekturkanal, Golden-Eval, Backfill.
- **Phase 4 (optional):** Post→Produkt-Verlinkung, Signal-Synergie, `source_domain_reputation`, Drift-Dashboard.
