# News-Taste-Modell: Jev-Features + trainierter Kopf — Design-Spec

Datum: 2026-09-29
Status: freigegeben (Konversation 2026-09-29)
Ersetzt: LLM-Listwise-Reranker des assistierten Rankings (Spec 2026-06-01)

---

## Ziel

Der Button „Vorschläge generieren" im News-Queue-Admin liefert täglich die ~15
Kandidaten, aus denen Mattes die ~10 Abschnitte des Tagesposts wählt. Der
heutige LLM-Listwise-Reranker (`lib/news-queue/reranker.ts`) trifft seinen
Geschmack nicht („Vorschläge treffen nicht", Betreiber 2026-09-29) und wird
komplett ersetzt durch:

1. **Jev als Feature-Extraktor:** `typesafe-ai/jev` (TypeSafe System One,
   via Vercel AI Gateway) beantwortet pro Artikel einen festen Katalog von
   ~30 typisierten Fragen → kalibrierter numerischer Feature-Vektor.
2. **Ein eigenes trainiertes Modell obendrauf:** ein überwacht trainierter
   Klassifikator (logistische Regression oder Gradient Boosting, Entscheidung
   per Backtest), trainiert auf ~250 Tagen Ground Truth (~6.500 Picks in
   veröffentlichten Posts), Inferenz in reinem TypeScript.

Button, API-Route, Admin-UI und die Tabellen `ranking_runs` /
`ranking_suggestions` bleiben unverändert; nur das Innere von
`generateRankingSuggestions()` wird ausgetauscht.

## Nicht-Ziele

- Kein Umbau der News-Queue, des Scorings (`total_score`) oder des Ghostwriters.
- Keine Vollautomatik: Mattes wählt weiterhin manuell aus den Vorschlägen.
- Kein AI-SDK-7-Upgrade (Repo nutzt `ai@6`); Zugriff läuft über die
  Gateway-HTTP-API, nicht über `experimental_evaluate`.
- Kein Cron-Retraining in v1 (manuelles Skript; Cron erst, wenn sich der
  Ansatz bewährt).
- Kein Admin-Model-Config-Eintrag für Jev: Es gibt genau ein Evaluation-Modell;
  `typesafe-ai/jev` steht als Konstante im Client (Kommentar erklärt warum).

## Zugriff: Vercel AI Gateway (Betreiber-Vorgabe 2026-09-29)

- Endpoint `POST https://ai-gateway.vercel.sh/v1/evaluate`, Auth
  `Authorization: Bearer $AI_GATEWAY_API_KEY`.
- Key „synthszr" existiert (Budget $20/Monat, Alerts 75/100 %), liegt in
  `.env.local`, `~/.synthszr.env.prod` und den Vercel-Envs
  (production/preview/development).
- Abrechnung über Gateway-Credits; optional kann der vorhandene TypeSafe-Key
  später als BYOK ins Vercel-Dashboard (Entscheidung offen, blockiert nichts).
- Antwort-Metadaten (`providerMetadata.gateway.cost`, `usage`) fließen ins
  vorhandene `llm_usage`-Logging (`lib/ai/usage-logging`-Muster mit `after()`).
- Rate-Limits (Stand 2026-09-29): 250k Tokens/s, 1.200 Requests/min, 64k
  Tokens/Request (32k für State + längste Frage). Smoke-Test verifiziert.

## Architektur

```
                    OFFLINE (einmalig + Retrain)
daily_repo/news_queue ──► Backfill-Skript ──► news_taste_features (Tabelle)
                                                    │
                              Export dataset.json ◄─┘
                                    │
                        uv run train_news_taste.py
                                    │  (temporaler Split, LR vs. GBM,
                                    │   Metrik-Report als Gate)
                                    ▼
                        lib/news-taste/model.json (Artefakt, versioniert)

                    RUNTIME (Button-Klick, unverändertes Äußeres)
Stufe 1 (bleibt): pending, 24h, Junk-Filter, ≥500 Zeichen, ≤200 Kandidaten
        │
        ▼
Feature-Lookup in news_taste_features; fehlende via /v1/evaluate
(parallel, Concurrency ~20; ein Request je Artikel mit allen Fragen)
        │
        ▼
predict.ts: Modell-Score je Kandidat ──► Sortierung ──► semantic-dedup
        │
        ▼
Top 15 ──► ranking_runs + ranking_suggestions (wie bisher) ──► UI
```

### Komponenten

**`lib/ai/evaluate.ts`** — typisierter HTTP-Client für die Gateway-Evaluation
(kein neues npm-Paket). Fragen-Typen `boolean` / `choice` / `score` als
TS-Typen, Antwort-Typen mit Wahrscheinlichkeiten. Retry mit Backoff, honoriert
`retry-after` (429), Timeout, Usage-Logging. Modell-Konstante
`typesafe-ai/jev`.

**`lib/news-taste/questions.ts`** — der Fragenkatalog, exportiert als
`TASTE_QUESTIONS` + `FEATURES_VERSION` (Integer, wird bei jeder inhaltlichen
Änderung erhöht). ~30 Fragen auf Englisch (Quellartikel sind überwiegend
englisch), abgeleitet aus den Kriterien des bisherigen Few-Shot-Prompts
(`few-shot.ts`) und den Publikationsmustern: konkretes Ereignis vs. Tutorial/
Listicle/Meinung, Produktlaunch, Modell-Release, Strategie-/Firmen-Move,
Sicherheitsvorfall, Forschungsdurchbruch, Marktbewegung, Aussage relevanter
Person, Big-Player-Beteiligung, Werbung/PR, Newsletter-Boilerplate,
Wichtigkeits-Score u. a. Boolean → 1 Feature (Wahrscheinlichkeit), Score →
2 Features (interpolierter Wert + Streuung), Choice → One-Hot der Optionen.

**`lib/news-taste/features.ts`** — baut den `state` (Titel, Quelle, Anriss;
Content auf ~1.500 Zeichen gekürzt), ruft `evaluate.ts`, mappt Antworten
deterministisch auf den Feature-Vektor (feste Reihenfolge, dokumentierte
Namen). Persistiert in `news_taste_features`.

**Migration `news_taste_features`** —
`queue_item_id uuid PK → news_queue(id) ON DELETE CASCADE`,
`features jsonb` (Name → Zahl), `features_version int`, `model text`,
`input_tokens int`, `created_at timestamptz`. Unique je (queue_item_id,
features_version); Lookup-Index über beide. Service-Role-only (RLS wie
Nachbartabellen).

**`scripts/backfill-taste-features.ts`** — Backfill für alle Queue-Items der
Tage mit mindestens einem veröffentlichten Post (~230 Tage), gefiltert wie
Stufe 1 (Junk, ≥500 Zeichen), damit Trainings- und Laufzeitverteilung
übereinstimmen. Idempotent (überspringt vorhandene Version), drosselt unter
den Rate-Limits, loggt Fortschritt + Kosten. Erwartung: ~50–90k Items,
~2k Tokens/Item → einmalig ca. $5–10, Laufzeit ~1,5 h.

**`scripts/export-taste-dataset.ts`** — exportiert `dataset.json`: je Tag die
Kandidaten mit Feature-Vektor, Zusatzsignalen (synthesis/relevance/uniqueness,
source_pub_rate, content_length, Quelle) und Label. **Label = Item landete in
einem veröffentlichten Post** (Ermittlung wie `scripts/backtest-scoring.ts`:
queueItemId-Attribute im TipTap-Content veröffentlichter `generated_posts`,
ergänzt um `used_in_post_id`). Python bekommt nur diese Datei, keine
Supabase-Credentials.

**`scripts/train_news_taste.py`** — uv-Skript (PEP-723-Inline-Deps:
scikit-learn, lightgbm, numpy). Temporaler Split: älteste ~80 % der Tage
Training, jüngste ~20 % Test (kein Shuffle über Tage). Trainiert logistische
Regression und LightGBM, evaluiert **pro Tag als Ranking**: Recall@10,
Recall@15, NDCG@15 (Wiederverwendung der Definitionen aus
`lib/news-queue/metrics.ts`, in Python nachgebildet). Baselines im selben
Report: (a) `total_score`-Sortierung, (b) gemessene Trefferquote der 134
bisherigen Reranker-Läufe aus `ranking_suggestions` gegen die echten Picks.
Gewinner-Modell → `lib/news-taste/model.json`; bei annähernd gleicher Güte
(< 1 Punkt NDCG-Differenz) gewinnt die logistische Regression (einfacheres
Artefakt). Report → `scripts/taste-train-report.json` + Konsolen-Tabelle.

**`lib/news-taste/model.json` + `lib/news-taste/predict.ts`** — Artefakt im
Repo (versioniert, enthält `features_version`, Modelltyp, Parameter,
Trainingsdatum, Testmetriken). `predict.ts` ist pure TS-Inferenz: LR =
Skalarprodukt + Sigmoid; LightGBM = kleiner Tree-Walker über die exportierte
Baumstruktur. Wirft beim Laden, wenn `features_version` von Artefakt und
`questions.ts` auseinanderlaufen.

**`lib/news-queue/ranking-service.ts` (Umbau)** — Stufe 1 unverändert. Danach:
Features aus Tabelle lesen, fehlende live berechnen (Concurrency ~20, Fehler
pro Item tolerieren), `predict()`, absteigend sortieren, semantische Dedup
über `semantic-dedup.ts` (Top-Kandidaten gegeneinander, damit nicht drei
Varianten derselben Story die Liste füllen), Top 15 mit Score als `reason`
(„Taste-Score 0.87; Launch 0.97, Event 0.95") in `ranking_runs` /
`ranking_suggestions` schreiben — Format wie bisher, UI merkt nichts.

**Aufräumen (nach Umschalten, gleicher PR-Zug):** `reranker.ts`,
`few-shot.ts`, `reranker-parse.ts`, `winner-similarity.ts` samt Tests
entfernen; Use-Case-Eintrag des Rerankers aus `lib/ai/use-cases.ts` und der
Admin-Settings-Gruppierung austragen. `rrf.ts`/`metrics.ts` bleiben
(Eval-Nutzen).

## Fehlerbehandlung

- **Gateway nicht erreichbar / Budget erschöpft / 429-Dauerfall:** Items ohne
  Features werden mit `total_score`-Fallback einsortiert; schlägt mehr als die
  Hälfte fehl, bricht der Lauf mit sichtbarer Fehlermeldung ab (kein stiller
  Qualitätsverfall). Der Fallback wird im `reason`-Feld gekennzeichnet.
- **Einzelner Item-Fehler im Backfill:** protokollieren, weiter; Abschluss-
  Report nennt die Fehlquote.
- **Artefakt/Katalog-Drift:** `predict.ts` verweigert den Start bei
  `features_version`-Mismatch → Fehler statt falscher Scores.

## Kosten

- Einmalig Backfill: ca. $5–10 (s. o.), gedeckelt durchs Key-Budget $20/Monat.
- Täglich: ~200 Kandidaten × ~2k Tokens ≈ $0,02/Tag Obergrenze; real weniger,
  da Features gecacht sind und nur neue Items zahlen.
- Ersparnis: der bisherige Listwise-LLM-Call (Opus/Sonnet, ~200 Items im
  Prompt) entfällt komplett.

## Erfolgskriterium & Gate

Umgeschaltet wird erst, nachdem der Trainings-Report vorliegt und dem
Betreiber gezeigt wurde. Erwartung: Recall@15 des neuen Modells ≥ gemessene
Trefferquote der bisherigen Reranker-Läufe auf demselben Zeitraum. Liegt das
Modell darunter, wird nicht stillschweigend umgeschaltet, sondern der Befund
vorgelegt (Betreiber entscheidet: trotzdem, Fragenkatalog iterieren, oder
abbrechen).

## Tests

- `evaluate.ts`: Unit-Tests mit gemocktem fetch (Antwort-Mapping, Retry bei
  429 mit retry-after, Fehlerpfade).
- `features.ts`: goldener Antwort→Vektor-Test (feste Reihenfolge, One-Hot,
  Score-Interpolation), State-Kürzung.
- `predict.ts`: goldene Vektoren → erwartete Scores für LR und Baum-Walker;
  Version-Mismatch wirft.
- `ranking-service`: Integrationstest mit gemocktem Gateway + Supabase-Stub
  (Fallback-Pfad, Dedup, Persistenz-Format unverändert).
- Training verifiziert sich über den Metrik-Report (kein CI-Test).

## Offene Punkte

- BYOK (TypeSafe-Key im Vercel-Dashboard) — optional, jederzeit nachrüstbar.
- Cron-Retraining + automatischer Label-Nachschub — Folgearbeit nach
  Bewährung; die Labels entstehen ohnehin laufend in `generated_posts`.
