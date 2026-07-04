# Rankings — Attribution-QS (Daten-Qualität im täglichen Cron)

> **Status:** Design zur Review. Implementierung erst nach Freigabe.
> **Datum:** 2026-07-04
> **Kontext-Memory:** [[project_synthszr_rankings]]

## Ziel

Ein Produkt in den Synthszr Charts soll **immer korrekt einem Unternehmen zugeordnet** sein. Der tägliche Rankings-Cron bekommt eine **QS-Phase**, die falsche/fehlende Company-Zuordnungen erkennt und heilt — plus **Prävention** an der Extraktion, damit solche Daten gar nicht erst entstehen.

Auslöser (Mattes): drei Produktseiten mit kaputter Zuordnung:
- `amazon-web-services-aws-finops-agent` → nicht Amazon zugeordnet
- `unknown-watermelon` → nicht Meta zugeordnet
- `jetbrains-codex` → keine Version, kein Unternehmen (real: Falsch-Zuordnung, „Codex" ist OpenAI)

## Befund (Prod-Daten, 2026-07-04)

2105 chartable Produkte (≥2 Mentions). Verteilung der Zuordnungs-Defekte:

| Klasse | Menge | Fix | Sicherheit |
|---|---|---|---|
| **Alias-Vendor** (aws/amazon-web-services→amazon, google-deepmind/deepmind→google, mistral-ai→mistral, github→microsoft, …) | ~80 | Alias-Map | deterministisch |
| **`unknown` mit eindeutigem Geschwister** (unknown-watermelon ↔ meta-watermelon) | ~52 | Merge in Geschwister | deterministisch |
| **`unknown` ohne Geschwister** | ~700 (nur 75 chartable) | LLM-Inferenz | braucht Firmenwissen |
| **Falsch-Zuordnung / Fragmentierung** (Codex unter 15+ Vendors: openai, anysphere, anthropic, google, jetbrains, codex-codex, unknown) | Hunderte Fragmente | LLM-verifizierter Merge in Kanon | braucht Firmenwissen |
| **0-Mention-Waisen** | ~n | verbergen (`hidden`) | deterministisch |

**Wichtige Korrektur:** **Fehlende Versionsnummer ist KEIN Defekt.** 77% der chartable Produkte (1624) haben legitim keine Version (ChatGPT, Cursor, Codex, Watermelon …). Ein Versions-Check würde ~1600 False Positives werfen → wird **nicht** QS-Kriterium.

## Non-Goals

- **Keine** Versions-Vollständigkeits-Prüfung (siehe oben).
- **Keine** vollständige De-Fragmentierung aller Sub-Produkte (openai-codex-cli vs openai-codex-for-x …) — das ist ein separates, größeres Thema (`runDefragmentation`/`runConsolidation`). Diese QS adressiert nur die **Company-Zuordnung**.
- **Standalone-Re-Attribution** (unknown ohne Geschwister → neuer Vendor mit Slug-Änderung) ist in v1 **flag-only**, kein Auto-Rewrite (vermeidet URL-/SEO-Bruch). Auto-Fix nur wo ein korrekt zugeordnetes Ziel-Produkt bereits existiert (Merge).

## Architektur: Prävention + Heilung

### Teil 1 — Prävention (damit neue Daten sauber sind)

**A. Kanonische Vendor-Alias-Schicht** — neues Modul `lib/rankings/vendor-canonical.ts`:
```ts
export const VENDOR_ALIASES: Record<string,string> = {
  'amazon-web-services':'amazon','aws':'amazon','aws-ai':'amazon',
  'google-deepmind':'google','deepmind':'google','google-cloud':'google','google-research':'google','alphabet':'google',
  'github':'microsoft','microsoft-research':'microsoft','microsoft-ai':'microsoft','azure':'microsoft',
  'mistral-ai':'mistral','ibm-research':'ibm',
  'instagram':'meta','whatsapp':'meta','facebook':'meta','fair':'meta',
  'tiktok':'bytedance',
  // … kuratiert, konservativ, nur eindeutige Konzern-Sub-Brands
}
export function canonicalVendor(ns: string): string  // alias → kanon, sonst ns
export function vendorDisplayName(ns: string): string // „amazon" → „Amazon"
export function namespacesForCompany(slug: string): string[] // reverse: 'amazon' → ['amazon','aws','amazon-web-services',…]
```
- **Display-Layer** (Produktseite `[slug]/page.tsx`): Company-Link, Stock-Block, Premarket, Avatar, JSON-LD-`publisher` und der Vendor-Label nutzen `canonicalVendor(p.vendor)` + `vendorDisplayName(...)`. → `amazon-web-services` zeigt **sofort** Amazon-Zuordnung, **ohne** Slug-/URL-Änderung.
- **Company-Listing** (`vendor-products.tsx`): filtert per `vendor_namespace IN namespacesForCompany(slug)` → `/companies/amazon` listet auch die aws-Produkte.
- **Resolve-Layer** (`buildProductInsert`): `canonicalVendor(normalizeVendorNamespace(raw))` → **neue** Produkte bekommen den Kanon-Vendor (keine neuen aws/deepmind-Fragmente). Wirkt nur vorwärts, ändert keine bestehenden Slugs.

**B. Extract-Prompt härten** (`lib/rankings/extract-products.ts`, Zeile 43): explizite Regeln ergänzen —
  - Konzern-Kanon: „AWS/Amazon Web Services → Amazon; DeepMind/Google Cloud → Google; GitHub → Microsoft".
  - Anti-Falsch-Zuordnung: „Ein etabliertes Produkt (Codex, Gemini, Claude, GPT) NIE einer Firma zuordnen, die es nur *erwähnt/integriert* — nur dem echten Hersteller."

### Teil 2 — Heilung (täglicher QS-Lauf)

Neue Cron-Phase `runAttributionQA(limit, budget)` in `lib/rankings/attribution-qa.ts`, eingehängt in `/api/cron/precompute-metrics` (05:30) **nach** `runCategorization`, **vor** `runProductResearch` (mirror des research-Musters: budget-gedeckelt, marker-basiert, inkrementell).

**Kandidaten-Auswahl** (pro Lauf, Top-N nach Mentions): chartable Produkte (mention_count ≥ 2) die
  - `vendor_namespace === 'unknown'` **ODER** in einem „verdächtig"-Set (Alias-Roh-Vendor, Ein-Wort-generisch), **UND**
  - noch keinen QS-Marker `__attribution_qa_at` haben (Re-QS nur bei neuen Mentions).

**Pro Kandidat:**
1. **Deterministische Vorstufe (kostenlos):**
   - Alias: wenn `canonicalVendor(ns) !== ns` → gilt via Display-Layer schon; Marker setzen, fertig.
   - `unknown` + **genau ein** bekannter Vendor teilt dieselbe `family` (visible) → **Merge** in dieses Geschwister (`mergeProductsInto`). Fixt watermelon. (Bei ≥2 verschiedenen Vendors → nicht eindeutig → LLM.)
2. **LLM-Stufe (nur wenn deterministisch nicht gelöst, budget-gedeckelt):** Sonnet tool-use, Input = `canonical_name` + Top-3 Mention-Excerpts. Rückgabe (structured):
   ```
   { company_slug, confidence: 0..1, canonical_of: <existierender product-slug | null>, reasoning }
   ```
   - `canonical_of` gesetzt & existiert & `confidence ≥ 0.8` → **Merge** des Fragments in den Kanon (jetbrains-codex → openai-codex). `mergeProductsInto` reassignt Mentions, Fragment → hidden. Ziel-Slug bleibt (SEO-sicher).
   - sonst → **flaggen** (kein Auto-Rewrite in v1).
   - Immer `__attribution_qa_at`-Marker setzen (genau ein LLM-Call/Produkt).

**Guardrails (aus früheren Merge-Regressionen gelernt):**
- Merge nur wenn Ziel existiert & sichtbar; **niemals** Daten löschen (Verlierer → `hidden`, Mentions umgehängt).
- LLM-Merge nur ab `confidence ≥ 0.8` und wenn `canonical_of` als Slug wirklich existiert.
- Alles wird in `attribution_qa_flags` protokolliert (auditierbar).
- Token-Budget-Cap pro Lauf (analog `EXTRACT_TOKEN_BUDGET`), Default `limit=15`/Tag → chartable-unknowns (~127) in ~9 Tagen abgearbeitet, danach nur Neuzugänge (~$0,3–0,5/Tag).

### Teil 3 — QS-Report (Sichtbarkeit)

Neue Tabelle `attribution_qa_flags` (product_id, slug, current_vendor, suggested_company, confidence, action `merged|flagged|aliased`, reasoning, created_at). Auf `/admin/rankings` eine kleine Sektion „Attribution-QS": Zähler + Liste der geflaggten (unklaren) Produkte mit Vorschlag → manuelle Ein-Klick-Bestätigung später (v2).

## Datenmodell

Migration `20260704xxxxxx_attribution_qa.sql`:
- `attribution_qa_flags` (siehe oben) + Index auf `action`.
- Marker `__attribution_qa_at` läuft über die bestehende `product_features_current` (Pseudo-Dimension, wie `__researched_at`) — **keine** Schema-Änderung an products nötig.

## Kostenschätzung

- Initial-Drain: ~127 chartable unknowns + ~Fragment-Kandidaten × ~1 Sonnet-Call (Name+3 Excerpts, ~1–2k Token) ≈ **~$3–6 einmalig** über ~1–2 Wochen (15/Tag).
- Laufend: nur Neuzugänge → **~$0,3–0,5/Tag**, gedeckelt.

## Sofort-Wirkung auf die drei Beispiele

| Beispiel | Klasse | Fix | Wann |
|---|---|---|---|
| amazon-web-services-aws-finops-agent | Alias | Display-Layer canonicalVendor → Amazon (Link, Stock, Avatar) | sofort nach Deploy |
| unknown-watermelon | unknown+Geschwister | deterministischer Merge → meta-watermelon | erster QS-Lauf |
| jetbrains-codex | Falsch-Zuordnung | LLM-verifizierter Merge → openai-codex | erster QS-Lauf (LLM) |

## Offene Entscheidungen (bitte prüfen — Annahmen)

1. **QS-Mechanismus:** angenommen **Hybrid** (deterministisch + LLM nur für chartable, Long-Tail flag/ignore). Alternativen: LLM für ALLE (~800, teurer) · nur deterministisch + Report.
2. **Auto-Fix-Politik:** angenommen **Auto-Merge** bei hoher Confidence (Ziel existiert), **flag-only** für Standalone-Re-Attribution. Alternative: alles nur flaggen, nichts automatisch mergen.
3. **Chartable-Schwelle:** angenommen ≥2 Mentions. Höher (z.B. ≥5) = weniger LLM-Calls, aber Long-Tail bleibt unangetastet.
4. **Standalone-Re-Attribution** (unknown ohne Geschwister, echter Vendor): v1 flag-only. In v2 mit 301-Redirect vom Alt-Slug nachziehen?

## Rollout & Verifikation

1. Teil 1 (vendor-canonical + Display-Wiring + Prompt) — deploy, prod-verify die 3 Beispielseiten (amazon-web-services → Amazon sichtbar).
2. Migration + `runAttributionQA` + Cron-Einhängung — ein manueller Lauf via `/admin/rankings`, prüfe watermelon-Merge + jetbrains-codex-Merge live.
3. Cron beobachten (1–2 Tage), QS-Report sichten.
