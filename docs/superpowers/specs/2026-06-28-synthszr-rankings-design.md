# Synthszr Rankings — Konzept / Design-Spec

**Datum:** 2026-06-28
**Status:** Konzept v2 (genehmigte Weichen + Architektur-Review eingearbeitet), vor Implementierungsplan
**Autor:** Matthias Schrader + Claude

## 1. Überblick & Ziel

Ein neuer öffentlicher Bereich **Synthszr Rankings**, analog zum bestehenden Aktien-Bereich (Synthszr Stocks). AI-**Produkte** (GPT-5.6, Cursor, Cdance 2.5, Veo, OCR-Tools …) werden aus den News-Artikeln (`daily_repo`) extrahiert, in Kategorien gruppiert und nach einem **Synthszr-Score** gerankt — berechnet aus Sentiment/Wahrnehmung **und** harten Produktfeatures der News-Berichterstattung (nicht aus Nutzerbewertungen, nicht aus den veröffentlichten Blog-Posts).

Vier Seiten: Kategorie-Übersicht · Ranking pro Kategorie (Feature-Grid, Top 20) · **Family-Hub** (Versions-Switcher) · Produktdetailseite.

### Kern-Unterscheidung: Produkt ≠ Company
Das System kennt heute nur **Companies** (OpenAI, Anysphere). „Produkt" ist eine **neue, versions-granulare Entität**: eine Company hat mehrere Produkte (OpenAI → GPT-5.6, Sora, …), und jede Version/Variante ist ein eigenes Produkt (GPT-5.6 ≠ GPT-5.5 ≠ GPT-5.6 Earth).

## 2. Genehmigte Entscheidungen

| Thema | Entscheidung |
|---|---|
| Produkt-Erzeugung | **Vollautomatisch** (kein manueller Review, sofort live) |
| Taxonomie | **Vollautomatisch erzeugt**, stabilisiert über persistente Registry mit Deprecation (§6) |
| Sichtbarkeit | **Sofort live**, abgesichert über Score-Shrinkage + Confidence-Band statt Verzögerung (§8) |
| Score-Gewichte | **0.45 Feature / 0.35 Sentiment / 0.20 Momentum** |
| Sentiment-Quelle | LLM-Sentiment je News-Mention, gewichtet aggregiert |
| Update-Rhythmus | **Täglich**, auf idle Tages-Ticks nach dem Article-Job (§7) |
| Feature-Recherche | Natives Web-Search-Tool, eigene gedeckelte Phase mit alias-bewusster Verifikation (§7) |

### LLM-Rolle (geschärft, Review-Punkt 10)
> Das LLM **extrahiert** strukturierte Claims, Mentions, Sentiment, Feature-Beobachtungen und Kategorie-**Kandidaten**. Das **Ranking selbst ist deterministische SQL-/Scoring-Logik.** Das LLM liefert Input, ist niemals Ranking-Autorität — Voraussetzung für Debugging, Reproduzierbarkeit und Vertrauen.

### Unverhandelbare Härtungen
- Deterministischer, **vendor-namespaced** Versions-Parser statt Embedding-Versionstrennung (§5)
- Idempotenz + resumabler Job-State + Audit über Identity-Events (§5, §7)
- **Evidenz als eigene Beobachtungsschicht** + Evidenz-Gate für Werte/Leader — Haftungsrisiko (§4, §8)
- Score-Normalisierung + Shrinkage + **Methodik-Versionierung** (§9)
- Self-Healing (Merge/Split + Reconciler) + Taxonomie-Deprecation (§6, §8)
- Spend-Circuit-Breaker mit **Budgets pro Phase** (§7)

## 3. Architektur-Prinzipien

1. **Sentiment/Feature-Beobachtungen 1× pro News berechnen und cachen.** Die *tägliche* Pipeline aggregiert nur (billige SQL).
2. **Score wartet nie auf Assets oder Web-Recherche.**
3. **Versionsidentität ist deterministisch und vendor-sicher**, nicht LLM-geraten.
4. **Evidenz ist eine Beobachtungshistorie, kein Endzustand** — Werte/Leader/Konflikte werden daraus abgeleitet und sind erklärbar.
5. **Öffentliche URLs sind permanent** (immutable Slugs + Redirects + Canonical-Strategie).

## 4. Datenmodell

Präfix `product_` / `ranking_`. RLS: public read, service-role write.

### `products` (Identity)
```
id                   uuid pk
canonical_key        text GENERATED UNIQUE
   = lower(vendor_namespace)||'@'||lower(family)||'@'||version||'@'||coalesce(qualifier,'')
slug                 text UNIQUE        -- aus geparsten Komponenten, immutabel
canonical_name       text               -- "GPT-5.6 Earth"
vendor_namespace     text               -- resolved company-slug ODER provisorischer, DETERMINISTISCH
                                         -- aus Kontext abgeleiteter Namespace (konsistent bis resolve)
family, version      text
qualifier            text null          -- "earth" | "mini" | "pro" | null
vendor_company_slug  text null          -- bei resolve gesetzt (geteilter Company-Resolver)
vendor_company_type  text null          -- 'public' | 'premarket' | null
family_embedding     vector(768) null   -- NUR Familien-Ebene, nie Versionsentscheidung
identity_status      text               -- 'candidate' | 'resolved' | 'merged' | 'archived'
visibility_status    text               -- 'visible' | 'hidden' | 'suppressed'
confidence_band      text               -- 'low' | 'medium' | 'high'
identity_confidence  real               -- "Ist das wirklich dieses Produkt?"
superseded_by_id     uuid null self-fk  -- Rebrand/Codename-Merge-Ziel
first_seen, last_seen timestamptz
```
**Warum Vendor im Key (Review-Punkt 1):** generische Namen („Studio", „Agent", „Operator", „Comet", „Image 1", „Pro") kollidieren über Vendors. `vendor_namespace` ist anfangs ein deterministisch aus dem Kontext abgeleiteter *provisorischer* Wert (gleiches Produkt → gleicher provisorischer Namespace), wird bei sicherer Vendor-Auflösung über ein Identity-Event auf den Company-Slug umgestellt (ggf. Merge).

### `product_identity_events` (Audit, Review-Punkt 1)
```
id, product_id fk, event_type, -- created|vendor_resolved|merged|split|rebrand|codename_release
old_key, new_key, confidence, evidence, created_at
```
Macht Vendor-Auflösungen, Merges und Splits auditierbar und reversibel.

### `product_aliases`
```
id, product_id fk, alias_raw, alias_normalized UNIQUE,
alias_type, -- 'spelling'|'codename'|'rebrand'|'locale'
confidence, source_url, first_seen
```
`alias_normalized` = casefold + Whitespace/Bindestrich-Normalisierung. **pg_trgm + GIN** für Tippfehler-Match *vor* jeder Embedding-Stufe.

### `product_categories` (auto-erzeugt, persistent, mit Deprecation — Review-Punkt 6)
```
slug pk, name, description, feature_dimensions jsonb, display_order,
status,            -- 'active' | 'deprecated' | 'hidden'
replaced_by_slug null, taxonomy_version, created_by_run_id, created_at, deprecated_at null
```
`feature_dimensions` Achse: `{ key, label_i18n:{de,en,cs,nds}, unit, type:'number'|'bool'|'enum', higher_is_better, importance_weight, status:'active'|'deprecated', replaced_by:null }`. **Append-mostly**: neue Achsen werden hinzugefügt, alte nie umgedeutet — nur deprecated + in UI ausgeblendet.

### `product_category_membership` (M:N)
```
product_id fk, category fk, is_primary bool, PK (product_id, category)
```
```sql
CREATE UNIQUE INDEX one_primary_category_per_product
  ON product_category_membership(product_id) WHERE is_primary = true;
```

### `product_mentions` (News↔Produkt — OHNE Kategorie, Review-Punkt 2)
```
id, product_id fk, daily_repo_id fk, excerpt, excerpt_hash,
sentiment real,            -- −1..1
source_credibility text,   -- 'independent_review'|'press'|'vendor_blog'|'pr_wire'
mention_date, model,
UNIQUE(product_id, daily_repo_id, excerpt_hash)
```

### `product_mention_categories` (Kategorie-Relevanz separat — Review-Punkt 2)
```
mention_id fk, category, relevance real, evidence_quote,
PK (mention_id, category)
```
Eine News kann Gemini im LLM- *und* Video-Kontext erwähnen — sauber getrennt.

### `product_feature_observations` (Beobachtungshistorie — Review-Punkt 3)
```
id, product_id, category, dimension_key, value, value_raw,
source_type,  -- 'news'|'research'|'vendor'|'independent_review'
source_url, evidence_quote, observed_at, confidence,
extraction_model, extraction_version
```

### `product_features_current` (resolved Zustand — aus Observations abgeleitet)
```
product_id, category, dimension_key, resolved_value, confidence,
evidence_count, source_count, conflict_status,
valid_until, is_category_leader,
PK (product_id, category, dimension_key)
```
Trennt Rohdaten von aufgelöstem Zustand → Konflikte (Vendor-Claim vs. unabhängige Quelle), veraltete Specs und Leader-Entscheidungen sind erklärbar. `feature_confidence` lebt hier.

### `product_assets` (visueller Layer)
```
id, product_family, vendor_company_slug null,
type,   -- 'logo'|'screenshot'|'og_image'|'monogram'
source, -- 'logodev'|'brandfetch'|'favicon'|'og'|'screenshot_api'|'press_kit'|'generated'
blob_url, theme null, width, height, blur_data_url, -- thumbhash
license, attribution_required, confidence, status, fetched_at, expires_at
```
**Assets hängen an `product_family`/Vendor, nicht an der Version** (GPT-5.6 & „Earth" teilen das Familienlogo).

### `product_rankings` (täglicher Snapshot, methodik-versioniert — Review-Punkt 5)
```
id, product_id, category, snapshot_date,
synthszr_score int, rank int, mention_count, momentum real,
score_breakdown jsonb,        -- inkl. verwendeter Parameter (s.u.)
methodology_version text,     -- bündelt score/taxonomy/feature-resolution/normalization
UNIQUE(product_id, category, snapshot_date)
```
`score_breakdown` enthält **Werte UND Parameter**:
```json
{ "feature": 0.61, "sentiment": 0.42, "momentum": 0.30, "n": 7, "score_confidence": "medium",
  "params": { "weights": {"feature":0.45,"sentiment":0.35,"momentum":0.20},
              "shrinkage_k": 4, "decay_half_life_days": 49, "normalization_version": "2026-06-28" },
  "top_sources": [...] }
```

### `ranking_jobs` (resumabler State, Budgets pro Phase — Review-Kleinpunkt)
```
id, mode,  -- 'daily'|'backfill'
phase,     -- 'extract'|'enrich'|'research'|'aggregate'|'assets'
cursor, attempts, max_attempts, last_advanced_at,
budget_extract, budget_research, budget_assets,  -- separate Spend-Caps
spend_tokens, spend_web_searches, status, error_message, started_at, completed_at
```

### `daily_repo` Erweiterung (versioniertes Processing — Review-Punkt P1-4)
```
processed_for_products_at timestamptz,
processed_for_products_version text,
processed_for_products_model text
```
Erlaubt **selektive Neuverarbeitung** alter News bei Parser-/Prompt-/Modell-/Taxonomie-Änderung.

### `source_domain_reputation` (P2 — statt nur Enum)
```
domain pk, reputation_tier, independence_score, last_reviewed
```
Ersetzt langfristig das `source_credibility`-Enum; in P2.

### Hilfstabellen
`product_slug_redirects(old_slug UNIQUE, product_id)` · `product_overrides(product_id, field, value, reason)` (von Aggregation respektiert) · `merge_log`/`split_log`.

## 5. Kanonisierung & Versionstrennung — `lib/rankings/canonicalize.ts`

Deterministisch, unit-getestet, **kein Embedding für Versions- oder Vendor-Entscheidungen.**

1. **Parse** Roh-Name → `{ family, version, qualifier }` (Versionsmuster + Qualifier-Lexikon mini|nano|pro|max|turbo|flash|preview|earth|luna|opus|sonnet|haiku|…).
2. **Vendor-Namespace** bestimmen: sicher → Company-Slug; unsicher → deterministischer provisorischer Namespace aus dem Mention-Kontext (gleiches Produkt ⇒ gleicher Namespace).
3. **Normalisieren** → `canonical_key = vendor@family@version@qualifier`.
4. **Alias-Lookup** (O(1)) → **Trigram-Fuzzy** (Tippfehler) → **Family-Embedding** (nur „selbe Familie?").
5. **Upsert** via `ON CONFLICT (canonical_key) DO UPDATE`; jede Identity-Änderung als `product_identity_events`-Zeile.

**Harte Regeln:** gleiche (vendor, family, version, qualifier) ⇒ merge · jede Differenz in version ODER qualifier ⇒ neues Produkt (erbt nichts) · Codename→Release / Rebrand ⇒ merge **mit** Historie via `alias_type` + transaktionale `merge_products()` · Vendor-Resolve eines provisorischen Produkts, das auf ein bestehendes resolved Produkt trifft ⇒ Merge-Event.

**Tests:** GPT-5.6 / GPT-5.5 / „GPT-5.6 mini" / „GPT-5.6 Earth" / „GPT5.6"(Tippfehler) / „gpt 5.6" · generische Kollision („Studio" zweier Vendors) · Rebrand/Codename · Slug-Kollision.

## 6. Auto-Taxonomie, stabilisiert + deprecatable

LLM erzeugt Kategorien/Achsen (vollautomatisch), aber als **persistente Registry**: bei neuen News bekommt das LLM die bestehende Taxonomie als Kontext und ordnet primär **ein**; nur bei klarem Nichtpassen schlägt es Neues vor → wird **dedupliziert** (Embedding + LLM-Konfliktcheck), bei Erstellung **einmalig in alle 4 Locales übersetzt** + bekommt `type/unit/higher_is_better/importance_weight`. Bestehende Achsen werden nie umbenannt/umgewichtet (Vergleichbarkeit, i18n). **Deprecation statt Append-only-Müll:** ein wöchentlicher Reconciler kann Achsen/Kategorien `deprecated`/`hidden` setzen + `replaced_by` zeigen — nie löschen, nie umdeuten.

## 7. Pipeline (täglich, inkrementell, im Cap)

Idle Tages-Ticks, **nach** `advanceArticleJob()`, Budget-Guard (`remaining > ~150s`, kein offener Writing-Job), Budgets gegen **~240s netto**.

1. **`extract`** — batched (~10 Items/Call) Produkterkennung + Kategorie-Kandidaten + Kanonisierung (§5). Setzt `processed_for_products_*`.
2. **`enrich`** — je Mention 1× Sentiment + Feature-**Observations** (gecacht). `p-limit(4–5)`, billiges Modell (`claude-sonnet-4-6`, UseCases `ranking_extract`/`ranking_sentiment`), teures nur für ambivalente Tiebreaks.
3. **`research`** — gedeckelt (≤2–3/Tick, `withTimeout ~60s`, idempotenter `(product_id,dimension_key)`-Cache). **Verifikation alias-bewusst statt exaktem String-Match (Review-Punkt 8):** Quelle muss matchen — kanonisches Versions-Token *oder* trusted Alias **und** kompatibles Family-Token **und** kompatibler Vendor **und** kein widersprechendes Versions-Token in der Nähe. Bleibt deterministisch, ist aber nicht brittle.
4. **`aggregate`** — 1×/Tag, set-based SQL: Near-Duplicate-Dedup (pgvector >0.9, gleicher Tag) → Feature-Resolution (Observations → current) → Score → Ranks → Leader-Flags → Snapshot-Upsert mit `methodology_version` → `revalidateTag('rankings')`.
5. **`assets`** — eigene Stufe (§10).

**Budgets pro Phase (Review-Kleinpunkt):** extract/enrich, research, assets, backfill haben **getrennte** Spend-Caps — Web-Research darf die tägliche Kern-Pipeline nicht verhungern lassen. **Spend-Circuit-Breaker** global + pro Phase. **Backfill** = `mode='backfill'`, eigener Cursor, gedrosselt über ~8–15 Tage, **kein** Bulk-Vektor-Pull über REST. Heartbeat um cursor/phase/processed/failed/research-queue erweitern.

## 8. Guardrails (Ersatz für menschlichen Review)

1. **Status sauber getrennt (Review-Punkt 7):** `identity_status` (candidate|resolved|merged|archived) ⊥ `visibility_status` (visible|hidden|suppressed) ⊥ `confidence_band` (low|medium|high). „Sofort live" = `visibility=visible` ab erster Mention, auch wenn `identity=candidate`/`confidence=low` — ehrlich als „vorläufig" markiert.
2. **Score-Shrinkage** statt Sichtbarkeits-Gate: Empirical-Bayes gegen Kategorie-Prior (k≈3–5) → 1-Artikel-Produkt nahe Mittel, nicht 96/100.
3. **Evidenz-Gate (Haftung, unverhandelbar):** numerischer Wert nur mit `evidence_quote` ODER verifizierter `source_url`; `is_category_leader` nur bei hoher `feature_confidence` + ≥2 Quellen + ≥3 Vergleichsprodukten + ε-Toleranzband + Hysterese (≥2 Snapshots). Sonst „—" + „geschätzt", nie ein Leader-Badge.
4. **Self-Healing:** transaktionale `merge_products()`/`split`, wöchentlicher Dedup- + Taxonomie-Reconciler, Admin-Notbremse, `product_overrides` werden respektiert.
5. **Korrekturkanal:** öffentlicher „Daten melden"-Link → Override. Immutable Snapshots als Audit.
6. **Golden-Eval:** pro Kategorie 5–10 hand-gelabelte Referenzen, täglicher Spearman-Check → Alert bei Drift.
7. **Framing/Compliance:** „automatisch generiert, Stand `<snapshot_date>`", Methodik-Seite, klare visuelle Distanz zur Stocks-Logik (kein Anlagesignal — UWG/Kreditgefährdung vermeiden).

## 9. Score (gehärtet — Review-Punkte 4 & 5)

```
synthszr_score = round(100 × (0.45·feature_strength + 0.35·sentiment_norm + 0.20·momentum))
```
Alle Komponenten auf **[0,1]**:

- **`feature_strength` — gewichteter, confidence-gewichteter Durchschnitt NORMALISIERTER Werte (nicht binär über Leader):**
  ```
  feature_strength = Σ(weightᵢ · normalized_valueᵢ · confidenceᵢ) / Σ(weightᵢ · confidenceᵢ)
  ```
  Normalisierung je Achsentyp: `number` → robustes min-max / Perzentil / log-skaliert (geklammert, stabil bei wenigen Produkten); `bool` → 0/1; `enum` → ordinales Mapping nur wenn fachlich sinnvoll, sonst nicht score-relevant. NULL ≠ 0 (coverage-adjustiert, `min_coverage`). **Leader-Badges werden hieraus ABGELEITET, sind aber NICHT der Score-Input** — Leader bleibt ein UI-Konzept mit ε-Band + Hysterese + Evidenz-Gate.
- **`sentiment_norm`** = `(sentiment_shrunk + 1)/2`; Empirical-Bayes gegen Kategorie-Prior; **stabil gemittelt** (Recency NICHT hier); Quellen-Credibility-Gewicht; Near-Duplicate-Dedup vor Aggregation.
- **`momentum`** = vorzeichen-bewusst `d/dt(sentiment·volume)`, [0,1]-geklammert. Einziger Ort für Recency. Exponentielles Decay (HWZ ~6–8 Wochen) statt hartem Cliff.
- **`methodology_version`** + Parameter im `score_breakdown` → Snapshots methodisch rekonstruierbar.

`score_confidence` wird aus n / Quellenzahl / Varianz abgeleitet (dritte Confidence-Art neben identity/feature — Review-Punkt 9).

## 10. Visueller Layer (Schwerpunkt)

`images.unoptimized=true` bleibt global; Ranking-Assets werden **bei Ingestion einmalig mit `sharp` vorgebacken**.

- **Pre-Bake:** AVIF+WebP in mehreren Breiten (Logos 64/128/256, Screenshots 640/1280/1920) → Vercel Blob; `thumbhash`-Placeholder; `<picture>`/`srcset` mit fester `aspect-ratio` → **CLS = 0**; Hero-Screenshot `priority`/preload (LCP), Tabellen-Logos `lazy`.
- **Logo-Garantie-Kette:** Logo.dev/Brandfetch (Vendor-Domain, theme dark/light) → Produkt-Domain → Favicon → **deterministisch generiertes Monogramm-SVG** (nie leere Zelle). `onError`-Swap. (Clearbit gestrichen.)
- **Screenshots:** primär `og:image`, Press-Kits, Screenshot-API zuletzt/async. Pro Kategorie entscheiden, ob Hero sinnvoll; sonst Logo-zentriert.
- **Asset-Acquisition = eigene Job-Stufe** mit eigenem Budget; Score/Rank warten nie.
- **Feature-Grid (TanStack Table):** sticky erste Spalte (Logo+Name+Score), gefrorener Header, scrollbarer Body; `tabular-nums` + Einheit; Provenienz-Icon je Zelle (✓/~/?) mit Quell-Tooltip; Mobile: transponierte Vergleichskarten.
- **Leader-Highlight A11y:** nur die Zelle BG `#CCFF00`, Text Schwarz; **immer zweites Signal** (crown/award + „Leader"-Pill); Tooltip mit Begründung.
- **Lizenz/Recht:** `license`/`attribution_required`/`source` pro Asset; Attribution im UI/Footer; SVGs nie inline.
- **ISR + Tag-Invalidierung:** `cacheTag('rankings')`/`rankings:${category}`, `revalidateTag` am Cron-Ende; pfadspezifische Cache-Control-Ausnahme in `middleware.ts`.

## 11. Die vier Seiten (alle `app/[lang]/rankings/…`, Template `app/[lang]/companies`)

1. **`/[lang]/rankings`** — Kategorie-Karten-Grid (nur `status='active'`-Kategorien).
2. **`/[lang]/rankings/[category]`** — Feature-Grid, Top 20.
3. **`/[lang]/rankings/[category]/[family]`** — **Family-Hub** + Versions-Switcher (gegen SEO-Orphaning).
4. **`/[lang]/rankings/[category]/[product]`** — Header (Score+Breakdown, Confidence-Badge), Feature-Tabelle mit Quellen, Score-Herkunft, letzte News, Stock-Überleitung (Linkziel an `vendor_company_type` gebunden, sonst kein Link).

**Multi-Kategorie-Canonical (Review-Punkt P1-3):** ein Produkt kann unter mehreren Kategorien liegen → **Canonical = Detailseite unter der Primary Category**; Sekundär-Kategorie-Seiten setzen `canonical` auf die Primary (kein SEO-Duplikat). **Backfill-Ehrlichkeit:** Detailseiten labeln „basierend auf beobachteter Berichterstattung seit `<date>`". `schema.org Review` (author = Organization Synthszr, kein self-serving `aggregateRating`), paginierte Sitemap via `generateSitemaps()`, `noindex`/Canonical für `superseded` Versionen, Labels via `ui_translations`/`content_translations`.

## 12. Phasen-Schnitt (Schema vs. Logik getrennt)

Leitprinzip: **Schema von Anfang an vollständig** (vermeidet schmerzhafte Migrationen — Reviewer-P0-Argument), **Logik phasenweise**.

- **Phase 0 — Identity-Fundament:** `canonicalize.ts` (vendor-namespaced) + Tests, **komplettes** Datenmodell inkl. Observations/Mention-Categories/Identity-Events/Versionierungsspalten (Schema), `ranking_jobs`, Taxonomie-Registry-Mechanik. Kein UI, noch keine Feature-Resolution-Logik.
- **Phase 1 — Daily-Pipeline (gegated):** extract/enrich (Sentiment + Feature-Observations)/aggregate + Score (Shrinkage, feature_strength normalisiert) + Spend-Breaker + **Idempotenz-Integrationstest** (Tick-Abbruch → Wiederanlauf ohne Duplikate). Noch kein Web-Research, keine Assets; fehlende Achsen = „—".
- **Phase 2 — Visueller Layer + Seiten:** `product_assets` + Monogramm + Pre-Bake, vier Seiten, ISR, A11y-Leader, Canonical-Strategie. **Hier wird es sichtbar.**
- **Phase 3 — Anreicherung & Self-Healing:** Web-Research (gedeckelt, alias-bewusst), Feature-Konflikt-Resolution, Merge/Split + Reconciler + Taxonomie-Deprecation, Korrekturkanal, Golden-Eval, Backfill.
- **Phase 4 (optional):** Post→Produkt-Verlinkung (`{Product}`-Tags) + News-Queue-/Ghostwriter-Signal-Synergie; `source_domain_reputation`-Tabelle; Drift-/Conflict-Dashboard.

## 13. Risiken & offene Punkte

- **Vendor-Resolve-Merge-Last:** provisorische Namespaces erzeugen spätere Merges; deterministischer provisorischer Namespace hält die Last gering, Identity-Events machen sie auditierbar.
- **Auto-Taxonomie-Drift:** Golden-Eval + Reconciler fangen viel; falls unzureichend, ist ein leichter Admin-Review *nur neuer Achsen* der kleinste Eingriff.
- **Web-Search-Tool-Format:** Verfügbarkeit/Schema des nativen Anthropic/OpenAI Web-Search bei Implementierung verifizieren.
- **Feature-Normalisierung bei wenigen Produkten:** Perzentil/min-max instabil → robuste, geklammerte Normalisierung + `min_coverage`.
- **Kosten** (Backfill, Launch-Burst): Budgets pro Phase sind Pflicht; konkrete Höhen in Phase 0 festlegen.

## 14. Änderungen ggü. v1 (eingearbeitetes Architektur-Review)

P0: (1) Vendor-Namespace im `canonical_key` + `product_identity_events`; (2) `product_mentions` von Kategorie entkoppelt → `product_mention_categories`; (3) Feature-Beobachtungsschicht (`product_feature_observations` + `product_features_current`); (4) `feature_strength` als normalisierter, confidence-gewichteter Durchschnitt statt binär über Leader; (5) Methodik-Versionierung in `product_rankings` + Parameter im Breakdown; (5b) LLM-Rolle auf Extraktion begrenzt, Ranking deterministisch.
P1: Taxonomie-Deprecation/Replacement; Confidence in identity/feature/score getrennt; Multi-Kategorie-Canonical-URLs; versioniertes `processed_for_products`; Budgets pro Pipeline-Phase; Partial-Unique-Index für Primary Category.
P2: Golden-Eval-Ausbau, Admin-Korrekturflow, Drift-Dashboard, `source_domain_reputation`-Tabelle.
