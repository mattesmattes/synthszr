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
  value_raw text,
  value_text text,
  value_numeric real,
  value_bool boolean,
  value_json jsonb,
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
