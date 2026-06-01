# Assistiertes Lern-Ranking für die News Queue — Design

**Datum:** 2026-06-01
**Status:** Entwurf zur Review
**Kontext-Untersuchung:** Workflow „evaluate-article-selection-tooling" (Verdict: Hermes & GBrain ungeeignet → nativ bauen)

---

## 1. Problem

Täglich landen ~150 Artikel in `news_queue`. Mattes' aktueller Prozess:

1. Aus ~150 manuell die ~40 relevantesten **rausfischen** (Checkboxen in `app/admin/news-queue/page.tsx`).
2. Ghostwriter erzeugt daraus einen Artikel.
3. Mattes **verdichtet manuell auf die 10 besten**.

Das System unterstützt Schritt 1 heute nur mit einem **statischen, geschmacksblinden Score-Ranking** (`total_score`, DESC) und bietet **keine Begründung pro Item** und **keinen Lern-Loop**. Schritt 3 (welche 10 von 40 überleben) ist das schärfste Geschmackssignal überhaupt — es wird heute **nur auf Quellen-Ebene** zu `source_pub_rate` aggregiert, nie pro Item zurückgespielt.

## 2. Ziel / Nicht-Ziel

**Ziel:** Ein **assistiertes** System, das täglich die **~10–15 relevantesten Artikel mit Begründung vorschlägt**; Mattes bestätigt/entfernt/ergänzt; das System **lernt aus jeder Korrektur**. Native Lösung auf vorhandener Supabase/pgvector-Infrastruktur.

**Nicht-Ziel:**
- **Kein Voll-Auto-Publishing** — Mensch bleibt im Loop.
- **Keine externen Tools** (Hermes Agent / GBrain) — siehe §11.
- Keine Überarbeitung der Synthesis-Input-Scores selbst (separates Thema; siehe Risiken).

## 3. Zwei empirische Realitäten (formen das gesamte Design)

Diese zwei Funde aus dem Backtest (`scripts/backtest-results.json`, 44 Posts / 237 publizierte Items / 9.202 Queue-Items) entscheiden die Architektur:

### 3.1 Der bestehende Score ist auf der Zielmetrik schwach
Bestes Linearmodell: **Recall@15 = 0,275** gegen publizierte Items (Baseline 0,217). Ein billiger Vorfilter auf 30–40 Items würde **~70 % der am Ende gewollten Artikel wegwerfen, bevor das LLM sie sieht.**

→ **Konsequenz:** Stufe 1 darf **nicht verengen, sondern muss aufweiten** (RRF auf ~60–80) — oder ganz entfallen, falls ein LLM-Call über alle ~150 tragbar ist. **Welche Variante gewinnt, entscheidet die Eval-Harness, nicht dieses Dokument.**

### 3.2 Das Lernsignal existiert heute faktisch nicht
`status='selected'` = **17 Zeilen jemals**, und `getSelectedItems()` (`lib/news-queue/service.ts:593`) setzt jede Auswahl nach 2 h auf `pending` zurück. Es gibt also keine persistente Korrektur-Historie.

→ **Konsequenz:** Saubere, persistente Label-Erfassung ist **Voraussetzung (Phase 0)**, kein Nebenschritt. Die ersten ~3 Monate ist das System realistisch **„Few-Shot-Prompting mit Begründung"**, kein trainiertes Lernsystem. Erwartung entsprechend managen.

## 4. Architektur-Überblick

```
~150 pending          ┌─ R1: total_score (existiert)          ┐
news_queue items ─────┤                                        ├─ RRF ─► Top ~60–80
   │                  └─ R2: max-sim zu letzten N published    ┘          │
   │                       (pgvector, neue RPC)                            │
   │                                                                       ▼
   │   STUFE 1 (billig, kein LLM) — ODER überspringen, falls 1 LLM-Call    │
   │   über alle 150 tragbar (Eval entscheidet)                            │
   │                                                                       ▼
   │   STUFE 2 (1 LLM-Call/Tag) — Listwise-Rerank mit Begründung           │
   │     Input: Kandidaten + R1/R2-Scores + Few-Shot-Block                 │
   │            (jüngste published = positiv, ignored = negativ)           │
   │            + aktive ranking_preferences als Klartext-Regeln           │
   │     Output: [{queueItemId, rank, reason, confidence}]                 │
   │             (IDs gegen Kandidatenliste validiert; Reihenfolge         │
   │              geshuffelt gegen Positional Bias)                        ▼
   │                                                          ~10–15 Vorschläge MIT reason
   ▼                                                                       │
STUFE 3 (Mensch-im-Loop + Lernen)                                          ▼
   UI zeigt Vorschläge + reason → Mattes: accept / reject / add / reorder
        │
        └─► ranking_suggestions (Label-Store)
              ├─ sofort:    füttert Few-Shots der Folgetage (kein Training)
              └─ aggregiert: Cron extrahiert ranking_preferences (Confidence + Decay)
```

## 5. Datenmodell (neu)

Gespiegelt an `learned_patterns` / `applied_patterns` aus dem Edit-Learning-System (`supabase/_migrations_hidden/20260113100000_edit_learning.sql`).

### 5.1 `ranking_suggestions` (MVP — der Label-Store)
Ein Zeile pro vorgeschlagenem Item pro Ranking-Lauf.

| Spalte | Typ | Zweck |
|--------|-----|-------|
| `id` | uuid pk | |
| `run_id` | uuid | gruppiert einen Tageslauf |
| `queue_item_id` | uuid → news_queue | das Item |
| `suggested_rank` | int | Rang, den das LLM gab |
| `llm_reason` | text | Begründung des LLM |
| `confidence` | float | LLM-Confidence |
| `user_action` | text CHECK (`accepted`/`rejected`/`added`/`reordered`/`pending`) | **das Label** |
| `final_rank` | int null | Mattes' finaler Rang (bei reorder) |
| `acted_at` | timestamptz null | |
| `created_at` | timestamptz | |

`added` = Item, das das LLM **nicht** vorschlug, das Mattes aber manuell ergänzt hat (starkes Negativ-Signal für den Reranker, Positiv für die Auswahl).

### 5.2 `ranking_preferences` (Phase 2 — aggregiertes Lernen)
Struktur-identisch zu `learned_patterns`.

| Spalte | Typ | Zweck |
|--------|-----|-------|
| `id` | uuid pk | |
| `preference_type` | text CHECK (`source`/`topic`/`category`/`recency`/`format`) | |
| `target` | text | z. B. Quellen-Domain, Topic-Keyword |
| `description` | text | Klartext-Regel für den Prompt |
| `confidence_score` | float default 0.5 | |
| `times_applied` / `times_overridden` | int | |
| `last_applied_at` | timestamptz | für Decay |
| `embedding` | vector(768) null | optionale semantische Retrieval |
| `is_active` | bool default true | |
| `created_at` / `updated_at` | timestamptz | |

### 5.3 Neue RPC: `get_winner_similarity`
Liefert für eine Kandidaten-Liste die **maximale Cosine-Ähnlichkeit zu den letzten N publizierten „Winner"-Items** (multimodal, fängt Mattes' diverse Interessen besser als ein Centroid).

```sql
-- Skizze (Detail im Implementierungs-Plan)
-- Winners = daily_repo.embedding der queueItemIds, die in published generated_posts
--           als heading-Node mit queueItemId vorkommen (Query aus 20260328 wiederverwenden)
-- Pro Kandidat: max(1 - (cand.embedding <=> winner.embedding)) über alle Winner
```
Pattern-Vorlage: `find_similar_edit_examples` / `find_similar_items`. Cosine via `1 - (a <=> b)`, HNSW-Index auf `daily_repo.embedding` existiert.

### 5.4 Optional: `news_queue.metadata` (JSONB, existiert)
Zwischenspeichern von `reason`/`suggested_rank` pro Item ohne Schema-Migration möglich — aber `ranking_suggestions` ist sauberer für die Label-Historie. Wir nutzen die Tabelle, nicht `metadata`.

## 6. Stufen im Detail

### Stufe 1 — Recall-Vorfilter (kein/kaum LLM)
- **R1** = `total_score` DESC (existiert, generated column).
- **R2** = `get_winner_similarity` (neu).
- **Fusion:** Reciprocal Rank Fusion `score = Σ 1/(k + rang)`, `k = 60`. Normalisierungsfrei, robust.
- **Output:** Top ~60–80 (aufweiten!). Source-Diversity-Cap (Prinzip aus `news_queue_selectable`-View, 30 %) **erst NACH RRF**, falls überhaupt.
- **Gate vor dem Bau:** Stufe-1-Recall@70 messen, Ziel **> 0,7**. Wird das nicht erreicht → Stufe 1 streichen, alle 150 an Stufe 2.

### Stufe 2 — LLM-Listwise-Rerank mit Begründung (1 Call/Tag)
- **Neue Datei:** `lib/news-queue/reranker.ts` (strukturell wie `streamGhostwriter` + `buildPromptEnhancement`).
- **Modell:** neuer `UseCase` `'queue_ranking'` in `lib/ai/model-config.ts`, Default `claude-sonnet-4-6-20260301`, DB-konfigurierbar.
- **Few-Shot-Builder** `getRankingFewShots()`: letzte ~15 published Items (positiv) + ~15 ignored/expired (negativ) + aktive `ranking_preferences` als Regeln (analog `buildPromptEnhancement`). **Prompt-Caching** für den Few-Shot-Block.
- **Input pro Kandidat:** Titel + Excerpt + Quelle + rohe R1/R2-Ränge (InsertRank-Trick: Scores ins Prompt hilft dem Reasoning).
- **Output:** JSON `[{queueItemId, rank, reason, confidence}]`.
- **Härtung:** (a) `queueItemId` strikt gegen Kandidatenliste validieren (Halluzinations-Schutz); (b) Kandidaten-Reihenfolge **shuffeln** gegen Positional Bias; bei Bedarf 3× permutieren + Aggregation.

### Stufe 3 — Mensch-im-Loop + Lernen
- **UI:** Erweiterung `app/admin/news-queue/page.tsx` — neuer „Vorschläge generieren"-Button + Vorschlagsliste mit `reason`, Accept/Reject/Add/Reorder.
- **Endpoint:** `app/api/admin/ranking-feedback/route.ts` schreibt `user_action` nach `ranking_suggestions`.
- **Lern-Hebel:**
  - **(a) Sofort:** accepted/rejected/added → Few-Shots der Folgetage. Kein Training.
  - **(b) Aggregiert (Phase 2):** Cron `app/api/cron/extract-ranking-preferences/route.ts` (analog `extract-patterns`) clustert Feedback nach source/topic/category → `ranking_preferences`. Confidence-Update gespiegelt an `handle_pattern_feedback`: **Accept +0.02, Reject −0.1, Auto-Deaktivierung wenn confidence−0.1 < 0.3**; Decay `0.95^(Tage/7)` via Kopie von `calculateEffectiveConfidence`.

## 7. Eval-Harness (MVP-Pflicht, nicht Phase 2)
- Metriken: **Recall@15 / NDCG@15** der Vorschläge gegen Mattes' finale (publizierte) Auswahl.
- Ground Truth: die publizierten `queueItemId`s (Query aus `20260328_optimized_scoring.sql` wiederverwenden).
- Zweck: Verifizieren, dass der teure LLM-Schritt **über** dem 0,275-Linearmodell liegt — sonst lohnt er nicht. Erweitert das vorhandene `scripts/backtest-scoring.ts`.

## 8. Phase 0 — Prerequisite-Fixes (zwingend zuerst)
1. **Label-Pipeline reparieren:** Den 2 h-Auto-Reset in `getSelectedItems()` (`service.ts:596–611`) und den toten `selected`-Status so umbauen, dass persistentes accept/reject/add/reorder-Logging entsteht (über `ranking_suggestions`). Ohne das gibt es nichts zu lernen.
2. **Eval-Harness** (§7) etablieren.

## 9. Wiederverwendete Bausteine

| Baustein | Herkunft | Verwendung |
|----------|----------|-----------|
| `total_score` (generated) | `20260328_optimized_scoring.sql` | R1 in Stufe 1 |
| `daily_repo.embedding` (768, HNSW) | `20260103_synthesis_tables.sql` | R2 / Winner-Similarity |
| `generateEmbedding` | `lib/embeddings/generator.ts` | Embeddings on-the-fly |
| `find_similar_*` RPC-Muster | `lib/synthesis/search.ts`, `retrieval.ts` | Vorlage für `get_winner_similarity` |
| Published-Items-SQL (`jsonb_array_elements`) | `20260328`-Backfill | Winner + Few-Shots + Eval Ground Truth |
| `calculateEffectiveConfidence`, `handle_pattern_feedback`, `learned_patterns`-Schema | Edit-Learning | 1:1-Template für `ranking_preferences` |
| `buildPromptEnhancement` | `retrieval.ts` | Vorlage für Few-Shot-/Preference-Block |
| `getModelForUseCase` | `lib/ai/model-config.ts` | Modell-Routing (`queue_ranking`) |
| extract-patterns Cron-Muster | `app/api/cron/extract-patterns` | Vorlage für Preference-Extraktion |

**Externes Tool als Komponente: nein.**

## 10. Phasenplan

| Phase | Inhalt | Verifikation |
|-------|--------|-------------|
| **0** | Label-Pipeline-Fix + Eval-Harness | `ranking_suggestions` füllt sich; Recall@15-Baseline reproduzierbar |
| **1** | Stufe-1-Recall-Test: RRF-Hybrid **vs.** „1 LLM-Call über alle 150" | Variante mit höherem Recall@K bei tragbaren Kosten gewählt |
| **2** | Stufe 2 (`reranker.ts`) + Stufe-3-UI + Feedback-Endpoint | Vorschläge mit `reason` erscheinen; Feedback wird geloggt; Eval > 0,275 |
| **3** | Aktiver Lern-Loop: `ranking_preferences` + Extraktions-Cron + Few-Shot aus jüngsten Labels | Preferences entstehen; mit Exploration-Slot |

## 11. Was bewusst NICHT gebaut wird
- **Hermes Agent:** Task-Execution-Agent, kein Ranking; „Learning Loop" optimiert Aufgaben-Erledigung, nicht Item-Relevanz; zweiter Stack (Python+Honcho); v0.1x.
- **GBrain:** Memory/Retrieval-Layer; sein „Ranking" = Query-Relevanz (deckt `total_score`/`source_bonus` schon ab); Preference-Loop fehlt; v0.30, breaking changes.
- **Voll-Auto-Publishing:** widerspricht dem assistierten Zielbild.
- **Reines trainiertes Learning-to-Rank:** zu wenig Labels (~10–15/Tag) — Few-Shot schlägt es bei dieser Datenmenge.

## 12. Entscheidungen (Defaults — bitte prüfen)
- **MVP-Scope:** Phase 0–2 ist das MVP; der **aktive Lern-Loop (Phase 3) ist bewusst nachgelagert**, weil das Label-Volumen erst wachsen muss.
- **Trigger:** On-Demand-Button in der UI (Mattes steuert, wann gerankt wird). Täglicher Cron-Vorberechnung optional später.
- **Anzahl Vorschläge:** ~15 (Mattes trimmt nach unten), konfigurierbar.
- **R2-Methode:** Max-Similarity zu letzten N Winnern (multimodal) statt Centroid.

## 13. Risiken & offene Fragen
1. **Datenarmut beim Lernen:** Echtes „lernt aus jeder Korrektur" greift erst nach ~50–100 Labels (Wochen/Monate). Bis dahin = Few-Shot. → Erwartung managen.
2. **Garbage-in bei Synthesis-Scores:** Niedriger Stufe-1-Recall (0,275) deutet an, dass `relevance_score` (Haiku, generisches Publikum) Mattes' Geschmack schlecht abbildet. Offen: im Reranker-Prompt korrigierbar, oder muss die Input-Bewertung selbst überarbeitet werden? (separates, größeres Thema)
3. **Feedback-Loop-Bias:** Nur LLM-vorgeschlagene Items bekommen Labels → Selbstverstärkung. Gegenmittel: **Exploration-Slot** (gelegentlich Items unter Top-15 zeigen) ab Phase 3.
4. **Doku-Drift:** `CLAUDE.md` beschreibt veraltete Score-Formel (0.4/0.3/0.3) + 30 %-Limit. Sollte separat korrigiert werden.
