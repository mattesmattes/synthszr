# Synthszr Rankings — Phase 0 (Identity-Fundament) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das versions-granulare, vendor-sichere Identity-Fundament für den Synthszr-Rankings-Bereich bauen — deterministische Produktnamen-Kanonisierung (getestet), das vollständige DB-Schema (alle Ranking-Tabellen mit Constraints) und das resumable Job-Skelett mit Lease. Kein UI, keine Extraktions-/Score-Logik.

**Architecture:** Reine, DB-freie Kanonisierungs-Logik in `lib/rankings/canonicalize.ts` (voll unit-getestet, das Herzstück gegen Versions-/Vendor-Verwechslung) + eine vollständige Supabase-Migration für alle Entitäten (Schema von Anfang an komplett, um spätere Migrationen zu vermeiden) + ein `ranking_jobs`-Skelett nach dem erprobten `article_jobs`-Vorbild (Phasen-State + Lease gegen Cron/Browser-Races). Spätere Phasen füllen die Phasen-Bodies, das UI und die Anreicherung.

**Tech Stack:** Next.js 16, TypeScript, Supabase Postgres (pgvector, pg_trgm), vitest, Supabase CLI (`supabase db push`).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-28-synthszr-rankings-design.md` (Konzept v2) ist die Referenz für alle Felder/Regeln.
- **Tests:** vitest. Lauf: `npm test` (= `vitest run`). Import: `import { describe, it, expect } from 'vitest'`. Pfad-Alias `@/` → Projektwurzel.
- **Migrationen:** liegen in `supabase/migrations/<UTC-timestamp>_<name>.sql`, idempotent (`IF NOT EXISTS`/`DROP … IF EXISTS`). Anwendung auf Prod via `supabase db push` (CLI ist gelinkt, Credentials im macOS-Keychain — kein DB-Passwort nötig). Das Supabase-Projekt ist NICHT im Supabase-MCP erreichbar (andere Org) → ausschließlich CLI.
- **Versionsidentität (KRITISCH):** identische `(vendor, family, version, qualifier)` ⇒ dasselbe Produkt; jede Differenz in `version` ODER `qualifier` ⇒ eigenes Produkt. Schreibvarianten (Casing, Bindestriche, fehlende Leerzeichen) mergen; Versionen/Varianten NIE. Keine Embeddings für Versions-/Vendor-Entscheidungen.
- **LLM rankt nicht:** Phase 0 enthält ohnehin keine LLM-Calls — nur deterministische Logik + Schema.
- **Commits:** häufig, ein Commit pro abgeschlossenem Task. Commit-Messages enden mit `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Auf `main` committen (Projekt-Präferenz).

---

### Task 1: Vollständige DB-Schema-Migration

**Files:**
- Create: `supabase/migrations/20260628150000_rankings_schema.sql`

**Interfaces:**
- Produces: alle Tabellen aus Spec §4 (`products`, `product_identity_events`, `product_aliases`, `product_categories`, `product_category_membership`, `product_mentions`, `product_mention_categories`, `product_feature_observations`, `product_features_current`, `product_assets`, `product_rankings`, `ranking_jobs`, `product_slug_redirects`, `product_overrides`, `merge_log`, `split_log`) + `daily_repo`-Erweiterungsspalten. Spätere Tasks/Phasen schreiben/lesen diese.

- [ ] **Step 1: Migration-Datei schreiben**

```sql
-- Synthszr Rankings — vollständiges Schema (Phase 0). Schema komplett ab Phase 0,
-- damit spätere Phasen ohne Kern-Migrationen auskommen. Siehe Konzept v2 §4.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Kanonische Produkt-Registry (Identity) ----------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_namespace    text NOT NULL,            -- resolved company-slug ODER provisorischer Namespace
  family              text NOT NULL,            -- normalisiert, lowercase
  version             text,                     -- "5.6", "4o", null
  qualifier           text,                     -- "earth"|"mini"|null
  canonical_key       text GENERATED ALWAYS AS (
                        lower(vendor_namespace) || '@' || lower(family) || '@' ||
                        coalesce(version,'') || '@' || coalesce(qualifier,'')
                      ) STORED,
  canonical_name      text NOT NULL,            -- Anzeige, Original-Casing: "GPT-5.6 Earth"
  slug                text NOT NULL,
  vendor_company_slug text,
  vendor_company_type text,                     -- 'public'|'premarket'|null
  family_embedding    vector(768),
  identity_status     text NOT NULL DEFAULT 'candidate',  -- candidate|resolved|merged|archived
  visibility_status   text NOT NULL DEFAULT 'visible',    -- visible|hidden|suppressed
  confidence_band     text NOT NULL DEFAULT 'low',        -- low|medium|high
  identity_confidence real NOT NULL DEFAULT 0,
  superseded_by_id    uuid REFERENCES products(id) ON DELETE SET NULL,
  first_seen          timestamptz NOT NULL DEFAULT now(),
  last_seen           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS products_canonical_key_uq ON products(canonical_key);
CREATE UNIQUE INDEX IF NOT EXISTS products_slug_uq ON products(slug);
CREATE INDEX IF NOT EXISTS products_family_idx ON products(lower(family));

CREATE TABLE IF NOT EXISTS product_identity_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  event_type  text NOT NULL,    -- created|vendor_resolved|merged|split|rebrand|codename_release
  old_key     text,
  new_key     text,
  confidence  real,
  evidence    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_identity_events_product_idx ON product_identity_events(product_id);

CREATE TABLE IF NOT EXISTS product_aliases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  alias_raw        text NOT NULL,
  alias_normalized text NOT NULL,
  alias_type       text NOT NULL DEFAULT 'spelling',  -- spelling|codename|rebrand|locale
  confidence       real NOT NULL DEFAULT 1,
  source_url       text,
  first_seen       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_aliases_normalized_uq ON product_aliases(alias_normalized);
CREATE INDEX IF NOT EXISTS product_aliases_trgm_idx ON product_aliases USING gin (alias_normalized gin_trgm_ops);

-- Taxonomie (auto-erzeugt, persistent, deprecatable) ----------------------------
CREATE TABLE IF NOT EXISTS product_categories (
  slug              text PRIMARY KEY,
  name              text NOT NULL,
  description       text,
  feature_dimensions jsonb NOT NULL DEFAULT '[]'::jsonb,
  display_order     int NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'active',  -- active|deprecated|hidden
  replaced_by_slug  text,
  taxonomy_version  text,
  created_by_run_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deprecated_at     timestamptz
);

CREATE TABLE IF NOT EXISTS product_category_membership (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category   text NOT NULL REFERENCES product_categories(slug) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  PRIMARY KEY (product_id, category)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_primary_category_per_product
  ON product_category_membership(product_id) WHERE is_primary = true;

-- News↔Produkt + Kategorie-Relevanz ---------------------------------------------
CREATE TABLE IF NOT EXISTS product_mentions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  daily_repo_id      uuid NOT NULL REFERENCES daily_repo(id) ON DELETE CASCADE,
  excerpt            text,
  excerpt_hash       text NOT NULL,
  sentiment          real,                 -- −1..1
  source_credibility text,                 -- independent_review|press|vendor_blog|pr_wire
  mention_date       timestamptz,
  model              text,
  UNIQUE (product_id, daily_repo_id, excerpt_hash)
);
CREATE INDEX IF NOT EXISTS product_mentions_product_date_idx ON product_mentions(product_id, mention_date);

CREATE TABLE IF NOT EXISTS product_mention_categories (
  mention_id     uuid NOT NULL REFERENCES product_mentions(id) ON DELETE CASCADE,
  category       text NOT NULL REFERENCES product_categories(slug) ON DELETE CASCADE,
  relevance      real,
  evidence_quote text,
  PRIMARY KEY (mention_id, category)
);

-- Feature-Beobachtungen + aufgelöster Zustand -----------------------------------
CREATE TABLE IF NOT EXISTS product_feature_observations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category          text NOT NULL,
  dimension_key     text NOT NULL,
  value             text,
  value_raw         text,
  source_type       text NOT NULL,        -- news|research|vendor|independent_review
  source_url        text,
  evidence_quote    text,
  observed_at       timestamptz NOT NULL DEFAULT now(),
  confidence        real NOT NULL DEFAULT 0,
  extraction_model  text,
  extraction_version text
);
CREATE INDEX IF NOT EXISTS pfo_product_cat_dim_idx
  ON product_feature_observations(product_id, category, dimension_key);

CREATE TABLE IF NOT EXISTS product_features_current (
  product_id       uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category         text NOT NULL,
  dimension_key    text NOT NULL,
  resolved_value   text,
  confidence       real NOT NULL DEFAULT 0,
  evidence_count   int NOT NULL DEFAULT 0,
  source_count     int NOT NULL DEFAULT 0,
  conflict_status  text,
  valid_until      timestamptz,
  is_category_leader boolean NOT NULL DEFAULT false,
  PRIMARY KEY (product_id, category, dimension_key)
);

-- Assets ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_assets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_family      text NOT NULL,
  vendor_company_slug text,
  type                text NOT NULL,   -- logo|screenshot|og_image|monogram
  source              text NOT NULL,   -- logodev|brandfetch|favicon|og|screenshot_api|press_kit|generated
  blob_url            text,
  theme               text,            -- light|dark|null
  width               int,
  height              int,
  blur_data_url       text,
  license             text,
  attribution_required boolean NOT NULL DEFAULT false,
  confidence          real NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'fallback',  -- ok|fallback|failed
  fetched_at          timestamptz,
  expires_at          timestamptz
);
CREATE INDEX IF NOT EXISTS product_assets_family_idx ON product_assets(product_family, type);

-- Tägliche Ranking-Snapshots ----------------------------------------------------
CREATE TABLE IF NOT EXISTS product_rankings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category           text NOT NULL,
  snapshot_date      date NOT NULL,
  synthszr_score     int NOT NULL,
  rank               int NOT NULL,
  mention_count      int NOT NULL DEFAULT 0,
  momentum           real,
  score_breakdown    jsonb,
  methodology_version text,
  UNIQUE (product_id, category, snapshot_date)
);
CREATE INDEX IF NOT EXISTS product_rankings_cat_date_rank_idx
  ON product_rankings(category, snapshot_date DESC, rank);

-- Resumabler Job-State (nach article_jobs-Vorbild) ------------------------------
CREATE TABLE IF NOT EXISTS ranking_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode              text NOT NULL DEFAULT 'daily',   -- daily|backfill
  phase             text NOT NULL DEFAULT 'extract', -- extract|enrich|research|aggregate|assets
  cursor            int NOT NULL DEFAULT 0,
  attempts          int NOT NULL DEFAULT 0,
  max_attempts      int NOT NULL DEFAULT 12,
  last_advanced_at  timestamptz,
  budget_extract    int,
  budget_research   int,
  budget_assets     int,
  spend_tokens      int NOT NULL DEFAULT 0,
  spend_web_searches int NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'pending',  -- pending|processing|done|error
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  completed_at      timestamptz
);
CREATE INDEX IF NOT EXISTS ranking_jobs_open_idx ON ranking_jobs(status, created_at)
  WHERE status IN ('pending','processing');

-- Hilfstabellen -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_slug_redirects (
  old_slug   text PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS product_overrides (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  field      text NOT NULL,
  value      text,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_product_id uuid, into_product_id uuid, reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS split_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_product_id uuid, new_product_id uuid, reason text, created_at timestamptz NOT NULL DEFAULT now()
);

-- daily_repo: versioniertes Produkt-Processing ----------------------------------
ALTER TABLE daily_repo ADD COLUMN IF NOT EXISTS processed_for_products_at      timestamptz;
ALTER TABLE daily_repo ADD COLUMN IF NOT EXISTS processed_for_products_version text;
ALTER TABLE daily_repo ADD COLUMN IF NOT EXISTS processed_for_products_model   text;
```

- [ ] **Step 2: Migration auf Prod anwenden**

Run: `supabase db push --dry-run` (zeigt: würde nur `20260628150000_rankings_schema.sql` pushen)
Dann: `echo "y" | supabase db push`
Expected: `Applying migration 20260628150000_rankings_schema.sql...` … `Finished supabase db push.` ohne Fehler.

- [ ] **Step 3: Schema verifizieren**

Run (Prod-Keys via `vercel env pull` ins Scratchpad, dann REST gegen die neue Tabelle):
```bash
curl -s "$SUPABASE_URL/rest/v1/products?select=id,canonical_key,identity_status&limit=1" \
  -H "apikey: $SRK" -H "Authorization: Bearer $SRK" -o /dev/null -w "%{http_code}\n"
```
Expected: `200` (Tabelle existiert; leer = `[]`). Ebenso für `ranking_jobs`, `product_categories`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260628150000_rankings_schema.sql
git commit -m "feat(rankings): vollständiges Phase-0 DB-Schema (products, mentions, features, jobs)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Produktnamen-Parser `parseProductName`

**Files:**
- Create: `lib/rankings/canonicalize.ts`
- Create: `tests/lib/rankings-canonicalize.test.ts`

**Interfaces:**
- Produces: `interface ParsedProduct { family: string; version: string | null; qualifier: string | null }` und `parseProductName(raw: string): ParsedProduct`. Task 3 (canonicalKey/slug) und spätere Phasen (resolveProduct) konsumieren beides.

- [ ] **Step 1: Failing test schreiben**

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
  it('erkennt qualifier vor der version (Claude Opus 4.8)', () => {
    expect(parseProductName('Claude Opus 4.8')).toEqual({ family: 'claude', version: '4.8', qualifier: 'opus' })
  })
  it('repariert fehlendes Leerzeichen (GPT5.6 → 5.6)', () => {
    expect(parseProductName('GPT5.6')).toEqual({ family: 'gpt', version: '5.6', qualifier: null })
  })
  it('mergt Schreibvarianten auf dieselbe Zerlegung', () => {
    const a = parseProductName('gpt 5.6')
    const b = parseProductName('GPT-5.6')
    expect(a).toEqual(b)
  })
  it('produkt ohne version', () => {
    expect(parseProductName('Cursor')).toEqual({ family: 'cursor', version: null, qualifier: null })
  })
  it('version mit Buchstaben-Suffix (GPT-4o)', () => {
    expect(parseProductName('GPT-4o')).toEqual({ family: 'gpt', version: '4o', qualifier: null })
  })
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- rankings-canonicalize`
Expected: FAIL — "Failed to resolve import '@/lib/rankings/canonicalize'".

- [ ] **Step 3: Minimal-Implementierung**

```typescript
// lib/rankings/canonicalize.ts

/** Bekannte Produkt-Qualifier (Größen-/Varianten-Tiers). Reihenfolge-unabhängig erkannt. */
const QUALIFIERS = new Set([
  'mini', 'nano', 'micro', 'small', 'medium', 'large', 'pro', 'max', 'plus',
  'turbo', 'flash', 'lite', 'air', 'ultra', 'preview', 'beta', 'alpha', 'rc',
  'experimental', 'opus', 'sonnet', 'haiku', 'earth', 'luna', 'instant',
  'thinking', 'vision',
])

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
  // Separatoren normalisieren; Buchstabe→Ziffer trennen ("GPT5.6" → "GPT 5.6").
  const cleaned = raw.trim().replace(/_+/g, ' ').replace(/([a-zA-Z])(\d)/g, '$1 $2')
  const tokens = cleaned.split(/[\s\-/]+/).filter(Boolean)

  let version: string | null = null
  const qualifiers: string[] = []
  const familyTokens: string[] = []

  for (const tok of tokens) {
    const low = tok.toLowerCase()
    const vMatch = low.match(/^v?(\d+(?:\.\d+)*[a-z]?)$/) // 5.6, v3, 4o
    if (vMatch && version === null) {
      version = vMatch[1]
      continue
    }
    if (QUALIFIERS.has(low)) {
      qualifiers.push(low)
      continue
    }
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
Expected: PASS (alle 7 Fälle).

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/canonicalize.ts tests/lib/rankings-canonicalize.test.ts
git commit -m "feat(rankings): deterministischer Produktnamen-Parser (parseProductName)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `canonicalKey`, `productSlug`, `normalizeAlias`

**Files:**
- Modify: `lib/rankings/canonicalize.ts`
- Modify: `tests/lib/rankings-canonicalize.test.ts`

**Interfaces:**
- Consumes: `ParsedProduct`, `parseProductName` aus Task 2.
- Produces: `canonicalKey(vendorNamespace: string, p: ParsedProduct): string`, `productSlug(p: ParsedProduct): string`, `normalizeAlias(raw: string): string`. Die Pipeline (Phase 1) nutzt `canonicalKey` für `ON CONFLICT`-Upsert, `productSlug` für die URL, `normalizeAlias` für `product_aliases.alias_normalized`.

- [ ] **Step 1: Failing tests schreiben (an bestehende Datei anhängen)**

```typescript
import { canonicalKey, productSlug, normalizeAlias } from '@/lib/rankings/canonicalize'

describe('canonicalKey', () => {
  it('baut vendor@family@version@qualifier', () => {
    const p = parseProductName('GPT-5.6 Earth')
    expect(canonicalKey('openai', p)).toBe('openai@gpt@5.6@earth')
  })
  it('trennt verschiedene Vendors bei generischem Namen', () => {
    const p = parseProductName('Studio')
    expect(canonicalKey('google', p)).not.toBe(canonicalKey('adobe', p))
  })
  it('leere version/qualifier als leerer Slot', () => {
    expect(canonicalKey('anysphere', parseProductName('Cursor'))).toBe('anysphere@cursor@@')
  })
})

describe('productSlug', () => {
  it('lesbarer Slug aus Komponenten', () => {
    expect(productSlug(parseProductName('GPT-5.6 Earth'))).toBe('gpt-5-6-earth')
  })
  it('ohne version/qualifier', () => {
    expect(productSlug(parseProductName('Cursor'))).toBe('cursor')
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
Expected: FAIL — "canonicalKey is not a function" (bzw. import-Fehler).

- [ ] **Step 3: Implementierung anhängen**

```typescript
/** Eindeutiger Identitäts-Anker. Vendor zuerst, damit generische Namen nicht über Vendors kollidieren. */
export function canonicalKey(vendorNamespace: string, p: ParsedProduct): string {
  return `${vendorNamespace.toLowerCase()}@${p.family}@${p.version ?? ''}@${p.qualifier ?? ''}`
}

/** Permanenter, lesbarer URL-Slug aus den geparsten Komponenten (ohne Vendor). */
export function productSlug(p: ParsedProduct): string {
  return [p.family, p.version, p.qualifier]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Normalform für product_aliases.alias_normalized (O(1)-Lookup + Unique). */
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
git commit -m "feat(rankings): canonicalKey/productSlug/normalizeAlias

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `ranking_jobs`-Lease-Logik (pure) + Service-Skelett

**Files:**
- Create: `lib/rankings/jobs.ts`
- Create: `tests/lib/rankings-jobs.test.ts`

**Interfaces:**
- Produces: `LEASE_STALE_MS` (number), `isLeaseStale(lastAdvancedAt: string | null, nowMs: number): boolean`, und das Service-Skelett `advanceRankingJob(jobId?: string): Promise<string>` (in Phase 0 nur Job-Auswahl + Lease-Stempel + Phasen-Dispatch-Stub, der `'noop_phase'` zurückgibt). Phase 1 füllt die Phasen-Bodies (extract/enrich/aggregate).
- Consumes: `createAdminClient` aus `@/lib/supabase/admin` (bestehend, wie in `lib/article-jobs/service.ts`).

Begründung: Der Lease-Mechanismus ist dieselbe Race-Absicherung wie in `lib/article-jobs/service.ts` (Cron vs. Browser). Die reine Schwellen-Logik wird unit-getestet; das DB-Skelett spiegelt das erprobte `article_jobs`-Muster.

- [ ] **Step 1: Failing test für die Lease-Logik schreiben**

```typescript
// tests/lib/rankings-jobs.test.ts
import { describe, it, expect } from 'vitest'
import { LEASE_STALE_MS, isLeaseStale } from '@/lib/rankings/jobs'

describe('isLeaseStale', () => {
  const now = 1_000_000_000_000
  it('null-Stempel ist stale (nie angefasst)', () => {
    expect(isLeaseStale(null, now)).toBe(true)
  })
  it('frischer Stempel ist nicht stale', () => {
    const recent = new Date(now - 60_000).toISOString() // 1 min her
    expect(isLeaseStale(recent, now)).toBe(false)
  })
  it('alter Stempel ist stale', () => {
    const old = new Date(now - LEASE_STALE_MS - 1000).toISOString()
    expect(isLeaseStale(old, now)).toBe(true)
  })
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npm test -- rankings-jobs`
Expected: FAIL — "Failed to resolve import '@/lib/rankings/jobs'".

- [ ] **Step 3: Implementierung (pure Logik + DB-Skelett)**

```typescript
// lib/rankings/jobs.ts
import { createAdminClient } from '@/lib/supabase/admin'

/** Fenster, in dem ein vom aktiven Treiber angefasster Job für den Cron tabu ist
 *  (länger als jeder einzelne Phasen-Tick, analog article_jobs). */
export const LEASE_STALE_MS = 6 * 60 * 1000

/** Ist der Lease-Stempel alt genug, dass der Cron den Job übernehmen darf? */
export function isLeaseStale(lastAdvancedAt: string | null, nowMs: number): boolean {
  if (!lastAdvancedAt) return true
  return nowMs - new Date(lastAdvancedAt).getTime() >= LEASE_STALE_MS
}

interface RankingJob {
  id: string
  phase: string
  cursor: number
  attempts: number
  max_attempts: number
  status: string
  last_advanced_at: string | null
  started_at: string | null
}

/** Ältester offener Job, den der Cron advancen darf (Lease-gefiltert, nach article_jobs). */
async function getNextOpenJob(): Promise<RankingJob | null> {
  const supabase = createAdminClient()
  const staleBefore = new Date(Date.now() - LEASE_STALE_MS).toISOString()
  const { data } = await supabase
    .from('ranking_jobs')
    .select('*')
    .in('status', ['pending', 'processing'])
    .or(`last_advanced_at.is.null,last_advanced_at.lt.${staleBefore}`)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as RankingJob | null) ?? null
}

async function getJobById(id: string): Promise<RankingJob | null> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('ranking_jobs').select('*').eq('id', id).maybeSingle()
  return (data as RankingJob | null) ?? null
}

/**
 * Advance-Skelett: wählt den Job, stempelt den Lease, dispatcht die Phase.
 * Phase 0 implementiert NUR Auswahl + Lease + Dispatch-Stub. Die Phasen-Bodies
 * (extract/enrich/research/aggregate/assets) kommen in Phase 1+.
 */
export async function advanceRankingJob(jobId?: string): Promise<string> {
  const supabase = createAdminClient()
  const job = jobId ? await getJobById(jobId) : await getNextOpenJob()
  if (!job) return 'no_job'
  if (job.status !== 'pending' && job.status !== 'processing') return job.status
  if (job.attempts >= job.max_attempts) {
    await supabase.from('ranking_jobs')
      .update({ status: 'error', error_message: 'max_attempts exceeded', completed_at: new Date().toISOString() })
      .eq('id', job.id)
    return 'error_max_attempts'
  }

  await supabase.from('ranking_jobs').update({
    status: 'processing',
    attempts: job.attempts + 1,
    started_at: job.started_at ?? new Date().toISOString(),
    last_advanced_at: new Date().toISOString(),
  }).eq('id', job.id)

  // Phasen-Dispatch — in Phase 1+ implementiert.
  switch (job.phase) {
    case 'extract':
    case 'enrich':
    case 'research':
    case 'aggregate':
    case 'assets':
    default:
      return 'noop_phase'
  }
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg verifizieren**

Run: `npm test -- rankings-jobs`
Expected: PASS (3 Lease-Fälle). Die DB-Funktionen werden hier nicht aufgerufen (kein DB-Mock nötig).

- [ ] **Step 5: Commit**

```bash
git add lib/rankings/jobs.ts tests/lib/rankings-jobs.test.ts
git commit -m "feat(rankings): ranking_jobs Lease-Logik + Advance-Skelett

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec-Coverage (§4 Datenmodell):** Alle Tabellen aus §4 in Task 1. `daily_repo`-Erweiterung ✓. Identity-Felder (canonical_key generated, status-Trennung, identity_confidence, superseded_by_id) ✓. Constraints: `canonical_key` UNIQUE, `alias_normalized` UNIQUE, Partial-Unique Primary Category, `mentions` UNIQUE(product_id, daily_repo_id, excerpt_hash), `features_current` PK mit category ✓. pgvector + pg_trgm ✓.

**Spec-Coverage (§5 Kanonisierung):** Parser + canonicalKey (vendor-namespaced) + slug + normalizeAlias in Tasks 2–3, getestet gegen die kritischen Fälle (GPT-5.6 vs 5.5 vs Earth vs mini, Tippfehler, generische Vendor-Kollision) ✓. Volle resolveProduct-Logik (Alias→Trigram→Embedding→Upsert gegen DB) ist Phase 1 — Phase 0 liefert die deterministischen Bausteine.

**Phase-0-Grenze (§12):** Schema komplett ✓, canonicalize ✓, ranking_jobs-Skelett mit Lease ✓. Taxonomie-Registry-LOGIK und Phasen-Bodies bewusst in Phase 1 (Schema dafür steht). Kein UI ✓, keine LLM-Calls ✓.

**Placeholder-Scan:** Keine TODO/TBD. Der Phasen-Dispatch in Task 4 gibt bewusst `'noop_phase'` zurück — das ist das definierte Phase-0-Deliverable (Skelett), kein Platzhalter im Plan-Sinn; Phase 1 ersetzt die `case`-Bodies.

**Typ-Konsistenz:** `ParsedProduct` in Task 2 definiert, in Task 3 konsumiert (gleiche Felder family/version/qualifier). `canonicalKey(vendorNamespace, p)`-Signatur konsistent zwischen Task-3-Test und -Impl. `isLeaseStale`/`LEASE_STALE_MS` konsistent zwischen Task-4-Test und -Impl.

---

## Nächste Phasen (eigene Pläne)

- **Phase 1:** Daily-Pipeline-Bodies (extract/enrich/aggregate), Score (Shrinkage, normalisierte feature_strength), resolveProduct-Logik, Taxonomie-Resolve, Idempotenz-Integrationstest.
- **Phase 2:** Asset-Pipeline + vier Seiten + ISR + A11y-Leader.
- **Phase 3:** Web-Research, Feature-Konflikt-Resolution, Merge/Split + Reconciler, Korrekturkanal, Golden-Eval, Backfill.
- **Phase 4 (optional):** Post→Produkt-Verlinkung, Signal-Synergie, source_domain_reputation, Drift-Dashboard.
