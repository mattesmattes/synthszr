# Repo-Intensität-Slider — Design-Spec

**Datum:** 2026-07-13
**Status:** Design approved, bereit für Implementierungsplan

## Problem

Das Mattes-Korpus-Retrieval (`findRelevantMattesPassages`, Tabelle `mattes_chunks`, überwiegend Code Crash) soll die Synthszr Takes in Mattes' Stimme und Argumenten grounden. In der Praxis greift es fast nie: Die reale `retrievalQuery` ist `heading + takeAngle + content` (bis 4000 Zeichen, faktenreich). Empirisch verifiziert (2026-07-13):

- Kurze/konzeptuelle Query („Frontier-Modelle werden Commodity … Jevons") → Similarity **0.70–0.78** zu Code-Crash-Passagen.
- Lange faktenreiche Query („Prime Intellect … NVIDIA, Intel, Dell … 35B-Modell") → **0 Treffer selbst bei Threshold 0.2**.
- Der Embedding-Vektor wird von den konkreten Entitäten (Firmennamen, Zahlen) dominiert, die in den konzeptuellen Code-Crash-Passagen nicht vorkommen → Cosine-Similarity kollabiert.

Folge: In einem realen Post (39/39 Sektionen geprüft) zog das Retrieval **keine** Passage über 0.55. Die Code-Crash-Bezüge in den Takes (Jevons, Intent, Burggraben, Compute-Disziplin) stammen aus der **Persona im Prompt** und **Opus' Allgemeinwissen**, nicht aus gezieltem Korpus-Retrieval. Mattes' eigene Schriften fließen also nicht direkt ein.

## Ziel

Mattes' Repo (Code Crash / `mattes_chunks`) soll **direkt und dosierbar** in die Takes einfließen — über einen neuen, vom bestehenden Vokabular-Slider getrennten „Repo-Intensität"-Regler.

## Nicht-Ziele

- Das bestehende `vocabulary_dictionary` / den Vokabular-Slider ändern (bleibt unverändert, zweiter Regler).
- Den Take-Input ändern: Der `content` bleibt im `userPrompt` für Zusammenfassung/Take. Nur die **Retrieval-Query** wird konzeptuell.

## Design

### Kern-Mechanik (reine Funktion)
Neues Modul `lib/mattes/repo-intensity.ts`:
```ts
export function repoRetrievalParams(intensity: number): { limit: number; threshold: number } | null
```
- `intensity <= 0` → `null` (kein Korpus-Retrieval)
- `1–25` → `{ limit: 1, threshold: 0.5 }`
- `26–50` → `{ limit: 2, threshold: 0.5 }`
- `51–75` → `{ limit: 3, threshold: 0.5 }`
- `76–100` → `{ limit: 4, threshold: 0.45 }`
Werte außerhalb 0–100 werden geklemmt.

### writeSection (`lib/claude/ghostwriter-pipeline.ts`)
- `context` erhält `repoIntensity?: number`.
- Retrieval-Logik (ersetzt die aktuelle `retrievalQuery`-Zeile + den Mattes-Retrieval-Block):
  - `const repoParams = repoRetrievalParams(context.repoIntensity ?? 0)`
  - `repoParams == null` → **kein** `findRelevantMattesPassages`-Aufruf, `mattesBlock = ''`.
  - sonst → `retrievalQuery = [heading, context.takeAngle].filter(Boolean).join('\n\n')` (**content raus**), `findRelevantMattesPassages(retrievalQuery, { limit: repoParams.limit, threshold: repoParams.threshold })`.
- Der History-Retrieval (`findRelevantPastPosts`) bleibt unverändert (nutzt weiterhin `heading + content`).

### Durchreichung (analog `takeAngle`/`effort`)
`repoIntensity` fließt bis `writeSection` durch **beide** Pfade:
- `writeSectionsBatch` — neuer Parameter, in das `writeSection`-context-Objekt.
- `runGhostwriterPipeline` — `options.repoIntensity`, in das `writeSection`-context-Objekt (der zweite Worker-Loop).

### API + Persistenz
- `lib/claude/queue-article.ts`: `generateQueueArticle` nimmt `repoIntensity` aus `params`, reicht es an `runGhostwriterPipeline({ repoIntensity })`.
- `lib/article-jobs/service.ts`: `CreateJobOpts` + `JobRow` erhalten `repoIntensity` / `repo_intensity`; `createJob` persistiert, der Writing-Tick reicht `job.repo_intensity` an `writeSectionsBatch`.
- DB-Migration: `ALTER TABLE article_jobs ADD COLUMN repo_intensity int NOT NULL DEFAULT 40;` — Anwendung via Supabase CLI / SQL-Editor (MCP hat dieses Projekt nicht).

### UI (`app/admin/create-article/page.tsx`)
- Neuer State `repoIntensity` (Default 40), zweite Slider-Card „Repo-Intensität" analog zur Vokabular-Card (Gauge-Icon, Aus/Minimal/Moderat/Aktiv/Intensiv, %-Anzeige, step 5). Repo-spezifische Beschreibungstexte („Deine Schriften aus Code Crash fließen als Argument-Anker ein …").
- `repoIntensity` in den API-Body der Generierungs-Requests.

### Cron
`app/api/cron/scheduled-tasks/route.ts`: setzt `repoIntensity: 40` (analog `vocabularyIntensity: 50`).

## Verifikation
- **Unit:** `repoRetrievalParams` — Grenzen (0, 25, 26, 50, 51, 75, 76, 100), Klemmen (<0, >100), `null` bei 0.
- **Integration:** Echter Lauf bei Intensitäten 0 / 40 / 75 / 100 auf denselben News: (a) Anzahl gezogener Passagen entspricht der Kurve, (b) Passagen tauchen sinnvoll im Take auf, (c) **nicht wörtlich zitiert** (die „zu aggressiv"-Kalibrierung — `formatPassagesForPrompt` mahnt „zitiere nicht wörtlich"; der Test prüft, ob das hält). tsc 0, bestehende Tests grün.

## Touchpoints
| Datei | Änderung |
|---|---|
| `lib/mattes/repo-intensity.ts` (neu) | `repoRetrievalParams` + Unit-Tests |
| `lib/claude/ghostwriter-pipeline.ts` | writeSection context `repoIntensity`, Retrieval-Logik, Durchreichung in writeSectionsBatch + runGhostwriterPipeline |
| `lib/claude/queue-article.ts` | `repoIntensity` in `generateQueueArticle` → `runGhostwriterPipeline` |
| `lib/article-jobs/service.ts` | `repo_intensity` persistieren/lesen → `writeSectionsBatch` |
| `app/api/ghostwriter-queue/route.ts` | `repoIntensity` aus Body |
| `app/admin/create-article/page.tsx` | Slider-Card + State + Body |
| `app/api/cron/scheduled-tasks/route.ts` | `repoIntensity: 40` |
| DB-Migration | `article_jobs.repo_intensity int NOT NULL DEFAULT 40` |
