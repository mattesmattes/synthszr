# Synthszr Rankings — Konzept / Design-Spec

**Datum:** 2026-06-28
**Status:** Konzept (genehmigte Weichen, vor Implementierungsplan)
**Autor:** Matthias Schrader + Claude

## 1. Überblick & Ziel

Ein neuer öffentlicher Bereich **Synthszr Rankings**, analog zum bestehenden Aktien-Bereich (Synthszr Stocks). AI-**Produkte** (GPT-5.6, Cursor, Cdance 2.5, Veo, OCR-Tools …) werden aus den News-Artikeln (`daily_repo`) extrahiert, in Kategorien gruppiert und nach einem **Synthszr-Score** gerankt, der aus Sentiment/Wahrnehmung **und** harten Produktfeatures der News-Berichterstattung berechnet wird (nicht aus Nutzerbewertungen, nicht aus den veröffentlichten Blog-Posts).

Vier Seiten:
1. Kategorie-Übersicht
2. Ranking pro Kategorie (Feature-Grid, Top 20)
3. **Family-Hub** (Versions-Switcher, gegen SEO-Orphaning)
4. Produktdetailseite

### Kern-Unterscheidung: Produkt ≠ Company
Das System kennt heute nur **Companies** (OpenAI, Anysphere). „Produkt" ist eine **neue, versions-granulare Entität**: eine Company hat mehrere Produkte (OpenAI → GPT-5.6, Sora, …), und jede Version/Variante ist ein eigenes Produkt (GPT-5.6 ≠ GPT-5.5 ≠ GPT-5.6 Earth).

## 2. Genehmigte Entscheidungen

| Thema | Entscheidung |
|---|---|
| Produkt-Erzeugung | **Vollautomatisch** (LLM extrahiert + kategorisiert + rankt, kein manueller Review, sofort live) |
| Taxonomie (Kategorien + Feature-Achsen) | **Vollautomatisch erzeugt**, aber stabilisiert über persistente append-only Registry (§6) |
| Sichtbarkeit | **Sofort live ab erster Erwähnung**, abgesichert über Score-Shrinkage + Confidence-Badge statt Verzögerung (§8) |
| Score-Gewichte | **0.45 Feature / 0.35 Sentiment / 0.20 Momentum** (feature-betont, weg vom Hype) |
| Sentiment-Quelle | LLM-Sentiment je News-Mention, gewichtet aggregiert |
| Update-Rhythmus | **Täglich**, aber auf idle Tages-Ticks *nach* dem Article-Job, nicht im 05:30-Fenster (§7) |
| Feature-Recherche | Natives Web-Search-Tool (Anthropic/OpenAI), eigene gedeckelte Pipeline-Phase |

### Unverhandelbare Härtungen (unabhängig von den Automatik-Wahlen)
- Deterministischer Versions-Parser statt Embedding-Versionstrennung (§5)
- Idempotenz + resumabler Job-State (§7)
- Evidenz-Gate für Feature-Werte und Leader-Badges — **Haftungsrisiko** (§8)
- Score-Normalisierung + Shrinkage — sonst mathematisch falsch (§9)
- Self-Healing (Merge/Split + Reconciler) — bei No-Review zwingend (§8)
- Spend-Circuit-Breaker (§7)

## 3. Architektur-Prinzipien

1. **Sentiment/Features 1× pro News berechnen und cachen** — die *tägliche* Pipeline aggregiert nur (billige SQL), berechnet kein LLM-Sentiment neu. Hält den täglichen Lauf im 300s-Cap unabhängig von der Fenstergröße.
2. **Score wartet nie auf Assets oder Web-Recherche** — Anzeige nutzt sofort Fallbacks (Monogramm, „—"), Anreicherung backfillt asynchron.
3. **Versionsidentität ist deterministisch**, nicht LLM-geraten.
4. **Öffentliche URLs sind permanent** (immutable Slugs + Redirects).

## 4. Datenmodell

Alle Tabellen mit Präfix `product_` / `ranking_`. RLS: public read, service-role write (wie `post_company_mentions`).

### `products`
```
id              uuid pk
canonical_key   text  GENERATED  -- lower(family)||'@'||version||'@'||coalesce(qualifier,'')
                      UNIQUE      -- Idempotenz-Anker, ON CONFLICT-Upsert
slug            text UNIQUE       -- aus geparsten Komponenten, immutabel
canonical_name  text              -- "GPT-5.6 Earth"
family          text              -- "GPT-5"
version         text              -- normalisiert, semver-artig
qualifier       text null         -- "earth" | "mini" | "pro" | null
vendor_company_slug text null     -- → Stocks/Companies (geteilter Resolver)
vendor_company_type text null     -- 'public' | 'premarket' | null
family_embedding vector(768) null -- NUR Familien-Ebene, nie Versionsentscheidung
status          text              -- 'candidate' | 'live' | 'merged' | 'archived'
superseded_by_id uuid null self-fk -- für Rebrand/Codename-Merge
confidence      real              -- Daten-Konfidenz (Sample-Size, Quellen)
first_seen      timestamptz
last_seen       timestamptz
```

### `product_aliases` (eigene Tabelle statt Array)
```
id, product_id fk, alias_raw, alias_normalized UNIQUE,
alias_type text  -- 'spelling' | 'codename' | 'rebrand' | 'locale'
confidence, source_url, first_seen
```
`alias_normalized` = casefold + Whitespace/Bindestrich-Normalisierung. **pg_trgm + GIN** für Tippfehler-Match *vor* jeder Embedding-Stufe. Unique verhindert Alias-Klau über Produkte.

### `product_categories` (auto-erzeugt, persistent)
```
slug pk, name, description, feature_dimensions jsonb, display_order, created_at
```
`feature_dimensions` = `[{ key, label_i18n:{de,en,cs,nds}, unit, type:'number'|'bool'|'enum', higher_is_better, importance_weight }]`. **Append-only** (§6).

### `product_category_membership` (M:N — Multi-Kategorie-Produkte)
```
product_id fk, category fk, is_primary bool
PK (product_id, category)
```
Gemini = LLM + Bild + Video → mehrere Zeilen.

### `product_mentions` (News↔Produkt, gecachtes Sentiment, 1×/News)
```
id, product_id fk, daily_repo_id fk, category,
sentiment real,            -- −1..1
quality_signals jsonb,     -- {feature_substance, maturity, reception}
source_credibility text,   -- 'independent_review'|'press'|'vendor_blog'|'pr_wire'
excerpt, mention_date, model,
UNIQUE(product_id, daily_repo_id)   -- Idempotenz
```

### `product_features` (Produkt × Kategorie × Achse → Wert)
```
product_id, category, dimension_key, value, value_raw,
source text,            -- 'news' | 'research'
source_url, evidence_quote text null,   -- Beleg-Span (Evidenz-Gate)
confidence, is_category_leader bool, fetched_at, valid_until
PK (product_id, category, dimension_key)
```

### `product_assets` (visueller Layer)
```
id, product_family text, vendor_company_slug text null,
type text,   -- 'logo' | 'screenshot' | 'og_image' | 'monogram'
source text, -- 'logodev'|'brandfetch'|'favicon'|'og'|'screenshot_api'|'press_kit'|'generated'
blob_url, theme text null,  -- 'light'|'dark'|null
width, height, blur_data_url text,  -- thumbhash
license, attribution_required bool,
confidence, status text,    -- 'ok'|'fallback'|'failed'
fetched_at, expires_at
```
**Assets hängen an `product_family`/Vendor, nicht an der Version** — GPT-5.6 & „Earth" teilen das Familienlogo (optional Versions-Badge-Overlay).

### `product_rankings` (täglicher Snapshot)
```
id, product_id, category, snapshot_date,
synthszr_score int,  -- 0..100
rank int,            -- dense_rank pro Kategorie, stabiler Tiebreak
mention_count, momentum real, score_breakdown jsonb,
UNIQUE(product_id, category, snapshot_date)
```
Retention: 90 Tage täglich, danach wöchentlich verdichten.

### `ranking_jobs` (resumabler Pipeline-State, nach `article_jobs`-Vorbild)
```
id, mode text,  -- 'daily' | 'backfill'
phase text,     -- 'extract'|'enrich'|'research'|'aggregate'
cursor, attempts, max_attempts, last_advanced_at,
spend_tokens int, spend_web_searches int,  -- Circuit-Breaker
status, error_message, started_at, completed_at
```

### Hilfstabellen
- `product_slug_redirects(old_slug UNIQUE, product_id, created_at)` — 301-Weiterleitung
- `product_overrides(product_id, field, value, reason, created_at)` — Korrekturkanal, von Aggregation **respektiert**
- `merge_log` / `split_log` — Audit-Trail
- `daily_repo.processed_for_products timestamptz` + `ranking_attempts int` — idempotenter Wiederanlauf

## 5. Kanonisierung & Versionstrennung — `lib/rankings/canonicalize.ts`

**Der kritischste Baustein.** Deterministisch, unit-getestet, KEIN Embedding für Versionsentscheidungen.

**Ablauf pro erkanntem Roh-Namen:**
1. **Parse** → `{ family, version, qualifier }`. Versionsmuster (5.6, v3, 2.5), Qualifier-Lexikon (mini|nano|pro|max|turbo|flash|preview|earth|luna|opus|sonnet|haiku|…).
2. **Normalisieren** → `canonical_key = lower(family)@version@qualifier`.
3. **Alias-Lookup** (`product_aliases.alias_normalized`, O(1)) → exakter Treffer ⇒ Produkt gefunden.
4. **Trigram-Fuzzy** (pg_trgm) auf Aliases → Tippfehler-Kandidaten.
5. **Family-Embedding** NUR um „selbe Familie, anders beschrieben?" zu prüfen — nie zur Versionsentscheidung.
6. **Upsert** via `INSERT … ON CONFLICT (canonical_key) DO UPDATE`.

**Harte Regeln:**
- identische family + version + qualifier ⇒ merge
- jede Differenz in version ODER qualifier ⇒ **neues Produkt** (erbt nichts)
- Codename→Release (Strawberry→o1) und Rebrand (Bard→Gemini) ⇒ **merge MIT Historie** via `alias_type` + `merge_products()` (Ausnahme von „erbt nichts")

**Tests:** exakt die Fälle GPT-5.6 / GPT-5.5 / „GPT-5.6 mini" / „GPT-5.6 Earth" / „GPT5.6"(Tippfehler) / „gpt 5.6" + Rebrand/Codename + Kollisions-Slug.

## 6. Auto-Taxonomie, stabilisiert

Kategorien und Feature-Achsen werden **vom LLM erzeugt** (Wunsch: vollautomatisch), aber als **persistente append-only Registry** behandelt — nicht täglich neu erfunden:

- Beim Verarbeiten neuer News bekommt das LLM die **bestehende Taxonomie als Kontext** und ordnet primär **ein**.
- Nur wenn klar nichts passt, schlägt es eine **neue** Kategorie/Achse vor.
- Vorschlag wird gegen Bestehendes **dedupliziert** (Embedding + LLM-Konfliktcheck: „Video Generation" == „Video-Gen"?), bevor er festgeschrieben wird.
- Neue Achse wird bei Erstellung **einmalig in alle 4 Locales übersetzt** (`label_i18n`) und bekommt `type`, `unit`, `higher_is_better`, `importance_weight`.
- Bestehende Achsen werden **nicht umbenannt/umgewichtet** durch normale Läufe (Stabilität für Score-Vergleichbarkeit + i18n).

So bleibt es vollautomatisch *und* die Achsen sind stabil, übersetzt und vergleichbar.

## 7. Pipeline (täglich, inkrementell, im Cap)

Läuft auf den **idle Tages-Ticks** des `*/15`-Crons, **nach** `advanceArticleJob()`, hinter **Budget-Guard** (`remaining > ~150s`, kein offener Writing-Job). Alle Budgets gegen **~240s netto** (nicht die trügerischen 800).

**Phasen (resumabel, eine pro Tick, Cursor/Attempts):**
1. **`extract`** — pro unverarbeiteter `daily_repo`-News: batched (≈10 Items/Call) Produkterkennung + Kategorie-Einordnung + Kanonisierung (§5). `processed_for_products` setzen.
2. **`enrich`** — je neuer Mention 1× Sentiment + Feature-Werte (LLM, gecacht). `p-limit(4–5)`. Modell auf billiges Tier gepinnt (`claude-sonnet-4-6`), teures nur für ambivalente neu-vs-Variante-Tiebreaks. Eigene model-config UseCases `ranking_extract` / `ranking_sentiment`.
3. **`research`** — **separate, gedeckelte Phase**: ≤2–3 Web-Suchen/Tick, `withTimeout ~60s`, idempotenter `(product_id, dimension_key)`-Cache (genau 1×). Query MUSS exakten `canonical_name` enthalten; Quell-Seite muss Versions-Token per String-Match nachweisen, sonst verwerfen (verhindert Werte der falschen Version).
4. **`aggregate`** — 1×/Tag, reine set-based SQL-RPC: Near-Duplicate-Dedup (pgvector >0.9, gleicher Tag) → Score → Ranks → Leader-Flags → Snapshot-Upsert → `revalidateTag('rankings')`.

**Backfill** (3–4 Monate) = `mode='backfill'`, separater Cursor, niedrige Priorität, gedrosselt über ~8–15 Tage. **Kein** Bulk-Vektor-Pull über REST (bekannter Crash-Incident).

**Spend-Circuit-Breaker:** Tages-Budget für Tokens + Web-Suchen in `ranking_jobs`; bei Überschreitung Pipeline anhalten statt blind weiterzubrennen. Launch-Day-Burst-Schutz.

**Heartbeat:** `settings.cron_heartbeat` um cursor/phase/processed/failed/research-queue-Länge erweitern.

## 8. Guardrails (Ersatz für menschlichen Review)

Mattes hat „sofort live" + „auto-Taxonomie" gewählt — diese Guardrails machen das tragbar, **ohne** Verzögerung:

1. **Score-Shrinkage statt Sichtbarkeits-Gate:** Empirical-Bayes gegen Kategorie-Prior (k≈3–5). Ein 1-Artikel-Produkt landet nahe Kategorie-Mittel, nicht auf 96/100. → „sofort live" ist sicher.
2. **Confidence-Kennzeichnung:** `products.confidence` aus Sample-Size + Quellenzahl. UI zeigt „Neu/Vorläufig"-Badge + Confidence-Indikator (ehrlich, nicht versteckt).
3. **Evidenz-Gate (Haftung, unverhandelbar):** numerischer Feature-Wert nur mit `evidence_quote` (wörtlicher Beleg) ODER verifizierter `source_url`; `is_category_leader` nur bei hoher Confidence + ≥2 Quellen + ≥3 Vergleichsprodukten + ε-Toleranzband + Hysterese (≥2 Snapshots). Ohne Beleg: „—" + „geschätzt"-Markierung, nie ein Leader-Badge.
4. **Self-Healing:** transaktionale `merge_products()` / `split`, wöchentlicher Dedup-Reconciler, Admin-Notbremse. `product_overrides` werden von der Aggregation respektiert.
5. **Korrekturkanal:** öffentlicher „Daten melden"-Link → Override. Immutable Snapshots als Audit.
6. **Golden-Eval:** pro Kategorie 5–10 hand-gelabelte Referenzen, täglicher Spearman-Check → Alert bei Drift.
7. **Framing/Compliance:** „automatisch generiert, Stand: `<snapshot_date>`", Methodik-Seite mit Formel + Hinweis „misst Coverage-Sentiment + berichtete Features, keine eigenen Benchmarks". **Klare visuelle Distanz zur Stocks-Logik** (kein Anlagesignal — UWG §6 / Kreditgefährdung vermeiden).

## 9. Score (gehärtet)

```
synthszr_score = round(100 × (0.45·feature_strength + 0.35·sentiment_norm + 0.20·momentum))
```
Alle Komponenten auf **[0,1]**:
- **`sentiment_norm`** = `(sentiment_shrunk + 1) / 2`; `sentiment_shrunk` via Empirical-Bayes gegen Kategorie-Prior. Sentiment **stabil gemittelt** (Recency NICHT hier — sonst Doppelzählung mit Momentum). **Quellen-Credibility-Gewicht** (independent_review > press > vendor_blog > pr_wire). **Near-Duplicate-Dedup vor Aggregation** (PR-Syndication zählt sonst 20×).
- **`feature_strength`** = `Σ(weightᵢ · leaderᵢ) / Σ(weightᵢ über belegte Achsen, min_coverage)`. NULL ≠ 0 (coverage-adjustiert; Produkt mit 2/8 belegten Achsen wird nicht unfair bestraft, 1/1 nicht als 100% cherry-gepickt).
- **`momentum`** = vorzeichen-bewusst `d/dt(sentiment · volume)`, auf [0,1] geclampt. Einziger Ort für Recency.
- **Exponentielles Decay** (HWZ ~6–8 Wochen) statt hartem 4-Monats-Cliff.
- `score_breakdown` jsonb: roh + normalisiert + n + confidence + Top-Quellen → speist „Score-Herkunft" auf der Produktseite.

**Leader-Definition:** pro Achsen-`type` (number/bool/enum), `higher_is_better` invertiert; nur bei ≥3 vergleichbaren Produkten + ε-Toleranzband + Hysterese.

## 10. Visueller Layer (Schwerpunkt)

`images.unoptimized=true` bleibt global, aber Ranking-Assets werden **bei Ingestion einmalig mit `sharp` vorgebacken** (statt Request-Optimizer).

- **Pre-Bake:** pro Asset AVIF+WebP in mehreren Breiten (Logos 64/128/256, Screenshots 640/1280/1920) → Vercel Blob. `thumbhash`-Placeholder in DB. Auslieferung als `<picture>`/`srcset` mit fester `aspect-ratio` → **CLS = 0**. Hero-Screenshot der Detailseite `priority`/preload (LCP), Tabellen-Logos `lazy`.
- **Logo-Garantie-Kette:** Logo.dev/Brandfetch (Vendor-Domain, `theme=dark/light`) → Produkt-Domain → Google-Favicon (Notnagel) → **deterministisch generiertes Monogramm-SVG** (Initialen auf brand-getöntem Tile). Garantiert: nie eine leere Zelle. `onError` → Laufzeit-Swap. (Clearbit gestrichen — HubSpot-Übernahme.)
- **Screenshots:** primär `og:image` der Produkt-/News-Seiten (echte UIs hinter Login), Press-/Brand-Kits opportunistisch, Screenshot-API zuletzt/async. Pro Kategorie entscheiden, ob Hero sinnvoll ist; sonst Logo-zentriertes Layout.
- **Asset-Acquisition als eigene Job-Stufe** (nicht in Extraktion/Aggregation): status-getriebene Queue, N neueste Produkte ohne `ok`-Asset/Tick, Screenshots async. Score/Rank warten nie.
- **Feature-Grid (TanStack Table):** sticky erste Spalte (Logo+Name+Score) mit Scroll-Shadow, gefrorener Header, horizontal scrollbarer Body. Zahlen rechtsbündig `tabular-nums` + Einheit. Provenienz-Icon je Zelle (✓ verifiziert / ~ geschätzt / ? unbekannt) mit Quell-Tooltip. Mobile: transponierte Vergleichskarten. Top-20-Cap → keine Virtualisierung nötig.
- **Leader-Highlight A11y-konform:** nur die Zelle BG `#CCFF00`, Text **Schwarz** (Kontrast); **immer zweites Signal** (Lucide crown/award + „Leader"-Pill) für Deuteranopie; Tooltip mit Begründung („führt bei max_resolution: 4K").
- **Lizenz/Recht:** `license` + `attribution_required` + `source` pro Asset; Attribution im UI/Footer (Logo.dev-Free verlangt Link). **SVGs nie inline** (XSS) — via `<img>` oder sanitisiert.
- **ISR + Tag-Invalidierung:** `cacheTag('rankings')` / `rankings:${category}`, `generateStaticParams` für Kategorien, `revalidateTag('rankings')` am Cron-Ende. Pfadspezifische Cache-Control-Ausnahme in `middleware.ts`.

## 11. Die vier Seiten (alle unter `app/[lang]/rankings/…`, Template: `app/[lang]/companies`)

1. **`/[lang]/rankings`** — Kategorie-Karten-Grid: Name, Beschreibung, Produktanzahl, Top-3-Teaser mit Logo.
2. **`/[lang]/rankings/[category]`** — Feature-Grid, Top 20 (5–30). Spalten: Rang · Produkt (Logo, Name, Version, Vendor) · Synthszr-Score (Badge/Balken) · maßgebliche Feature-Achsen. Leader-Zellen markiert. Klick → Produktseite.
3. **`/[lang]/rankings/[category]/[family]`** — **Family-Hub** (gegen SEO-Orphaning): alle Versionen einer Familie + Versions-Switcher. Verwaiste Versions-URLs verlinken hierher.
4. **`/[lang]/rankings/[category]/[product]`** — Produktdetail:
   - Header: Name + Version + Vendor + Kategorie(n), großer Synthszr-Score + Breakdown-Visualisierung, Confidence/„Neu"-Badge
   - Feature-Tabelle: alle Kategorie-Achsen mit Werten, Leader-Markierung, Quelle je Wert (News-Link / „recherchiert" + Quelllink / „—")
   - Score-Herkunft: S/F/M visualisiert + treibende News
   - Letzte News zum Produkt: jüngste `daily_repo`-Mentions (Titel, Quelle, Datum, Sentiment-Indikator)
   - Stock-Überleitung: falls `vendor_company_slug` public/premarket → Rating + Kurz-These aus `stock_synthszr_cache`, Link (Linkziel an `vendor_company_type` gebunden, sonst kein Link statt 404)

**SEO/i18n:** `schema.org Review` (author = Organization Synthszr, **kein** self-serving `aggregateRating`), paginierte Sitemap via `generateSitemaps()`, `nav.rankings`/`footer.rankings`-Keys, Canonical/`noindex` für `superseded` Versionen, alle Labels über `ui_translations`/`content_translations`. Geteilter Company-Slug-Resolver für `vendor_company_slug`.

## 12. Phasen-Schnitt (gegen den Monolith)

- **Phase 0 — Fundament:** `canonicalize.ts` + Tests, Datenmodell mit allen Constraints/Status, `ranking_jobs`, Taxonomie-Registry-Mechanik. Kein UI.
- **Phase 1 — Daily-Pipeline (incremental, gegated):** extract/enrich/aggregate + Spend-Breaker + **Idempotenz-Integrationstest** (Tick-Abbruch → Wiederanlauf ohne Duplikate). Noch kein Web-Research, keine Assets — fehlende Achsen = „—".
- **Phase 2 — Visueller Layer + Seiten:** `product_assets` + Monogramm-Garantie + Pre-Bake, vier Seiten, ISR, A11y-Leader. **Hier wird es sichtbar.**
- **Phase 3 — Anreicherung & Selbstheilung:** Web-Research (gedeckelt, versionssicher), Reconciler, Korrekturkanal, Golden-Eval, Backfill.
- **Phase 4 (optional):** Post→Produkt-Verlinkung (`{Product}`-Tags) + Ghostwriter-/News-Queue-Signal-Synergie (heiße Produkte als Auswahl-Signal).

## 13. Risiken & offene Punkte

- **Auto-Taxonomie-Drift:** trotz Stabilisierung kann die Achsen-Qualität schwanken; Golden-Eval + Reconciler fangen das teilweise. Falls unbefriedigend, ist ein leichter Admin-Review der *neuen* Achsen (nicht der Produkte) der kleinste Eingriff.
- **Web-Search-Tool-Format:** Verfügbarkeit/Schema des nativen Anthropic/OpenAI Web-Search bei Implementierung verifizieren (claude-api-Skill).
- **Screenshot-Qualität** ist quellabhängig; Logo-zentriertes Layout als verlässlicher Default.
- **Kosten** des Backfills + Launch-Day-Bursts; Spend-Breaker ist Pflicht, Budget-Höhe festzulegen.
- **Multi-Kategorie-Ranking:** ein Produkt erscheint in mehreren Kategorien — Score wird pro Kategorie separat berechnet (eigene Achsen).
