# Repo-Intensität-Slider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein neuer „Repo-Intensität"-Slider (0–100 %) steuert dosierbar, wie stark Mattes' Code-Crash-Korpus über eine konzeptuelle Retrieval-Query in die Synthszr Takes einfließt.

**Architecture:** Eine reine Funktion `repoRetrievalParams(intensity)` mappt den Slider auf `{limit, threshold} | null`. `writeSection` nutzt sie: bei aktiver Intensität wird der Mattes-Korpus mit einer KONZEPTUELLEN Query (`heading + takeAngle`, ohne den langen faktenreichen `content`) abgefragt — sonst gar nicht. Der Wert fließt wie `vocabularyIntensity` durch beide Pipeline-Pfade, wird in `article_jobs` persistiert und ist im create-article-UI + im Cron einstellbar.

**Tech Stack:** TypeScript, Next.js, Supabase (Postgres), Vitest, pgvector (`match_mattes_chunks` RPC).

## Global Constraints

- `repoRetrievalParams`-Kurve exakt: `<=0 → null`; `1–25 → {limit:1, threshold:0.5}`; `26–50 → {limit:2, threshold:0.5}`; `51–75 → {limit:3, threshold:0.5}`; `76–100 → {limit:4, threshold:0.45}`. Werte außerhalb 0–100 klemmen.
- Mattes-Retrieval-Query KONZEPTUELL (`heading + takeAngle`, **kein** content). History-Retrieval bleibt unverändert (volle `retrievalQuery` mit content).
- `repoIntensity` fließt durch BEIDE `writeSection`-Pfade: `writeSectionsBatch` (article_jobs/Cron) UND `runGhostwriterPipeline` (`/api/ghostwriter-queue`).
- Default 40 überall: UI-State, Cron, DB-Spalten-Default. Code-Fallback in writeSection `?? 0` (fail-safe).
- Das bestehende `vocabulary_dictionary` / der Vokabular-Slider bleiben UNVERÄNDERT (zweiter, getrennter Regler).
- Migration wird als Datei erstellt; Anwendung via Supabase CLI / SQL-Editor (MCP hat dieses Projekt nicht) — in Task 6 durch den Controller.
- UI-Texte auf DEUTSCH. Tests: `npx vitest run`. Typecheck: `npx tsc --noEmit` (Exit 0, 0 Fehlerzeilen).

---

### Task 1: `repoRetrievalParams` (reine Funktion, TDD)

**Files:**
- Create: `lib/mattes/repo-intensity.ts`
- Test: `tests/lib/repo-intensity.test.ts`

**Interfaces:**
- Produces: `repoRetrievalParams(intensity: number): { limit: number; threshold: number } | null`

- [ ] **Step 1: Failing test schreiben**

`tests/lib/repo-intensity.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { repoRetrievalParams } from '@/lib/mattes/repo-intensity'

describe('repoRetrievalParams', () => {
  it('gibt null bei 0 (aus)', () => {
    expect(repoRetrievalParams(0)).toBeNull()
  })
  it('klemmt negative Werte auf null', () => {
    expect(repoRetrievalParams(-10)).toBeNull()
  })
  it('1–25 → 1 Passage', () => {
    expect(repoRetrievalParams(1)).toEqual({ limit: 1, threshold: 0.5 })
    expect(repoRetrievalParams(25)).toEqual({ limit: 1, threshold: 0.5 })
  })
  it('26–50 → 2 Passagen', () => {
    expect(repoRetrievalParams(26)).toEqual({ limit: 2, threshold: 0.5 })
    expect(repoRetrievalParams(50)).toEqual({ limit: 2, threshold: 0.5 })
  })
  it('51–75 → 3 Passagen', () => {
    expect(repoRetrievalParams(51)).toEqual({ limit: 3, threshold: 0.5 })
    expect(repoRetrievalParams(75)).toEqual({ limit: 3, threshold: 0.5 })
  })
  it('76–100 → 4 Passagen, threshold 0.45', () => {
    expect(repoRetrievalParams(76)).toEqual({ limit: 4, threshold: 0.45 })
    expect(repoRetrievalParams(100)).toEqual({ limit: 4, threshold: 0.45 })
  })
  it('klemmt >100 auf die oberste Stufe', () => {
    expect(repoRetrievalParams(150)).toEqual({ limit: 4, threshold: 0.45 })
  })
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npx vitest run tests/lib/repo-intensity.test.ts`
Expected: FAIL — `Cannot find package '@/lib/mattes/repo-intensity'`.

- [ ] **Step 3: Implementieren**

`lib/mattes/repo-intensity.ts`:
```ts
// Mappt den "Repo-Intensität"-Slider (0–100) auf Retrieval-Parameter für das
// Mattes-Korpus (findRelevantMattesPassages). null = kein Korpus-Retrieval.
// Die Menge (limit) ist der primäre Dosis-Regler gegen Überdosierung.
export function repoRetrievalParams(intensity: number): { limit: number; threshold: number } | null {
  const n = Math.min(100, Math.max(0, Math.round(intensity)))
  if (n <= 0) return null
  if (n <= 25) return { limit: 1, threshold: 0.5 }
  if (n <= 50) return { limit: 2, threshold: 0.5 }
  if (n <= 75) return { limit: 3, threshold: 0.5 }
  return { limit: 4, threshold: 0.45 }
}
```

- [ ] **Step 4: Test laufen lassen, grün verifizieren**

Run: `npx vitest run tests/lib/repo-intensity.test.ts`
Expected: PASS (7/7).

- [ ] **Step 5: Commit**

```bash
git add lib/mattes/repo-intensity.ts tests/lib/repo-intensity.test.ts
git commit -m "feat(mattes): repoRetrievalParams — Repo-Intensität auf Retrieval-Parameter mappen"
```

---

### Task 2: `writeSection` nutzt die Repo-Intensität

**Files:**
- Modify: `lib/claude/ghostwriter-pipeline.ts` (Import; `writeSection`-context-Signatur ~Z.360-365; Retrieval-Block ~Z.384-420)

**Interfaces:**
- Consumes: `repoRetrievalParams` (Task 1)
- Produces: `writeSection`-context-Feld `repoIntensity?: number`

- [ ] **Step 1: Import ergänzen**

Neben `import { enforceHeadingLength } from '@/lib/claude/heading-length'` einfügen:
```ts
import { repoRetrievalParams } from '@/lib/mattes/repo-intensity'
```

- [ ] **Step 2: context-Signatur erweitern**

Im `writeSection`-`context`-Objekt (nach `takeAngle?: string`):
```ts
    takeAngle?: string
    repoIntensity?: number
```

- [ ] **Step 3: Retrieval-Block umbauen (zwei getrennte Queries)**

Ersetze den Block ab `const retrievalQuery = [heading, context.takeAngle, (item.content...` bis zum Ende des Mattes-`(async () => {...})()`-Zweigs durch:
```ts
  // Mattes-Korpus KONZEPTUELL abfragen (heading + takeAngle, OHNE content): die
  // lange faktenreiche content-Query drückt die Cosine-Similarity zu den
  // konzeptuellen Code-Crash-Passagen unter den Threshold (verifiziert 2026-07-13).
  // Der History-Retrieval nutzt weiter die VOLLE Query (mit content).
  const repoParams = repoRetrievalParams(context.repoIntensity ?? 0)
  const mattesQuery = [heading, context.takeAngle].filter(Boolean).join('\n\n')
  const retrievalQuery = [heading, context.takeAngle, (item.content || '').slice(0, 4000)]
    .filter(Boolean)
    .join('\n\n')
  let mattesBlock = ''
  let historyBlock = ''
  await Promise.all([
    (async () => {
      if (!repoParams) return // Repo-Intensität 0 → kein Korpus-Retrieval
      try {
        const { findRelevantMattesPassages, formatPassagesForPrompt } = await import('@/lib/mattes/retrieval')
        const passages = await findRelevantMattesPassages(mattesQuery, { limit: repoParams.limit, threshold: repoParams.threshold })
        mattesBlock = formatPassagesForPrompt(passages)
        if (passages.length > 0) {
          console.log(`[Pipeline] Retrieved ${passages.length} Mattes passages (repo ${context.repoIntensity ?? 0}%) for "${heading.slice(0, 40)}…"`)
        }
      } catch (err) {
        console.warn('[Pipeline] Mattes retrieval failed (continuing):', err)
      }
    })(),
```
Der zweite (History-)Zweig `(async () => { ... findRelevantPastPosts(retrievalQuery, ...) ... })(),` und das schließende `])` bleiben UNVERÄNDERT.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: Exit 0, 0 Fehlerzeilen. (Bestehende `writeSection`-Aufrufe brechen nicht — `repoIntensity` ist optional.)

- [ ] **Step 5: Commit**

```bash
git add lib/claude/ghostwriter-pipeline.ts
git commit -m "feat(ghostwriter): writeSection fragt Mattes-Korpus konzeptuell + intensitätsgesteuert ab"
```

---

### Task 3: `repoIntensity` durch beide Pipeline-Pfade durchreichen

**Files:**
- Modify: `lib/claude/ghostwriter-pipeline.ts` (`writeSectionsBatch`-Signatur + Aufruf; `runGhostwriterPipeline`-options + worker-Aufruf)
- Modify: `lib/claude/queue-article.ts` (`QueueArticleParams`; `generateQueueArticle`)

**Interfaces:**
- Consumes: `writeSection`-context `repoIntensity?: number` (Task 2)
- Produces: `writeSectionsBatch(..., repoIntensity?: number)`; `runGhostwriterPipeline(items, model, { ..., repoIntensity?: number })`; `QueueArticleParams.repoIntensity?: number`

- [ ] **Step 1: `writeSectionsBatch`-Signatur + Aufruf**

Signatur: nach `onBatch?: (...) => Promise<void>,` einen Parameter ergänzen:
```ts
  onBatch?: (nextCursor: number, newSections: string[]) => Promise<void>,
  repoIntensity?: number,
): Promise<WriteBatchResult> {
```
Im per-item `writeSection`-Aufruf innerhalb `writeSectionsBatch` (das context-Objekt, das bereits `takeAngle` enthält) ergänzen: `repoIntensity,`.

- [ ] **Step 2: `runGhostwriterPipeline`-options + worker-Aufruf**

Options-Typ erweitern:
```ts
  options: { concurrency?: number; vocabularyContext?: string; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; repoIntensity?: number } = {},
```
Direkt nach dem Destrukturieren der options (wo `effort`/`vocabularyContext` entnommen werden) `repoIntensity` mitnehmen; im zweiten `writeSection`-Aufruf (worker-Loop, enthält bereits `takeAngle`) ergänzen: `repoIntensity,`.

- [ ] **Step 3: `QueueArticleParams` + `generateQueueArticle`**

In `lib/claude/queue-article.ts`, `QueueArticleParams` nach `vocabularyIntensity?: number` ergänzen:
```ts
  repoIntensity?: number    // 0–100; default 40. Steuert das Code-Crash-Korpus-Retrieval.
```
In `generateQueueArticle` beim Destrukturieren von `params` `repoIntensity = 40` mit Default entnehmen (analog `vocabularyIntensity = 50`), und im `runGhostwriterPipeline`-Aufruf die options um `repoIntensity` ergänzen: `runGhostwriterPipeline(pipelineItems, model, { vocabularyContext, effort, repoIntensity })`.

- [ ] **Step 4: Typecheck + bestehende Tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc Exit 0; alle Tests grün (reine Durchreichung/optional).

- [ ] **Step 5: Commit**

```bash
git add lib/claude/ghostwriter-pipeline.ts lib/claude/queue-article.ts
git commit -m "feat(ghostwriter): repoIntensity durch writeSectionsBatch + runGhostwriterPipeline durchreichen"
```

---

### Task 4: Persistenz in `article_jobs` + Migration + Cron-Default

**Files:**
- Create: `supabase/migrations/<timestamp>_article_jobs_repo_intensity.sql`
- Modify: `lib/article-jobs/service.ts` (`JobRow`; beide `createArticleJob`-Signaturen + inserts; `writeSectionsBatch`-Aufruf)
- Modify: `app/api/cron/scheduled-tasks/route.ts` (Cron-Default)

**Interfaces:**
- Consumes: `writeSectionsBatch(..., repoIntensity?)` (Task 3)
- Produces: `article_jobs.repo_intensity` (DB); `createArticleJob`/`createManualArticleJob`-opts `repoIntensity: number`

- [ ] **Step 1: Migrationsdatei erstellen**

Neue Datei `supabase/migrations/20260713__article_jobs_repo_intensity.sql` (Timestamp an bestehende Migrationen im Ordner anpassen — gleiche Namenskonvention wie die neueste Datei dort):
```sql
alter table public.article_jobs
  add column if not exists repo_intensity integer not null default 40;
```

- [ ] **Step 2: `JobRow` + `createArticleJob`-opts + inserts**

In `lib/article-jobs/service.ts`:
- `JobRow`: nach `vocabulary_intensity: number` → `repo_intensity: number`.
- In BEIDEN `createArticleJob`/`createManualArticleJob`-opts-Objekten (die `vocabularyIntensity: number` enthalten, ~Z.83 und ~Z.136) → `repoIntensity: number` ergänzen.
- In BEIDEN insert-Objekten (die `vocabulary_intensity: opts.vocabularyIntensity` setzen, ~Z.114 und ~Z.157) → `repo_intensity: opts.repoIntensity,` ergänzen.

- [ ] **Step 3: `writeSectionsBatch`-Aufruf um `job.repo_intensity`**

Im `writeSectionsBatch`-Aufruf (~Z.416, endet aktuell mit dem `onBatch`-Callback) nach dem Callback als letztes Argument ergänzen: `job.repo_intensity`. Konkret wird das Aufruf-Ende zu:
```ts
        async (nextCursor, newSections) => {
          await supabase
            .from('article_jobs')
            .update({ written_sections: [...prevWritten, ...newSections], cursor: nextCursor })
            .eq('id', job.id)
        },
        job.repo_intensity,
      )
```
(Die genaue Struktur des Callbacks unverändert lassen — nur `job.repo_intensity,` als weiteres Argument nach dem Callback.)

- [ ] **Step 4: Cron-Default**

In `app/api/cron/scheduled-tasks/route.ts`, im `createArticleJob({...})`-Aufruf nach `vocabularyIntensity: 50,` ergänzen: `repoIntensity: 40,`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: Exit 0, 0 Fehlerzeilen. (Die Migration wird noch NICHT angewendet — nur die Datei erstellt. Der Code kompiliert, weil `repo_intensity` als Feld im `JobRow`-Typ steht; DB-Anwendung folgt in Task 6.)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations lib/article-jobs/service.ts app/api/cron/scheduled-tasks/route.ts
git commit -m "feat(article-jobs): repo_intensity persistieren + Cron-Default 40 + Migration"
```

---

### Task 5: API-Route + UI-Slider

**Files:**
- Modify: `app/api/admin/article-job/route.ts` (`repoIntensity` aus Body → `createArticleJob`)
- Modify: `app/api/ghostwriter-queue/route.ts` (`repoIntensity` aus Body → `generateQueueArticle`)
- Modify: `app/admin/create-article/page.tsx` (State + Slider-Card + Body)

**Interfaces:**
- Consumes: `createArticleJob(... repoIntensity)` (Task 4), `generateQueueArticle({ repoIntensity })` (Task 3)

- [ ] **Step 1: `/api/admin/article-job`-Route**

Die Route liest den Body (`useSelected`, `maxItems`, `vocabularyIntensity`) und ruft `createArticleJob`/`createManualArticleJob`. Ergänze `repoIntensity` aus dem Body mit Default 40 (analog wie `vocabularyIntensity` gelesen/weitergegeben wird) und übergib es an den createJob-Aufruf. Wenn die Route `vocabularyIntensity` mit einem Default liest (z.B. `const { vocabularyIntensity = 50 } = body`), ergänze `repoIntensity = 40` genauso und reiche es weiter.

- [ ] **Step 2: `/api/ghostwriter-queue`-Route**

Analog: `repoIntensity` aus dem Body (Default 40) lesen und an `generateQueueArticle({ ..., repoIntensity })` weitergeben, exakt wie `vocabularyIntensity` dort behandelt wird.

- [ ] **Step 3: UI-State + Body**

In `app/admin/create-article/page.tsx`:
- Neben `const [vocabularyIntensity, setVocabularyIntensity] = useState(50)` (~Z.125): `const [repoIntensity, setRepoIntensity] = useState(40)`.
- Im fetch-Body (~Z.306, `body: JSON.stringify({ useSelected: true, maxItems: maxQueueItems, vocabularyIntensity })`) ergänzen: `repoIntensity`.
- Falls `vocabularyIntensity` in einem `useCallback`-Dependency-Array steht (~Z.426), `repoIntensity` dort ebenfalls ergänzen.

- [ ] **Step 4: Slider-Card**

Direkt nach der bestehenden `{/* Vocabulary Intensity Slider */}`-Card eine analoge Card einfügen:
```tsx
          {/* Repo Intensity Slider */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Gauge className="h-4 w-4" />
                Repo-Intensität
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm text-muted-foreground">
                    {repoIntensity === 0
                      ? 'Aus'
                      : repoIntensity <= 25
                      ? 'Minimal'
                      : repoIntensity <= 50
                      ? 'Moderat'
                      : repoIntensity <= 75
                      ? 'Aktiv'
                      : 'Intensiv'}
                  </Label>
                  <span className="text-sm font-medium">{repoIntensity}%</span>
                </div>
                <Slider
                  value={[repoIntensity]}
                  onValueChange={(value) => setRepoIntensity(value[0])}
                  max={100}
                  step={5}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  {repoIntensity === 0
                    ? 'Deine Schriften (Code Crash) fließen nicht ein.'
                    : repoIntensity <= 25
                    ? 'Ein Argument-Anker aus deinen Schriften pro Abschnitt.'
                    : repoIntensity <= 50
                    ? 'Moderater Rückgriff auf deine Schriften (2 Passagen).'
                    : repoIntensity <= 75
                    ? 'Deine Argumente werden aktiv eingebaut (3 Passagen).'
                    : 'Starker Durchschlag deiner Schriften (4 Passagen).'}
                </p>
              </div>
            </CardContent>
          </Card>
```

- [ ] **Step 5: Typecheck + Build-Check der geänderten Route/Page**

Run: `npx tsc --noEmit`
Expected: Exit 0, 0 Fehlerzeilen.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/article-job/route.ts app/api/ghostwriter-queue/route.ts app/admin/create-article/page.tsx
git commit -m "feat(admin): Repo-Intensität-Slider im create-article-UI + API-Routen"
```

---

### Task 6: Migration anwenden + E2E-Verifikation (Controller)

**Files:**
- Temp: `scripts/_verify_repo_intensity.ts` (nach Lauf löschen)

**Interfaces:**
- Consumes: `planArticle`, `writeSectionsBatch`, `buildSectionContext`, `repoRetrievalParams` (bestehend)

- [ ] **Step 1: Migration anwenden (Controller/User)**

Die Migration `article_jobs.repo_intensity` via Supabase CLI (`supabase db push`) oder SQL-Editor anwenden. Verifizieren: `select column_name from information_schema.columns where table_name='article_jobs' and column_name='repo_intensity';` liefert eine Zeile.

- [ ] **Step 2: E2E-Verifikationsscript**

`scripts/_verify_repo_intensity.ts` — bei Intensitäten 0/40/75/100 einen kleinen Digest generieren und prüfen, wie viele Mattes-Passagen greifen und ob die Takes sie sinnvoll (nicht wörtlich) nutzen:
```ts
import { planArticle, writeSectionsBatch, buildSectionContext } from '@/lib/claude/ghostwriter-pipeline'
import { getModelForUseCase } from '@/lib/ai/model-config'

async function main() {
  const planModel = await getModelForUseCase('article_planning')
  const writeModel = await getModelForUseCase('ghostwriter')
  const items = [
    { id: '1', title: 'Prime Intellect sammelt 130 Mio für Open-Source-Superintelligence', content: 'Auf der Cap-Table stehen NVIDIA, Intel, Dell. Ein eigenes 35B-Modell schlägt Opus zu einem Bruchteil der Kosten.', source_display_name: 'X', source_url: null, source_identifier: 'x' },
    { id: '2', title: 'Tech-Sentiment-Umfrage: KI spaltet die Belegschaft', content: 'Im Interview ist KI vom Betrugsversuch zum Prüfstein geworden; Skill Atrophy als Risiko.', source_display_name: 'BI', source_url: null, source_identifier: 'bi' },
    { id: '3', title: 'Chinas Maschinenbau holt den deutschen Mittelstand ein', content: 'Zweit- und Drittzulieferer mit eingebettetem Domänenwissen als letztem Vorsprung.', source_display_name: 'FAZ', source_url: null, source_identifier: 'faz' },
  ]
  const plan = await planArticle(items, planModel)
  const ordered = plan.ordering.map((i) => items[i - 1]).filter(Boolean)
  for (const repo of [0, 40, 75, 100]) {
    const ctx = await buildSectionContext(ordered, plan, undefined)
    const { sections } = await writeSectionsBatch(ordered, plan, ctx, 0, writeModel, 'high', 240_000, Date.now(), undefined, undefined, repo)
    // Log-Zeilen "[Pipeline] Retrieved N Mattes passages (repo X%)" zeigen, ob/wieviele Passagen greifen.
    console.log(`\n=== repoIntensity ${repo}: ${sections.length} Sektionen erzeugt ===`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
```
Run:
```bash
set -a; source ~/.synthszr.env.prod; set +a
npx tsx scripts/_verify_repo_intensity.ts 2>&1 | grep -E "Retrieved|repoIntensity|==="
rm -f scripts/_verify_repo_intensity.ts
```
Expected: Bei `repo 0` keine „Retrieved Mattes passages"-Zeilen; bei 40/75/100 steigende Passagen-Zahlen (2/3/4). Take-Text stichprobenartig lesen: Code-Crash-Argumente sinnvoll eingewoben, nicht wörtlich zitiert.

- [ ] **Step 3: Ergebnis berichten**

Befund an den User (greift das Repo jetzt? Wirken 75/100 zu aggressiv?). Kein Commit — reine Verifikation.

---

## Self-Review

**Spec coverage:**
- Kern-Mechanik `repoRetrievalParams` → Task 1. ✓
- writeSection konzeptuelle Query + bedingtes Retrieval → Task 2. ✓
- Durchreichung beide Pfade → Task 3. ✓
- Persistenz + Migration + Cron 40 → Task 4. ✓
- API-Routen + UI-Slider → Task 5. ✓
- Verifikation (0/40/75/100) + Migration anwenden → Task 6. ✓
- History-Retrieval unverändert → Task 2 Step 3 (retrievalQuery bleibt, mattesQuery neu). ✓
- Vokabular unverändert → kein Task berührt vocabulary_dictionary/den Vokabular-Slider. ✓

**Placeholder scan:** Kern-Logik (Task 1, 2) mit vollständigem Code; mechanische Spiegelung (Task 3–5) mit exakten Stellen + der lebenden `vocabulary_intensity`-Vorlage (per grep sichtbar) — kein „TBD"/„implement later".

**Type consistency:** `repoIntensity: number` (camelCase in Code/Params/opts), `repo_intensity: number` (snake_case in DB/JobRow/insert) durchgängig; `writeSection`-context-Feld `repoIntensity?: number` in Task 2 definiert, in Task 3 gesetzt; `repoRetrievalParams` Rückgabe `{limit, threshold} | null` in Task 1 definiert, in Task 2 konsumiert. ✓
