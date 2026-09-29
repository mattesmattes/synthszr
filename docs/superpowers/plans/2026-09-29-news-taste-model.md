# News-Taste-Modell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der LLM-Listwise-Reranker des assistierten Rankings wird ersetzt durch Jev-Feature-Extraktion (typesafe-ai/jev via Vercel AI Gateway) plus einen eigenen, auf ~250 Tagen Publikations-Ground-Truth trainierten Klassifikator.

**Architecture:** Offline: Backfill schreibt Jev-Feature-Vektoren in `news_taste_features`, ein Export baut `dataset.json`, ein Python-uv-Skript trainiert LR vs. LightGBM (temporaler Split) und exportiert das Gewinner-Artefakt als JSON. Runtime: `generateRankingSuggestions()` behält Stufe 1 und die Schreibwege (`ranking_runs`/`ranking_suggestions`), ersetzt aber den LLM-Call durch Feature-Lookup + TS-Inferenz + semantische Dedup.

**Tech Stack:** Next.js 16 / TypeScript / Supabase / Vercel AI Gateway (`POST /v1/evaluate`, Modell `typesafe-ai/jev`) / Python via uv (scikit-learn, lightgbm) / Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-news-taste-model-design.md`

## Global Constraints

- Arbeitsverzeichnis ist das NEUE Repo `~/dev/synthszr` (Dropbox-Kopie ist deprecated, s. Memory `repo-umzug-dev-synthszr`).
- Kein AI-SDK-7-Upgrade; Gateway-Zugriff per plain `fetch`, kein neues npm-Paket.
- `AI_GATEWAY_API_KEY` liegt bereits in `.env.local`, `~/.synthszr.env.prod` und allen Vercel-Envs. Budget des Keys: $20/Monat.
- Button, Route `app/api/admin/ranking/route.ts`, Cron-Aufrufer und die Tabellen `ranking_runs`/`ranking_suggestions` bleiben unverändert (nur der `model`-/`stage1_method`-Text ändert sich).
- **GATE vor Task 10:** Erst nach Vorlage des Trainings-Reports beim Betreiber und dessen Freigabe wird der Runtime-Umbau (Task 10–11) begonnen.
- Skripte laden Env so: `~/.synthszr.env.prod` falls vorhanden, sonst `.env.local` (Muster s. Task 5).
- Deutsche Code-Kommentare im Stil des Repos (WARUM statt WAS); Fragen an Jev auf Englisch (Quelltexte sind überwiegend englisch).
- Alle Commits enden mit `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- `npm run typecheck` ist zu Beginn sauber und muss nach jedem Task sauber bleiben.

## Review Focus

Die fünf wahrscheinlichsten ungedeckten Fehlerquellen — jede ist als Test im besitzenden Task verankert:

1. **Leerer/fehlender Anriss:** Items ohne `excerpt` dürfen `buildTasteState` nicht crashen und müssen einen sinnvollen State ergeben → Test in Task 3.
2. **Unvollständige Jev-Antwort:** Fehlende Frage-IDs oder unbekannte Choice-Optionen müssen deterministisch auf 0 mappen (kein `NaN` im Vektor) → Test in Task 3.
3. **Gateway-Ausfall mitten im Lauf:** Einzelne Fehlschläge → `total_score`-Fallback ans Listenende; > 50 % Fehlschläge → Lauf bricht sichtbar ab → Test in Task 10.
4. **Artefakt/Katalog-Drift:** `model.json` mit fremder `features_version` muss beim Laden werfen, und der Feature-Lookup darf nur Zeilen der aktuellen Version verwenden → Tests in Task 9 (Laden) und Task 4 (Lookup-Filter).
5. **429 vom Gateway:** `evaluateState` muss `retry-after` honorieren und danach erfolgreich sein, statt sofort zu werfen → Test in Task 1.

---

### Task 1: Gateway-Evaluate-Client

**Files:**
- Create: `lib/ai/evaluate.ts`
- Test: `tests/lib/ai-evaluate.test.ts`

**Interfaces:**
- Consumes: `createAdminClient` aus `@/lib/supabase/admin`; `after` aus `next/server` (Muster wie `lib/ai/usage-log.ts`).
- Produces (spätere Tasks verlassen sich exakt hierauf):
  ```ts
  export const JEV_MODEL = 'typesafe-ai/jev'
  export type EvaluateQuestion =
    | { type: 'boolean'; instructions: string; criteria?: { true: string; false: string } }
    | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
    | { type: 'score'; instructions: string; criteria: string[] }
  export interface BooleanAnswer { type: 'boolean'; probability: number }
  export interface ChoiceAnswer { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence?: number }
  export interface ScoreAnswer { type: 'score'; score: number; probabilities?: number[] | Record<string, number>; confidence?: number }
  export type EvaluateAnswer = BooleanAnswer | ChoiceAnswer | ScoreAnswer
  export interface EvaluateResult {
    answers: Record<string, EvaluateAnswer>
    usage: { inputTokens: number; outputTokens: number }
    costUsd: number | null
  }
  export async function evaluateState(
    state: string,
    questions: Record<string, EvaluateQuestion>,
    opts?: { useCase?: string; maxRetries?: number; sleep?: (ms: number) => Promise<void> },
  ): Promise<EvaluateResult>
  ```

- [ ] **Step 1: Antwortformat der Score-Frage live verifizieren**

Die Docs zeigen für Score-Antworten einen interpolierten `score` plus Wahrscheinlichkeiten je Stufe, aber nicht das exakte JSON. Einmalig prüfen (kostet < $0,001):

```bash
cd ~/dev/synthszr && set -a && source .env.local && set +a && curl -s https://ai-gateway.vercel.sh/v1/evaluate \
  -H "Authorization: Bearer $AI_GATEWAY_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"typesafe-ai/jev","state":"OpenAI announces GPT-6 with major reasoning gains.","questions":{"imp":{"type":"score","instructions":"Rate the importance of this story for a daily tech newsletter.","criteria":["trivial","minor","notable","major","front-page"]}}}' | python3 -m json.tool
```

Erwartung: `answers.imp` enthält `type:"score"` und einen numerischen Wert. **Notiere:** heißt das Feld `score` und auf welcher Skala liegt es (Stufenindex 0–4 oder interpoliert)? Liegt `probabilities` als Array oder Record vor? Weicht das Format von den obigen Typen ab, passe `ScoreAnswer` und später `answersToVector` (Task 3) an das echte Format an.

- [ ] **Step 2: Fehlschlagenden Test schreiben**

```ts
// tests/lib/ai-evaluate.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { evaluateState, JEV_MODEL } from '@/lib/ai/evaluate'

// Usage-Logging weg-mocken: der Client protokolliert nach Supabase, das ist
// hier nicht Testgegenstand und darf keinen Netzwerkzugriff auslösen.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ insert: async () => ({ error: null }) }),
  }),
}))

const okBody = {
  answers: { is_event: { type: 'boolean', probability: 0.93 } },
  usage: { inputTokens: 300, outputTokens: 12 },
  providerMetadata: { gateway: { cost: '0.0000126' } },
}

describe('evaluateState', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('mappt Antwort, Usage und Gateway-Kosten', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify(okBody), { status: 200 }),
    )
    const res = await evaluateState('some article', {
      is_event: { type: 'boolean', instructions: 'Is this a news event?' },
    })
    expect(res.answers.is_event).toEqual({ type: 'boolean', probability: 0.93 })
    expect(res.usage).toEqual({ inputTokens: 300, outputTokens: 12 })
    expect(res.costUsd).toBeCloseTo(0.0000126, 10)
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://ai-gateway.vercel.sh/v1/evaluate')
    expect(JSON.parse((init as RequestInit).body as string).model).toBe(JEV_MODEL)
  })

  it('honoriert retry-after bei 429 und liefert danach die Antwort', async () => {
    const waits: number[] = []
    ;(fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(new Response('rate limited', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(okBody), { status: 200 }))
    const res = await evaluateState('x', { is_event: { type: 'boolean', instructions: 'q' } }, {
      sleep: async (ms) => { waits.push(ms) },
    })
    expect(res.answers.is_event.type).toBe('boolean')
    expect(waits).toEqual([2000])
  })

  it('wirft bei 400 sofort (nicht retrybar) mit Body-Ausschnitt', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('{"error":"bad question"}', { status: 400 }),
    )
    await expect(evaluateState('x', { q: { type: 'boolean', instructions: 'q' } })).rejects.toThrow(/400.*bad question/s)
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })

  it('gibt nach maxRetries erschöpften 5xx auf', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('boom', { status: 503 }))
    await expect(
      evaluateState('x', { q: { type: 'boolean', instructions: 'q' } }, { maxRetries: 2, sleep: async () => {} }),
    ).rejects.toThrow(/503/)
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3) // 1 + 2 Retries
  })
})
```

- [ ] **Step 3: Test laufen lassen — muss scheitern**

Run: `cd ~/dev/synthszr && npx vitest run tests/lib/ai-evaluate.test.ts`
Expected: FAIL („Cannot find module '@/lib/ai/evaluate'“)

- [ ] **Step 4: Client implementieren**

```ts
// lib/ai/evaluate.ts
import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Client für die Evaluation-Modalität des Vercel AI Gateways (System-One-
 * Modell Jev von TypeSafe). Kein LLM: State + typisierte Fragen rein,
 * kalibrierte Wahrscheinlichkeiten raus — Grundlage der News-Taste-Features
 * (Spec 2026-09-29).
 *
 * Bewusst plain fetch statt @typesafe-ai/sdk oder ai@7: das Repo bleibt auf
 * ai@6, und die Gateway-Doku empfiehlt für Neucode ohnehin /v1/evaluate.
 * Es gibt genau EIN Evaluation-Modell, darum Konstante statt
 * getModelForUseCase (die Admin-Model-Config kennt nur LLMs).
 */
export const JEV_MODEL = 'typesafe-ai/jev'
const EVALUATE_URL = 'https://ai-gateway.vercel.sh/v1/evaluate'
const DEFAULT_MAX_RETRIES = 4

export type EvaluateQuestion =
  | { type: 'boolean'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] }

export interface BooleanAnswer { type: 'boolean'; probability: number }
export interface ChoiceAnswer { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence?: number }
export interface ScoreAnswer { type: 'score'; score: number; probabilities?: number[] | Record<string, number>; confidence?: number }
export type EvaluateAnswer = BooleanAnswer | ChoiceAnswer | ScoreAnswer

export interface EvaluateResult {
  answers: Record<string, EvaluateAnswer>
  usage: { inputTokens: number; outputTokens: number }
  costUsd: number | null
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function evaluateState(
  state: string,
  questions: Record<string, EvaluateQuestion>,
  opts: { useCase?: string; maxRetries?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<EvaluateResult> {
  const apiKey = process.env.AI_GATEWAY_API_KEY
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY fehlt in der Umgebung')
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES
  const sleep = opts.sleep ?? defaultSleep

  let lastError = ''
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(EVALUATE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
    })
    if (res.ok) {
      const body = (await res.json()) as {
        answers: Record<string, EvaluateAnswer>
        usage?: { inputTokens?: number; outputTokens?: number }
        providerMetadata?: { gateway?: { cost?: string } }
      }
      const usage = {
        inputTokens: body.usage?.inputTokens ?? 0,
        outputTokens: body.usage?.outputTokens ?? 0,
      }
      const rawCost = body.providerMetadata?.gateway?.cost
      const costUsd = rawCost !== undefined && Number.isFinite(Number(rawCost)) ? Number(rawCost) : null
      scheduleUsageLog(opts.useCase ?? 'news_taste_features', usage, costUsd)
      return { answers: body.answers, usage, costUsd }
    }
    const text = (await res.text()).slice(0, 300)
    lastError = `Gateway ${res.status}: ${text}`
    // Nur Überlast/Serverfehler sind retrybar; 4xx (außer 429) ist ein
    // Request-Problem und wird durch Wiederholen nicht besser.
    const retryable = res.status === 429 || res.status >= 500
    if (!retryable || attempt === maxRetries) throw new Error(lastError)
    const retryAfter = Number(res.headers.get('retry-after'))
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt
    await sleep(waitMs)
  }
  throw new Error(lastError) // unerreichbar, beruhigt TS
}

/**
 * Kostenzeile nach llm_usage — mit den ECHTEN Gateway-Kosten aus der Antwort
 * statt computeCostUsd (Jev steht nicht in model-pricing.ts, und die
 * Gateway-Zahl ist die tatsächlich abgerechnete). FAIL-OPEN + after()-Muster
 * wie lib/ai/usage-log.ts: fehlende Buchungszeile schlägt nie den Aufruf.
 */
function scheduleUsageLog(useCase: string, usage: { inputTokens: number; outputTokens: number }, costUsd: number | null): void {
  const write = async () => {
    try {
      const { error } = await createAdminClient().from('llm_usage').insert({
        use_case: useCase,
        model: JEV_MODEL,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cost_usd: costUsd,
      })
      if (error) console.warn('[JevUsage] Protokoll nicht geschrieben:', error.message)
    } catch (err) {
      console.warn('[JevUsage] Protokoll nicht geschrieben:', err instanceof Error ? err.message : err)
    }
  }
  try {
    after(write)
  } catch {
    void write()
  }
}
```

- [ ] **Step 5: Tests laufen lassen — müssen bestehen**

Run: `cd ~/dev/synthszr && npx vitest run tests/lib/ai-evaluate.test.ts`
Expected: 4 passed

- [ ] **Step 6: Typecheck + Commit**

```bash
cd ~/dev/synthszr && npm run typecheck && git add lib/ai/evaluate.ts tests/lib/ai-evaluate.test.ts && git commit -m "feat(news-taste): Gateway-Evaluate-Client fuer Jev (typesafe-ai/jev)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration `news_taste_features`

**Files:**
- Create: `supabase/migrations/20260929120000_news_taste_features.sql`

**Interfaces:**
- Produces: Tabelle `news_taste_features(queue_item_id, features_version, features, model, input_tokens, created_at)`; PK `(queue_item_id, features_version)`. Task 4 upsertet, Task 7 liest.

- [ ] **Step 1: Migration schreiben**

```sql
-- Jev-Feature-Vektoren je News-Queue-Item (News-Taste-Modell, Spec 2026-09-29).
-- Ein Vektor kostet einen bezahlten Gateway-Call — darum persistiert, damit
-- Training (Export) und Runtime (Ranking) dieselben Werte nutzen und nichts
-- doppelt bezahlt wird. features_version im PK: ändert sich der Fragenkatalog
-- (lib/news-taste/questions.ts), entstehen neue Zeilen, alte bleiben für
-- Reproduzierbarkeit alter Trainingsläufe stehen.
CREATE TABLE IF NOT EXISTS news_taste_features (
  queue_item_id uuid NOT NULL REFERENCES news_queue(id) ON DELETE CASCADE,
  features_version integer NOT NULL,
  -- Name -> Zahl; kanonische Namen und Reihenfolge definiert questions.ts
  features jsonb NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (queue_item_id, features_version)
);

-- Wie llm_usage: nur der Service-Role-Schlüssel liest und schreibt hier.
ALTER TABLE news_taste_features ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Migration auf Prod anwenden**

Run: `cd ~/dev/synthszr && npx supabase db push`
Falls das Projekt nicht verlinkt ist oder ältere Migrationen den Push blockieren: die SQL-Datei im Supabase SQL-Editor des Projekts ausführen (etabliertes Vorgehen im Repo, s. Memory „Supabase migrations may not auto-apply").

- [ ] **Step 3: Verifizieren**

```bash
cd ~/dev/synthszr && cat > /tmp/chk_taste_table.ts <<'EOF'
import { config } from 'dotenv'
config({ path: process.env.HOME + '/.synthszr.env.prod', quiet: true })
async function main() {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { error, count } = await createAdminClient()
    .from('news_taste_features').select('queue_item_id', { count: 'exact', head: true })
  console.log(error ? `FEHLER: ${error.message}` : `OK, Zeilen: ${count}`)
}
main().then(() => process.exit(0))
EOF
npx tsx /tmp/chk_taste_table.ts
```
Expected: `OK, Zeilen: 0`

- [ ] **Step 4: Commit**

```bash
cd ~/dev/synthszr && git add supabase/migrations/20260929120000_news_taste_features.sql && git commit -m "feat(news-taste): Tabelle news_taste_features fuer Jev-Feature-Vektoren

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Fragenkatalog + Vektor-Mapping (pure Logik)

**Files:**
- Create: `lib/news-taste/questions.ts`
- Create: `lib/news-taste/features.ts` (in diesem Task nur die puren Teile)
- Test: `tests/lib/news-taste-features.test.ts`

**Interfaces:**
- Consumes: Typen aus Task 1 (`EvaluateQuestion`, `EvaluateAnswer`).
- Produces:
  ```ts
  // questions.ts
  export const FEATURES_VERSION = 1
  export const TASTE_QUESTIONS: Record<string, EvaluateQuestion>
  export const STORY_TYPE_OPTIONS = ['launch', 'finance', 'research', 'policy', 'incident', 'opinion', 'meta', 'other'] as const
  export const JEV_FEATURE_NAMES: string[]   // kanonische Reihenfolge der Jev-Features
  export const EXTRA_FEATURE_NAMES: string[] // kanonische Reihenfolge der Zusatzsignale
  export const FEATURE_NAMES: string[]       // JEV_FEATURE_NAMES + EXTRA_FEATURE_NAMES

  // features.ts
  export interface TasteInput {
    queueItemId: string
    title: string
    source: string | null
    text: string | null          // excerpt, notfalls content-Anfang
    synthesis: number
    relevance: number
    uniqueness: number
    sourceBonus: number
    sourcePubRate: number
    contentLength: number
  }
  export function buildTasteState(input: Pick<TasteInput, 'title' | 'source' | 'text'>): string
  export function answersToVector(answers: Record<string, EvaluateAnswer>): Record<string, number>
  export function extraFeatures(input: TasteInput): Record<string, number>
  ```

- [ ] **Step 1: Fehlschlagenden Test schreiben**

```ts
// tests/lib/news-taste-features.test.ts
import { describe, it, expect } from 'vitest'
import { FEATURE_NAMES, JEV_FEATURE_NAMES, TASTE_QUESTIONS } from '@/lib/news-taste/questions'
import { buildTasteState, answersToVector, extraFeatures } from '@/lib/news-taste/features'
import type { EvaluateAnswer } from '@/lib/ai/evaluate'

describe('buildTasteState', () => {
  it('baut State aus Titel, Quelle und Text', () => {
    const s = buildTasteState({ title: 'GPT-6 launched', source: 'Techmeme', text: 'OpenAI shipped…' })
    expect(s).toContain('TITLE: GPT-6 launched')
    expect(s).toContain('SOURCE: Techmeme')
    expect(s).toContain('TEXT: OpenAI shipped…')
  })
  it('crasht nicht bei fehlender Quelle und leerem Text (Review Focus 1)', () => {
    const s = buildTasteState({ title: 'Nur Titel', source: null, text: null })
    expect(s).toContain('TITLE: Nur Titel')
    expect(s).not.toContain('null')
  })
  it('kürzt den Text auf 1500 Zeichen', () => {
    const s = buildTasteState({ title: 't', source: null, text: 'x'.repeat(5000) })
    expect(s.length).toBeLessThan(1700)
  })
})

describe('answersToVector', () => {
  const answers: Record<string, EvaluateAnswer> = {
    concrete_event: { type: 'boolean', probability: 0.9 },
    importance: { type: 'score', score: 3, probabilities: [0, 0, 0.2, 0.6, 0.2] },
    story_type: { type: 'choice', choice: 'launch', probabilities: { launch: 0.8, finance: 0.2 } },
  }
  it('mappt boolean → probability, score → normierter Wert + Streuung, choice → soft one-hot', () => {
    const v = answersToVector(answers)
    expect(v.concrete_event).toBeCloseTo(0.9)
    expect(v.importance).toBeCloseTo(3 / 4) // 5 Stufen → Skala 0..4
    expect(v.importance_spread).toBeGreaterThan(0)
    expect(v.story_launch).toBeCloseTo(0.8)
    expect(v.story_finance).toBeCloseTo(0.2)
    expect(v.story_other).toBe(0)
  })
  it('fehlende Antworten und unbekannte Optionen → 0, nie NaN (Review Focus 2)', () => {
    const v = answersToVector({ story_type: { type: 'choice', choice: 'weird', probabilities: { weird: 1 } } })
    for (const name of JEV_FEATURE_NAMES) {
      expect(Number.isFinite(v[name]), `${name} ist ${v[name]}`).toBe(true)
    }
    expect(v.concrete_event).toBe(0)
    expect(v.story_launch).toBe(0)
  })
  it('liefert exakt die JEV_FEATURE_NAMES als Schlüssel', () => {
    const v = answersToVector(answers)
    expect(Object.keys(v).sort()).toEqual([...JEV_FEATURE_NAMES].sort())
  })
})

describe('Katalog-Konsistenz', () => {
  it('FEATURE_NAMES = Jev-Features + Extras, ohne Duplikate', () => {
    expect(new Set(FEATURE_NAMES).size).toBe(FEATURE_NAMES.length)
    expect(FEATURE_NAMES.length).toBeGreaterThanOrEqual(35)
  })
  it('jede Boolean-Frage hat criteria (kalibrierte Ja/Nein-Definition)', () => {
    for (const [name, q] of Object.entries(TASTE_QUESTIONS)) {
      if (q.type === 'boolean') expect(q.criteria, name).toBeDefined()
    }
  })
})

describe('extraFeatures', () => {
  it('liefert die Zusatzsignale mit log-skalierter Länge', () => {
    const v = extraFeatures({
      queueItemId: 'x', title: 't', source: null, text: null,
      synthesis: 7, relevance: 8, uniqueness: 6, sourceBonus: 1, sourcePubRate: 0.3, contentLength: 3000,
    })
    expect(v.synthesis_score).toBe(7)
    expect(v.relevance_score).toBe(8)
    expect(v.uniqueness_score).toBe(6)
    expect(v.source_bonus).toBe(1)
    expect(v.source_pub_rate).toBe(0.3)
    expect(v.log_content_length).toBeCloseTo(Math.log10(3001))
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd ~/dev/synthszr && npx vitest run tests/lib/news-taste-features.test.ts`
Expected: FAIL („Cannot find module '@/lib/news-taste/questions'“)

- [ ] **Step 3: `questions.ts` implementieren**

```ts
// lib/news-taste/questions.ts
import type { EvaluateQuestion } from '@/lib/ai/evaluate'

/**
 * Der Fragenkatalog des News-Taste-Modells. Jede Frage wird von Jev je
 * Artikel EINMAL beantwortet (alle in einem Request); die Antworten sind die
 * Eingabe-Features des trainierten Klassifikators.
 *
 * FEATURES_VERSION bei JEDER inhaltlichen Änderung erhöhen: Training und
 * Inferenz müssen denselben Katalog sehen (predict.ts verweigert sonst den
 * Start), und gespeicherte Vektoren alter Versionen dürfen nicht einfließen.
 * Fragen auf Englisch — die Quellartikel sind es überwiegend auch.
 */
export const FEATURES_VERSION = 1

const b = (instructions: string, criteria: { true: string; false: string }): EvaluateQuestion =>
  ({ type: 'boolean', instructions, criteria })

export const STORY_TYPE_OPTIONS = ['launch', 'finance', 'research', 'policy', 'incident', 'opinion', 'meta', 'other'] as const

export const TASTE_QUESTIONS: Record<string, EvaluateQuestion> = {
  concrete_event: b('Does the text report a concrete news event — something that just happened?', {
    true: 'A dated, specific occurrence: an announcement, release, deal, incident, decision.',
    false: 'A tutorial, guide, opinion, evergreen explainer, or roundup without one central event.',
  }),
  product_launch: b('Does it announce a new product, feature, or service being launched or shipped?', {
    true: 'Something new is available or dated for release.',
    false: 'No launch; rumors without substance count as false.',
  }),
  model_release: b('Does it announce a new AI model, model version, or major benchmark result?', {
    true: 'A lab releases or updates a model, or publishes standout benchmark numbers.',
    false: 'AI is only mentioned; no model news.',
  }),
  corporate_move: b('Does it report a strategic company move?', {
    true: 'Acquisition, partnership, restructuring, market entry/exit, major executive change.',
    false: 'No strategic move by a company.',
  }),
  funding_financials: b('Does it report funding, valuation, earnings, or other financial results?', {
    true: 'Concrete money news: a round, IPO, revenue, guidance, valuation.',
    false: 'No financial news.',
  }),
  security_incident: b('Does it report a security incident, breach, exploit, or vulnerability?', {
    true: 'A concrete security event or disclosed vulnerability.',
    false: 'General security advice or nothing security-related.',
  }),
  research_breakthrough: b('Does it report a notable research result or scientific advance?', {
    true: 'A paper, study, or lab result with a substantive finding.',
    false: 'No research news.',
  }),
  regulation_policy: b('Does it report government regulation, policy, lawsuits, or geopolitics affecting tech?', {
    true: 'Laws, rulings, executive action, antitrust, export controls, major litigation.',
    false: 'No policy/legal dimension.',
  }),
  notable_statement: b('Does it center on a noteworthy statement or prediction by an influential tech figure?', {
    true: 'A quote, interview, or post by a well-known executive, researcher, or investor is the story.',
    false: 'No such statement, or it is peripheral.',
  }),
  big_player: b('Is a major AI/tech player central to the story?', {
    true: 'OpenAI, Anthropic, Google, Microsoft, Meta, Nvidia, Apple, Amazon, xAI, DeepSeek, or a comparable giant drives the story.',
    false: 'Only smaller or unnamed companies are central.',
  }),
  ai_core: b('Is artificial intelligence central to the story, not just mentioned?', {
    true: 'The story is about AI models, AI products, AI companies, or AI impact.',
    false: 'AI appears only in passing or not at all.',
  }),
  tutorial_or_guide: b('Is this primarily a tutorial, how-to, roadmap, guide, or listicle?', {
    true: 'Instructional or list-style content meant to teach or enumerate.',
    false: 'It reports news rather than instructing.',
  }),
  opinion_only: b('Is this primarily opinion or commentary without a new fact?', {
    true: 'A take, reflection, or argument with no fresh news in it.',
    false: 'It contains new factual reporting.',
  }),
  promo_or_ad: b('Is this primarily an advertisement, sponsor message, or self-promotion?', {
    true: 'Selling or promoting a product, course, event, or the newsletter itself.',
    false: 'Editorial content.',
  }),
  newsletter_boilerplate: b('Is this a newsletter section header, housekeeping note, or other boilerplate?', {
    true: 'Subscription pitches, table-of-contents fragments, greetings, footers.',
    false: 'A real article or news item.',
  }),
  aggregator_roundup: b('Is this a roundup of many small items rather than one story?', {
    true: 'A list of several unrelated links/briefs.',
    false: 'One coherent story.',
  }),
  business_relevance: b('Would this story matter to a business decision-maker thinking about AI strategy?', {
    true: 'It informs decisions about AI adoption, vendors, market shifts, or competition.',
    false: 'Hobbyist, niche-technical, or irrelevant to business decisions.',
  }),
  novelty: b('Does the story contain genuinely new information?', {
    true: 'A development that was not widely known before.',
    false: 'A rehash, follow-up without substance, or evergreen content.',
  }),
  controversy: b('Does the story involve conflict, drama, or a surprising turn?', {
    true: 'Disputes, backlash, firings, lawsuits, U-turns, rivalry.',
    false: 'Uncontroversial, expected news.',
  }),
  quantified: b('Does the story contain concrete numbers that anchor it?', {
    true: 'Money amounts, user counts, benchmark scores, percentages.',
    false: 'No meaningful numbers.',
  }),
  importance: {
    type: 'score',
    instructions: 'Rate how important this story is for a daily tech/AI/business newsletter aimed at decision-makers.',
    criteria: [
      'trivial: a niche note few readers would miss',
      'minor: worth a one-liner at most',
      'notable: solid candidate for a section',
      'major: one of the day\'s bigger stories',
      'front-page: the day\'s defining tech story',
    ],
  },
  depth: {
    type: 'score',
    instructions: 'Rate how much substance the text itself carries.',
    criteria: [
      'stub: headline with no substance',
      'thin: a short summary with little detail',
      'solid: a full report with context',
      'deep: analysis with data, quotes, or original reporting',
    ],
  },
  story_type: {
    type: 'choice',
    instructions: 'Classify the dominant type of this story.',
    criteria: {
      launch: 'product/model launch or release',
      finance: 'funding, earnings, valuation, markets',
      research: 'research results, papers, science',
      policy: 'regulation, lawsuits, geopolitics',
      incident: 'security incident, outage, failure',
      opinion: 'opinion, commentary, essay',
      meta: 'newsletter housekeeping, ads, boilerplate',
      other: 'none of the above',
    },
  },
}

const BOOLEAN_NAMES = Object.entries(TASTE_QUESTIONS)
  .filter(([, q]) => q.type === 'boolean')
  .map(([name]) => name)

export const JEV_FEATURE_NAMES: string[] = [
  ...BOOLEAN_NAMES,
  'importance', 'importance_spread',
  'depth', 'depth_spread',
  ...STORY_TYPE_OPTIONS.map((o) => `story_${o}`),
]

export const EXTRA_FEATURE_NAMES: string[] = [
  'synthesis_score', 'relevance_score', 'uniqueness_score',
  'source_bonus', 'source_pub_rate', 'log_content_length',
]

export const FEATURE_NAMES: string[] = [...JEV_FEATURE_NAMES, ...EXTRA_FEATURE_NAMES]
```

- [ ] **Step 4: `features.ts` (pure Teile) implementieren**

```ts
// lib/news-taste/features.ts
import type { EvaluateAnswer } from '@/lib/ai/evaluate'
import {
  TASTE_QUESTIONS, JEV_FEATURE_NAMES, STORY_TYPE_OPTIONS,
} from './questions'

/** Eingabe für State-Bau und Zusatzsignale — Felder kommen 1:1 aus news_queue. */
export interface TasteInput {
  queueItemId: string
  title: string
  source: string | null
  text: string | null
  synthesis: number
  relevance: number
  uniqueness: number
  sourceBonus: number
  sourcePubRate: number
  contentLength: number
}

const MAX_TEXT_CHARS = 1500

/** Der State, den Jev je Artikel sieht. Kompakt: Titel trägt am meisten. */
export function buildTasteState(input: Pick<TasteInput, 'title' | 'source' | 'text'>): string {
  const parts = [`TITLE: ${input.title}`]
  if (input.source) parts.push(`SOURCE: ${input.source}`)
  if (input.text) parts.push(`TEXT: ${input.text.slice(0, MAX_TEXT_CHARS)}`)
  return parts.join('\n')
}

const clamp01 = (n: unknown): number => {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : 0
  return Math.min(1, Math.max(0, x))
}

/**
 * Antworten → deterministischer Feature-Vektor mit EXAKT den
 * JEV_FEATURE_NAMES als Schlüsseln. Fehlende Antworten und unbekannte
 * Optionen werden 0 (nie NaN): der Vektor muss in Training und Runtime
 * identisch entstehen, sonst lernt das Modell Artefakte.
 */
export function answersToVector(answers: Record<string, EvaluateAnswer>): Record<string, number> {
  const v: Record<string, number> = {}
  for (const name of JEV_FEATURE_NAMES) v[name] = 0

  for (const [name, q] of Object.entries(TASTE_QUESTIONS)) {
    const a = answers[name]
    if (!a) continue
    if (q.type === 'boolean' && a.type === 'boolean') {
      v[name] = clamp01(a.probability)
    } else if (q.type === 'score' && a.type === 'score') {
      const levels = q.criteria.length
      // score liegt im Stufenindex-Raum 0..levels-1 (Live-Check Task 1) → 0..1
      v[name] = clamp01(a.score / (levels - 1))
      v[`${name}_spread`] = spreadOf(a.probabilities)
    } else if (q.type === 'choice' && a.type === 'choice') {
      for (const opt of STORY_TYPE_OPTIONS) {
        v[`story_${opt}`] = clamp01(a.probabilities?.[opt] ?? (a.choice === opt ? 1 : 0))
      }
    }
  }
  return v
}

/** Streuung einer Stufen-Verteilung (Std-Abw. im 0..1-normierten Indexraum). */
function spreadOf(probs: number[] | Record<string, number> | undefined): number {
  const arr = Array.isArray(probs) ? probs : probs ? Object.values(probs) : []
  if (arr.length < 2) return 0
  const denom = arr.length - 1
  let mean = 0
  arr.forEach((p, i) => { mean += clamp01(p) * (i / denom) })
  let variance = 0
  arr.forEach((p, i) => { variance += clamp01(p) * (i / denom - mean) ** 2 })
  return Math.sqrt(variance)
}

/** Zusatzsignale aus news_queue — kosten nichts, kommen NICHT von Jev. */
export function extraFeatures(input: TasteInput): Record<string, number> {
  const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)
  return {
    synthesis_score: num(input.synthesis),
    relevance_score: num(input.relevance),
    uniqueness_score: num(input.uniqueness),
    source_bonus: num(input.sourceBonus),
    source_pub_rate: num(input.sourcePubRate),
    log_content_length: Math.log10(Math.max(0, num(input.contentLength)) + 1),
  }
}
```

- [ ] **Step 5: Tests laufen lassen — müssen bestehen**

Run: `cd ~/dev/synthszr && npx vitest run tests/lib/news-taste-features.test.ts`
Expected: alle passed

- [ ] **Step 6: Typecheck + Commit**

```bash
cd ~/dev/synthszr && npm run typecheck && git add lib/news-taste tests/lib/news-taste-features.test.ts && git commit -m "feat(news-taste): Fragenkatalog v1 und deterministisches Vektor-Mapping

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Feature-Persistenz `getOrComputeFeatures`

**Files:**
- Modify: `lib/news-taste/features.ts` (Funktion anhängen)
- Test: `tests/lib/news-taste-get-or-compute.test.ts`

**Interfaces:**
- Consumes: `evaluateState` (Task 1), `buildTasteState`/`answersToVector` (Task 3), `createAdminClient`.
- Produces:
  ```ts
  export async function getOrComputeFeatures(
    items: TasteInput[],
    opts?: { concurrency?: number },
  ): Promise<{ features: Map<string, Record<string, number>>; failedIds: string[] }>
  ```
  `features` enthält NUR Jev-Features (Extras rechnen Aufrufer via `extraFeatures` selbst — sie kosten nichts und stehen in beiden Pfaden frisch zur Verfügung).

- [ ] **Step 1: Fehlschlagenden Test schreiben**

```ts
// tests/lib/news-taste-get-or-compute.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const upserted: unknown[] = []
let existingRows: Array<{ queue_item_id: string; features: Record<string, number> }> = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          in: async () => ({ data: existingRows, error: null }),
        }),
      }),
      upsert: async (rows: unknown) => { upserted.push(rows); return { error: null } },
    }),
  }),
}))

const evaluateMock = vi.fn()
vi.mock('@/lib/ai/evaluate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/evaluate')>()),
  evaluateState: (...args: unknown[]) => evaluateMock(...args),
}))

import { getOrComputeFeatures, type TasteInput } from '@/lib/news-taste/features'

const input = (id: string): TasteInput => ({
  queueItemId: id, title: `Titel ${id}`, source: 'S', text: 'Text',
  synthesis: 5, relevance: 5, uniqueness: 5, sourceBonus: 0, sourcePubRate: 0, contentLength: 1000,
})

beforeEach(() => { upserted.length = 0; existingRows = []; evaluateMock.mockReset() })

describe('getOrComputeFeatures', () => {
  it('nutzt gespeicherte Vektoren und berechnet nur fehlende (Review Focus 4: Lookup filtert Version)', async () => {
    existingRows = [{ queue_item_id: 'a', features: { concrete_event: 0.7 } }]
    evaluateMock.mockResolvedValue({
      answers: { concrete_event: { type: 'boolean', probability: 0.9 } },
      usage: { inputTokens: 100, outputTokens: 10 }, costUsd: 0.000004,
    })
    const res = await getOrComputeFeatures([input('a'), input('b')])
    expect(res.features.get('a')?.concrete_event).toBe(0.7) // aus DB, kein Call
    expect(res.features.get('b')?.concrete_event).toBe(0.9) // frisch berechnet
    expect(evaluateMock).toHaveBeenCalledTimes(1)
    expect(upserted.length).toBe(1) // nur b gespeichert
    expect(res.failedIds).toEqual([])
  })

  it('sammelt fehlgeschlagene Items in failedIds statt zu werfen', async () => {
    evaluateMock.mockRejectedValue(new Error('Gateway 503'))
    const res = await getOrComputeFeatures([input('a')])
    expect(res.features.size).toBe(0)
    expect(res.failedIds).toEqual(['a'])
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd ~/dev/synthszr && npx vitest run tests/lib/news-taste-get-or-compute.test.ts`
Expected: FAIL („getOrComputeFeatures is not a function“ o. ä.)

- [ ] **Step 3: Implementieren (an `features.ts` anhängen)**

```ts
// … an lib/news-taste/features.ts anhängen; oben ergänzen:
// import { createAdminClient } from '@/lib/supabase/admin'
// import { evaluateState, JEV_MODEL } from '@/lib/ai/evaluate'
// import { FEATURES_VERSION } from './questions'

const IN_CHUNK = 200 // Supabase-.in()-Listen klein halten

/**
 * Liefert Jev-Feature-Vektoren für die Items: erst Lookup in
 * news_taste_features (NUR aktuelle FEATURES_VERSION — alte Kataloge
 * erzeugen andere Vektoren), fehlende werden live berechnet und persistiert.
 * Fehler einzelner Items landen in failedIds; der Aufrufer entscheidet über
 * Fallback (Runtime) oder Protokoll (Backfill).
 */
export async function getOrComputeFeatures(
  items: TasteInput[],
  opts: { concurrency?: number } = {},
): Promise<{ features: Map<string, Record<string, number>>; failedIds: string[] }> {
  const supabase = createAdminClient()
  const features = new Map<string, Record<string, number>>()
  const failedIds: string[] = []

  const ids = items.map((i) => i.queueItemId)
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await supabase
      .from('news_taste_features')
      .select('queue_item_id, features')
      .eq('features_version', FEATURES_VERSION)
      .in('queue_item_id', ids.slice(i, i + IN_CHUNK))
    if (error) throw new Error(`Feature-Lookup fehlgeschlagen: ${error.message}`)
    for (const row of data ?? []) {
      features.set(row.queue_item_id as string, row.features as Record<string, number>)
    }
  }

  const missing = items.filter((i) => !features.has(i.queueItemId))
  if (missing.length === 0) return { features, failedIds }

  // Handgerollter Semaphor statt p-limit: eine Abhängigkeit weniger.
  const concurrency = Math.max(1, opts.concurrency ?? 10)
  let cursor = 0
  const worker = async () => {
    for (;;) {
      const idx = cursor++
      if (idx >= missing.length) return
      const item = missing[idx]
      try {
        const res = await evaluateState(buildTasteState(item), TASTE_QUESTIONS)
        const vector = answersToVector(res.answers)
        features.set(item.queueItemId, vector)
        const { error } = await supabase.from('news_taste_features').upsert({
          queue_item_id: item.queueItemId,
          features_version: FEATURES_VERSION,
          features: vector,
          model: JEV_MODEL,
          input_tokens: res.usage.inputTokens,
        }, { onConflict: 'queue_item_id,features_version' })
        if (error) console.warn('[NewsTaste] Vektor nicht gespeichert:', item.queueItemId, error.message)
      } catch (err) {
        console.warn('[NewsTaste] Features fehlgeschlagen:', item.queueItemId,
          err instanceof Error ? err.message : err)
        failedIds.push(item.queueItemId)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, worker))
  return { features, failedIds }
}
```

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**

Run: `cd ~/dev/synthszr && npx vitest run tests/lib/news-taste-get-or-compute.test.ts tests/lib/news-taste-features.test.ts`
Expected: alle passed

- [ ] **Step 5: Typecheck + Commit**

```bash
cd ~/dev/synthszr && npm run typecheck && git add lib/news-taste/features.ts tests/lib/news-taste-get-or-compute.test.ts && git commit -m "feat(news-taste): getOrComputeFeatures — Lookup, Live-Berechnung, Persistenz

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Backfill-Skript + Prod-Lauf

**Files:**
- Create: `scripts/backfill-taste-features.ts`
- Modify: `package.json` (Script `taste:backfill`)

**Interfaces:**
- Consumes: `getOrComputeFeatures`, `isJunkTitle` aus `@/lib/news-queue/service`.
- Produces: gefüllte `news_taste_features`-Tabelle für alle Kandidaten-Tage mit Ground Truth. Task 7 liest sie.

- [ ] **Step 1: Skript schreiben**

```ts
#!/usr/bin/env npx tsx
/**
 * Backfill der Jev-Feature-Vektoren für das News-Taste-Training.
 *
 * Umfang: alle news_queue-Items der Tage, an denen mindestens ein Item in
 * einem VERÖFFENTLICHTEN Post gelandet ist — gefiltert wie Stufe 1 des
 * Rankings (Junk-Titel raus, >= 500 Zeichen), damit Trainings- und
 * Laufzeitverteilung übereinstimmen. Idempotent: vorhandene Vektoren der
 * aktuellen FEATURES_VERSION werden übersprungen (getOrComputeFeatures).
 *
 * Lauf: npm run taste:backfill            (gegen ~/.synthszr.env.prod)
 * Kosten: ~2k Tokens/Item, erwartet 50–90k Items → ca. $5–10 einmalig.
 */
import { config } from 'dotenv'
import { existsSync } from 'node:fs'
const prodEnv = `${process.env.HOME}/.synthszr.env.prod`
config({ path: existsSync(prodEnv) ? prodEnv : '.env.local', quiet: true })

const MIN_CONTENT_LENGTH = 500 // wie ranking-service.ts
const BATCH = 500              // Items je DB-Page

async function main() {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { isJunkTitle } = await import('@/lib/news-queue/service')
  const { getOrComputeFeatures } = await import('@/lib/news-taste/features')
  const { extractQueueItemIds } = await import('./lib/taste-ground-truth')
  const supabase = createAdminClient()

  // 1) Ground-Truth-Tage: Tage (UTC, nach queued_at) der Items, die in
  //    veröffentlichten Posts stecken.
  const labeledIds = await collectLabeledIds(supabase, extractQueueItemIds)
  const days = new Set<string>()
  for (let i = 0; i < labeledIds.length; i += BATCH) {
    const { data } = await supabase.from('news_queue')
      .select('id, queued_at').in('id', labeledIds.slice(i, i + BATCH))
    for (const r of data ?? []) if (r.queued_at) days.add((r.queued_at as string).slice(0, 10))
  }
  console.log(`Ground Truth: ${labeledIds.length} Items an ${days.size} Tagen`)

  // 2) Je Tag die Kandidaten laden, filtern, Features sicherstellen.
  let done = 0, failed = 0
  const t0 = Date.now()
  for (const day of [...days].sort()) {
    const { data, error } = await supabase.from('news_queue')
      .select('id, title, excerpt, content, source_display_name, synthesis_score, relevance_score, uniqueness_score, source_bonus, source_pub_rate, content_length')
      .gte('queued_at', `${day}T00:00:00Z`).lt('queued_at', `${day}T23:59:59.999Z`)
      .limit(2000)
    if (error) { console.error(day, 'Laden fehlgeschlagen:', error.message); continue }
    const inputs = (data ?? [])
      .filter((r) => !isJunkTitle(r.title) && (r.content_length ?? 0) >= MIN_CONTENT_LENGTH)
      .map((r) => ({
        queueItemId: r.id as string,
        title: r.title as string,
        source: (r.source_display_name as string) ?? null,
        text: ((r.excerpt as string) || (r.content as string) || '').slice(0, 1500) || null,
        synthesis: Number(r.synthesis_score) || 0,
        relevance: Number(r.relevance_score) || 0,
        uniqueness: Number(r.uniqueness_score) || 0,
        sourceBonus: Number(r.source_bonus) || 0,
        sourcePubRate: Number(r.source_pub_rate) || 0,
        contentLength: Number(r.content_length) || 0,
      }))
    const res = await getOrComputeFeatures(inputs, { concurrency: 10 })
    done += res.features.size
    failed += res.failedIds.length
    const mins = ((Date.now() - t0) / 60000).toFixed(1)
    console.log(`${day}: ${inputs.length} Kandidaten, kumuliert ${done} ok / ${failed} Fehler (${mins} min)`)
  }
  console.log(`FERTIG: ${done} Vektoren, ${failed} Fehler. Kosten: siehe llm_usage use_case='news_taste_features'.`)
  if (failed > done * 0.05) console.warn('WARNUNG: Fehlquote > 5% — Log prüfen, ggf. erneut laufen lassen (idempotent).')
}

async function collectLabeledIds(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>>,
  extractQueueItemIds: (content: unknown) => string[],
): Promise<string[]> {
  const ids = new Set<string>()
  const PAGE = 200
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.from('generated_posts')
      .select('content').eq('status', 'published')
      .order('created_at', { ascending: true }).range(offset, offset + PAGE - 1)
    if (error) throw new Error(`generated_posts: ${error.message}`)
    if (!data || data.length === 0) break
    for (const p of data) for (const id of extractQueueItemIds(p.content)) ids.add(id)
    if (data.length < PAGE) break
  }
  return [...ids]
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Geteilte Ground-Truth-Extraktion anlegen**

`extractQueueItemIds` brauchen Backfill (Task 5), Baseline (Task 6) und Export (Task 7) identisch — als geteiltes Modul, Logik aus `scripts/backtest-scoring.ts:146-160` übernommen:

```ts
// scripts/lib/taste-ground-truth.ts
/**
 * queueItemId-Attribute aus TipTap-JSON veröffentlichter Posts ziehen —
 * die Ground Truth des News-Taste-Modells (gleiche Quelle wie
 * scripts/backtest-scoring.ts: Heading-Nodes tragen die Herkunfts-IDs).
 */
export function extractQueueItemIds(content: unknown): string[] {
  const ids: string[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; attrs?: { queueItemId?: string }; content?: unknown[] }
    if (n.type === 'heading' && n.attrs?.queueItemId) ids.push(n.attrs.queueItemId)
    if (Array.isArray(n.content)) n.content.forEach(walk)
  }
  const root = typeof content === 'string' ? safeParse(content) : content
  walk(root)
  return [...new Set(ids)]
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}
```

- [ ] **Step 3: npm-Script ergänzen**

In `package.json` unter `"scripts"`:

```json
"taste:backfill": "tsx scripts/backfill-taste-features.ts",
```

- [ ] **Step 4: Probelauf-Verifikation (ein Tag)**

Vor dem Volllauf mit einer temporären Begrenzung prüfen: in `main()` nach dem Sortieren testweise `[...days].sort().slice(0, 1)` verwenden, Skript laufen lassen, dann zurückbauen.

Run: `cd ~/dev/synthszr && npm run taste:backfill`
Expected: Ein Tag verarbeitet, `ok`-Zähler > 0, Fehler 0–2. Danach in Supabase prüfen: `news_taste_features` hat Zeilen mit `features_version = 1` und ~32 Schlüsseln im `features`-JSON.

- [ ] **Step 5: Volllauf im Hintergrund**

Run (Hintergrund, ~1,5–2,5 h): `cd ~/dev/synthszr && npm run taste:backfill 2>&1 | tee /tmp/taste-backfill.log`
Expected: `FERTIG: <50k–90k> Vektoren`, Fehlquote < 5 %. Kostenkontrolle: Summe in `llm_usage` (`use_case='news_taste_features'`) ≤ $10.

- [ ] **Step 6: Commit**

```bash
cd ~/dev/synthszr && git add scripts/backfill-taste-features.ts scripts/lib/taste-ground-truth.ts package.json && git commit -m "feat(news-taste): Backfill-Skript fuer Jev-Feature-Vektoren (Ground-Truth-Tage)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Reranker-Baseline messen

**Files:**
- Create: `scripts/measure-reranker-baseline.ts`
- Modify: `package.json` (Script `taste:baseline`)

**Interfaces:**
- Consumes: `recallAtK`, `ndcgAtK` aus `@/lib/news-queue/metrics`; `extractQueueItemIds` aus Task 5.
- Produces: `scripts/reranker-baseline.json` — die Messlatte für das Gate (Task 9-Report zitiert sie).

- [ ] **Step 1: Skript schreiben**

```ts
#!/usr/bin/env npx tsx
/**
 * Gemessene Trefferquote des BISHERIGEN LLM-Rerankers — die Messlatte des
 * News-Taste-Modells (Spec: „Gate").
 *
 * Je ranking_run: die Vorschläge (nach suggested_rank) als Ranking, relevant
 * sind die Queue-Items, die in einem binnen 48 h NACH dem Lauf
 * veröffentlichten Post gelandet sind. 48 h ist eine bewusste Näherung: der
 * Lauf morgens speist den Post desselben/nächsten Tages.
 */
import { config } from 'dotenv'
import { existsSync, writeFileSync } from 'node:fs'
const prodEnv = `${process.env.HOME}/.synthszr.env.prod`
config({ path: existsSync(prodEnv) ? prodEnv : '.env.local', quiet: true })

async function main() {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { recallAtK, ndcgAtK } = await import('@/lib/news-queue/metrics')
  const { extractQueueItemIds } = await import('./lib/taste-ground-truth')
  const supabase = createAdminClient()

  const { data: posts } = await supabase.from('generated_posts')
    .select('content, created_at').eq('status', 'published')
    .order('created_at', { ascending: true }).limit(2000)
  const published: Array<{ at: number; ids: string[] }> = (posts ?? []).map((p) => ({
    at: new Date(p.created_at as string).getTime(),
    ids: extractQueueItemIds(p.content),
  }))

  const { data: runs } = await supabase.from('ranking_runs')
    .select('id, created_at, model').order('created_at', { ascending: true })
  const perRun: Array<{ runId: string; day: string; n: number; r10: number; r15: number; ndcg15: number }> = []
  for (const run of runs ?? []) {
    const { data: sugg } = await supabase.from('ranking_suggestions')
      .select('queue_item_id, suggested_rank').eq('run_id', run.id)
      .order('suggested_rank', { ascending: true })
    const ranked = (sugg ?? []).map((s) => s.queue_item_id as string)
    if (ranked.length === 0) continue
    const t = new Date(run.created_at as string).getTime()
    const relevant = new Set<string>()
    for (const p of published) {
      if (p.at >= t && p.at <= t + 48 * 3600 * 1000) p.ids.forEach((id) => relevant.add(id))
    }
    if (relevant.size === 0) continue
    perRun.push({
      runId: run.id as string,
      day: (run.created_at as string).slice(0, 10),
      n: relevant.size,
      r10: recallAtK(ranked, relevant, 10),
      r15: recallAtK(ranked, relevant, 15),
      ndcg15: ndcgAtK(ranked, relevant, 15),
    })
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const summary = {
    generated_at: new Date().toISOString(),
    runs_measured: perRun.length,
    mean_recall_at_10: mean(perRun.map((r) => r.r10)),
    mean_recall_at_15: mean(perRun.map((r) => r.r15)),
    mean_ndcg_at_15: mean(perRun.map((r) => r.ndcg15)),
    note: 'relevant = queueItemIds in Posts, veröffentlicht binnen 48h nach dem Lauf',
    per_run: perRun,
  }
  writeFileSync('scripts/reranker-baseline.json', JSON.stringify(summary, null, 1))
  console.table({
    runs: summary.runs_measured,
    'Recall@10': summary.mean_recall_at_10.toFixed(3),
    'Recall@15': summary.mean_recall_at_15.toFixed(3),
    'NDCG@15': summary.mean_ndcg_at_15.toFixed(3),
  })
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: npm-Script ergänzen**

```json
"taste:baseline": "tsx scripts/measure-reranker-baseline.ts",
```

- [ ] **Step 3: Laufen lassen**

Run: `cd ~/dev/synthszr && npm run taste:baseline`
Expected: Tabelle mit `runs` (Größenordnung ≤ 134 — Läufe ohne Folge-Post fallen raus) und den drei Mittelwerten; `scripts/reranker-baseline.json` existiert.

- [ ] **Step 4: Commit (Report eingeschlossen — er ist die dokumentierte Messlatte)**

```bash
cd ~/dev/synthszr && git add scripts/measure-reranker-baseline.ts scripts/reranker-baseline.json package.json && git commit -m "feat(news-taste): gemessene Reranker-Baseline als Messlatte

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Dataset-Export

**Files:**
- Create: `scripts/export-taste-dataset.ts`
- Modify: `package.json` (Script `taste:export`)

**Interfaces:**
- Consumes: `FEATURE_NAMES`, `EXTRA_FEATURE_NAMES` (Task 3), `extraFeatures` (Task 3), `extractQueueItemIds` (Task 5), Tabelle aus Task 2.
- Produces: `scripts/taste-dataset.json` mit exakt dieser Struktur (Task 8 liest sie):
  ```json
  {
    "feature_names": ["concrete_event", "…", "log_content_length"],
    "days": [
      { "day": "2026-03-01", "items": [ { "id": "uuid", "label": true, "x": [0.93, 0.1] } ] }
    ]
  }
  ```
  `x` ist parallel zu `feature_names`.

- [ ] **Step 1: Skript schreiben**

```ts
#!/usr/bin/env npx tsx
/**
 * Exportiert das Trainings-Dataset des News-Taste-Modells nach
 * scripts/taste-dataset.json. Python (train_news_taste.py) bekommt NUR diese
 * Datei — keine Supabase-Credentials im Trainingsteil.
 *
 * Ein Tag kommt ins Dataset, wenn er >= 1 Positiv MIT Feature-Vektor und
 * >= 15 Kandidaten hat (sonst ist Ranking-Bewertung sinnlos). Items ohne
 * Vektor (Backfill-Fehlschläge) werden übersprungen und gezählt.
 */
import { config } from 'dotenv'
import { existsSync, writeFileSync } from 'node:fs'
const prodEnv = `${process.env.HOME}/.synthszr.env.prod`
config({ path: existsSync(prodEnv) ? prodEnv : '.env.local', quiet: true })

const MIN_CONTENT_LENGTH = 500
const MIN_CANDIDATES = 15

async function main() {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { isJunkTitle } = await import('@/lib/news-queue/service')
  const { FEATURE_NAMES, FEATURES_VERSION } = await import('@/lib/news-taste/questions')
  const { extraFeatures } = await import('@/lib/news-taste/features')
  const { extractQueueItemIds } = await import('./lib/taste-ground-truth')
  const supabase = createAdminClient()

  // Labels + Tage (gleiche Logik wie Backfill Task 5)
  const labeled = new Set<string>()
  for (let offset = 0; ; offset += 200) {
    const { data } = await supabase.from('generated_posts')
      .select('content').eq('status', 'published')
      .order('created_at', { ascending: true }).range(offset, offset + 199)
    if (!data || data.length === 0) break
    for (const p of data) for (const id of extractQueueItemIds(p.content)) labeled.add(id)
    if (data.length < 200) break
  }
  const days = new Set<string>()
  const labeledIds = [...labeled]
  for (let i = 0; i < labeledIds.length; i += 500) {
    const { data } = await supabase.from('news_queue')
      .select('queued_at').in('id', labeledIds.slice(i, i + 500))
    for (const r of data ?? []) if (r.queued_at) days.add((r.queued_at as string).slice(0, 10))
  }

  const out: { feature_names: string[]; days: Array<{ day: string; items: Array<{ id: string; label: boolean; x: number[] }> }> } = {
    feature_names: FEATURE_NAMES, days: [],
  }
  let skippedNoVector = 0
  for (const day of [...days].sort()) {
    const { data } = await supabase.from('news_queue')
      .select('id, title, excerpt, source_display_name, synthesis_score, relevance_score, uniqueness_score, source_bonus, source_pub_rate, content_length')
      .gte('queued_at', `${day}T00:00:00Z`).lt('queued_at', `${day}T23:59:59.999Z`).limit(2000)
    const rows = (data ?? []).filter((r) => !isJunkTitle(r.title) && (r.content_length ?? 0) >= MIN_CONTENT_LENGTH)
    if (rows.length < MIN_CANDIDATES) continue

    const ids = rows.map((r) => r.id as string)
    const vectors = new Map<string, Record<string, number>>()
    for (let i = 0; i < ids.length; i += 200) {
      const { data: feats } = await supabase.from('news_taste_features')
        .select('queue_item_id, features').eq('features_version', FEATURES_VERSION)
        .in('queue_item_id', ids.slice(i, i + 200))
      for (const f of feats ?? []) vectors.set(f.queue_item_id as string, f.features as Record<string, number>)
    }

    const items: Array<{ id: string; label: boolean; x: number[] }> = []
    for (const r of rows) {
      const jev = vectors.get(r.id as string)
      if (!jev) { skippedNoVector++; continue }
      const extra = extraFeatures({
        queueItemId: r.id as string, title: r.title as string, source: null, text: null,
        synthesis: Number(r.synthesis_score) || 0, relevance: Number(r.relevance_score) || 0,
        uniqueness: Number(r.uniqueness_score) || 0, sourceBonus: Number(r.source_bonus) || 0,
        sourcePubRate: Number(r.source_pub_rate) || 0, contentLength: Number(r.content_length) || 0,
      })
      const merged: Record<string, number> = { ...jev, ...extra }
      items.push({
        id: r.id as string,
        label: labeled.has(r.id as string),
        x: FEATURE_NAMES.map((n) => (Number.isFinite(merged[n]) ? merged[n] : 0)),
      })
    }
    if (items.some((i) => i.label) && items.length >= MIN_CANDIDATES) out.days.push({ day, items })
  }

  writeFileSync('scripts/taste-dataset.json', JSON.stringify(out))
  const total = out.days.reduce((a, d) => a + d.items.length, 0)
  const positives = out.days.reduce((a, d) => a + d.items.filter((i) => i.label).length, 0)
  console.log(`Dataset: ${out.days.length} Tage, ${total} Items, ${positives} Positive, ${skippedNoVector} ohne Vektor übersprungen`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: npm-Script ergänzen**

```json
"taste:export": "tsx scripts/export-taste-dataset.ts",
```

- [ ] **Step 3: Laufen lassen und plausibilisieren**

Run: `cd ~/dev/synthszr && npm run taste:export`
Expected: ~180–240 Tage, fünfstellige Item-Zahl, Positive in der Größenordnung 1.500–6.500, „ohne Vektor" < 5 % der Items. `scripts/taste-dataset.json` NICHT committen (mehrere MB, reproduzierbar) — in `.gitignore` aufnehmen.

- [ ] **Step 4: Commit**

```bash
cd ~/dev/synthszr && printf 'scripts/taste-dataset.json\n' >> .gitignore && git add scripts/export-taste-dataset.ts package.json .gitignore && git commit -m "feat(news-taste): Dataset-Export fuer das Training

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Training + Artefakt + Report

**Files:**
- Create: `scripts/train_news_taste.py`
- Create (durch Lauf): `lib/news-taste/model.json`, `scripts/taste-train-report.json`
- Modify: `package.json` (Script `taste:train`)

**Interfaces:**
- Consumes: `scripts/taste-dataset.json` (Task 7), `scripts/reranker-baseline.json` (Task 6).
- Produces: `lib/news-taste/model.json` mit exakt diesem Schema (Task 9 liest es):
  ```json
  {
    "features_version": 1,
    "model_type": "logreg",
    "feature_names": ["…"],
    "trained_at": "2026-09-29T…",
    "train_days": 180, "test_days": 45,
    "metrics": { "recall_at_10": 0.0, "recall_at_15": 0.0, "ndcg_at_15": 0.0 },
    "logreg": { "weights": [0.0], "bias": 0.0, "means": [0.0], "stds": [1.0] },
    "lightgbm": null
  }
  ```
  Bei LightGBM-Sieg: `"model_type": "lightgbm"`, `"logreg": null`, `"lightgbm": { "trees": [<tree_structure-Knoten aus dump_model()>] }`.

- [ ] **Step 1: Trainingsskript schreiben**

```python
# /// script
# requires-python = ">=3.11"
# dependencies = ["scikit-learn>=1.4", "lightgbm>=4.3", "numpy>=1.26"]
# ///
"""News-Taste-Training: LR vs. LightGBM auf dem Jev-Feature-Dataset.

Temporaler Split (aelteste 80% der Tage = Training, juengste 20% = Test),
Bewertung PRO TAG als Ranking (Recall@10/15, NDCG@15 — Formeln identisch zu
lib/news-queue/metrics.ts). Gewinner nach NDCG@15; bei < 0.01 Differenz
gewinnt die logistische Regression (einfacheres Artefakt).

Lauf: npm run taste:train   (uv run scripts/train_news_taste.py)
"""
import json, math, datetime
from pathlib import Path

import numpy as np
from lightgbm import LGBMClassifier
from sklearn.linear_model import LogisticRegression

ROOT = Path(__file__).resolve().parent
DATASET = ROOT / "taste-dataset.json"
BASELINE = ROOT / "reranker-baseline.json"
ARTIFACT = ROOT.parent / "lib" / "news-taste" / "model.json"
REPORT = ROOT / "taste-train-report.json"
FEATURES_VERSION = 1  # muss lib/news-taste/questions.ts entsprechen


def recall_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    if not relevant:
        return 0.0
    return sum(1 for i in ranked[:k] if i in relevant) / len(relevant)


def ndcg_at_k(ranked: list[str], relevant: set[str], k: int) -> float:
    dcg = sum(1 / math.log2(i + 2) for i, x in enumerate(ranked[:k]) if x in relevant)
    ideal = min(len(relevant), k)
    idcg = sum(1 / math.log2(i + 2) for i in range(ideal))
    return dcg / idcg if idcg else 0.0


def rank_days(days, score_fn) -> dict:
    r10, r15, ndcg = [], [], []
    for d in days:
        ids = [it["id"] for it in d["items"]]
        scores = score_fn(np.array([it["x"] for it in d["items"]], dtype=float))
        order = [ids[i] for i in np.argsort(-scores)]
        rel = {it["id"] for it in d["items"] if it["label"]}
        r10.append(recall_at_k(order, rel, 10))
        r15.append(recall_at_k(order, rel, 15))
        ndcg.append(ndcg_at_k(order, rel, 15))
    return {
        "recall_at_10": float(np.mean(r10)),
        "recall_at_15": float(np.mean(r15)),
        "ndcg_at_15": float(np.mean(ndcg)),
    }


def main() -> None:
    data = json.loads(DATASET.read_text())
    names, days = data["feature_names"], data["days"]
    days.sort(key=lambda d: d["day"])
    cut = int(len(days) * 0.8)
    train_days, test_days = days[:cut], days[cut:]
    X = np.array([it["x"] for d in train_days for it in d["items"]], dtype=float)
    y = np.array([1 if it["label"] else 0 for d in train_days for it in d["items"]])
    print(f"Train: {len(train_days)} Tage / {len(X)} Items ({y.sum()} pos) — Test: {len(test_days)} Tage")

    # Logistische Regression auf standardisierten Features. class_weight
    # balanced: ~5% Positive, sonst lernt sie nur die Mehrheitsklasse.
    means, stds = X.mean(axis=0), X.std(axis=0)
    stds[stds == 0] = 1.0
    lr = LogisticRegression(max_iter=2000, C=1.0, class_weight="balanced")
    lr.fit((X - means) / stds, y)

    lgbm = LGBMClassifier(
        n_estimators=300, learning_rate=0.05, num_leaves=31,
        min_child_samples=20, class_weight="balanced", random_state=0, verbose=-1,
    )
    lgbm.fit(X, y)

    lr_m = rank_days(test_days, lambda A: lr.decision_function((A - means) / stds))
    gb_m = rank_days(test_days, lambda A: lgbm.predict_proba(A)[:, 1])
    # Baseline: die alte total_score-Formel aus den Extra-Features rekonstruiert.
    i_syn, i_rel, i_unq = names.index("synthesis_score"), names.index("relevance_score"), names.index("uniqueness_score")
    i_bon = names.index("source_bonus")
    base_m = rank_days(test_days, lambda A: 0.4 * A[:, i_syn] + 0.3 * A[:, i_rel] + 0.3 * A[:, i_unq] + A[:, i_bon])

    winner = "logreg" if lr_m["ndcg_at_15"] >= gb_m["ndcg_at_15"] - 0.01 else "lightgbm"
    metrics = lr_m if winner == "logreg" else gb_m

    artifact = {
        "features_version": FEATURES_VERSION,
        "model_type": winner,
        "feature_names": names,
        "trained_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "train_days": len(train_days), "test_days": len(test_days),
        "metrics": metrics,
        "logreg": None, "lightgbm": None,
    }
    if winner == "logreg":
        artifact["logreg"] = {
            "weights": [float(w / s) for w, s in zip(lr.coef_[0], stds)],  # entstandardisiert …
            "bias": float(lr.intercept_[0] - float(np.dot(lr.coef_[0], means / stds))),  # … Bias angepasst
            "means": [0.0] * len(names), "stds": [1.0] * len(names),  # TS rechnet dann roh
        }
    else:
        dump = lgbm.booster_.dump_model()
        artifact["lightgbm"] = {"trees": [t["tree_structure"] for t in dump["tree_info"]]}

    ARTIFACT.write_text(json.dumps(artifact))
    baseline = json.loads(BASELINE.read_text()) if BASELINE.exists() else {}
    report = {
        "winner": winner,
        "logreg": lr_m, "lightgbm": gb_m, "total_score_baseline": base_m,
        "reranker_baseline": {k: baseline.get(k) for k in ("runs_measured", "mean_recall_at_10", "mean_recall_at_15", "mean_ndcg_at_15")},
        "top_weights": sorted(zip(names, [float(w) for w in lr.coef_[0]]), key=lambda t: -abs(t[1]))[:12],
    }
    REPORT.write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1)[:2000])


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: npm-Script ergänzen**

```json
"taste:train": "uv run scripts/train_news_taste.py",
```

- [ ] **Step 3: Training laufen lassen**

Run: `cd ~/dev/synthszr && npm run taste:train`
Expected: Konsolen-Report mit Metriken für logreg / lightgbm / total_score-Baseline / Reranker-Baseline; `lib/news-taste/model.json` und `scripts/taste-train-report.json` existieren. Plausibilität: beide Modelle deutlich über der total_score-Baseline; `top_weights` inhaltlich sinnvoll (z. B. `tutorial_or_guide` negativ, `importance` positiv). Sanity-Check des LR-Exports: ein Beispielvektor per Hand nachgerechnet (Python `predict_proba` vs. Skalarprodukt+Sigmoid mit exportierten Gewichten) muss übereinstimmen.

- [ ] **Step 4: Commit**

```bash
cd ~/dev/synthszr && git add scripts/train_news_taste.py lib/news-taste/model.json scripts/taste-train-report.json package.json && git commit -m "feat(news-taste): Training LR vs. LightGBM, Artefakt v1 + Metrik-Report

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: 🛑 GATE — Report dem Betreiber vorlegen**

Dem Betreiber die Kernzahlen zeigen: Gewinner-Modell, Recall@10/15 und NDCG@15 auf den Test-Tagen, daneben total_score-Baseline und gemessene Reranker-Baseline. **Erst nach seiner Freigabe mit Task 9–11 fortfahren.** Liegt das Modell UNTER der Reranker-Baseline: Befund vorlegen und Optionen nennen (Fragenkatalog iterieren = FEATURES_VERSION 2, trotzdem umschalten, abbrechen) — nicht selbst entscheiden.

---

### Task 9: TS-Inferenz `predict.ts`

**Files:**
- Create: `lib/news-taste/predict.ts`
- Test: `tests/lib/news-taste-predict.test.ts`

**Interfaces:**
- Consumes: `lib/news-taste/model.json` (Task 8), `FEATURES_VERSION`/`FEATURE_NAMES` (Task 3).
- Produces:
  ```ts
  export interface TasteModelArtifact {
    features_version: number
    model_type: 'logreg' | 'lightgbm'
    feature_names: string[]
    trained_at: string
    metrics: { recall_at_10: number; recall_at_15: number; ndcg_at_15: number }
    logreg: { weights: number[]; bias: number; means: number[]; stds: number[] } | null
    lightgbm: { trees: LgbmNode[] } | null
  }
  export function loadTasteModel(): TasteModelArtifact           // wirft bei Versions-Drift
  export function predictTasteScore(features: Record<string, number>, m: TasteModelArtifact): number  // 0..1
  ```

- [ ] **Step 1: Fehlschlagenden Test schreiben**

```ts
// tests/lib/news-taste-predict.test.ts
import { describe, it, expect } from 'vitest'
import { loadTasteModel, predictTasteScore, type TasteModelArtifact } from '@/lib/news-taste/predict'
import { FEATURES_VERSION } from '@/lib/news-taste/questions'

const logregFixture: TasteModelArtifact = {
  features_version: FEATURES_VERSION,
  model_type: 'logreg',
  feature_names: ['a', 'b'],
  trained_at: '2026-09-29',
  metrics: { recall_at_10: 0, recall_at_15: 0, ndcg_at_15: 0 },
  logreg: { weights: [2, -1], bias: 0.5, means: [0, 0], stds: [1, 1] },
  lightgbm: null,
}

describe('predictTasteScore (logreg)', () => {
  it('rechnet Sigmoid(w·x + b)', () => {
    // 2*1 + (-1)*0.5 + 0.5 = 2 → sigmoid(2) ≈ 0.8808
    expect(predictTasteScore({ a: 1, b: 0.5 }, logregFixture)).toBeCloseTo(0.8808, 3)
  })
  it('fehlende Features zählen als 0', () => {
    expect(predictTasteScore({}, logregFixture)).toBeCloseTo(1 / (1 + Math.exp(-0.5)), 4)
  })
})

describe('predictTasteScore (lightgbm)', () => {
  const gbmFixture: TasteModelArtifact = {
    ...logregFixture,
    model_type: 'lightgbm',
    logreg: null,
    lightgbm: {
      trees: [{
        split_feature: 0, threshold: 0.5, decision_type: '<=',
        left_child: { leaf_value: -1 }, right_child: { leaf_value: 2 },
      }],
    },
  }
  it('läuft den Baum: a<=0.5 → links, sonst rechts, dann Sigmoid', () => {
    expect(predictTasteScore({ a: 0.2 }, gbmFixture)).toBeCloseTo(1 / (1 + Math.exp(1)), 4)
    expect(predictTasteScore({ a: 0.9 }, gbmFixture)).toBeCloseTo(1 / (1 + Math.exp(-2)), 4)
  })
})

describe('loadTasteModel', () => {
  it('liefert das eingebettete Artefakt mit passender features_version (Review Focus 4)', () => {
    const m = loadTasteModel()
    expect(m.features_version).toBe(FEATURES_VERSION)
    expect(['logreg', 'lightgbm']).toContain(m.model_type)
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd ~/dev/synthszr && npx vitest run tests/lib/news-taste-predict.test.ts`
Expected: FAIL („Cannot find module '@/lib/news-taste/predict'“)

- [ ] **Step 3: Implementieren**

```ts
// lib/news-taste/predict.ts
import artifactJson from './model.json'
import { FEATURES_VERSION } from './questions'

/**
 * Pure TS-Inferenz über das in Python trainierte Artefakt (model.json).
 * Kein Python in Prod: LR ist Skalarprodukt+Sigmoid, LightGBM ein Walker
 * über die per dump_model() exportierten Bäume.
 */
export interface LgbmNode {
  split_feature?: number
  threshold?: number
  decision_type?: string
  left_child?: LgbmNode
  right_child?: LgbmNode
  leaf_value?: number
}

export interface TasteModelArtifact {
  features_version: number
  model_type: 'logreg' | 'lightgbm'
  feature_names: string[]
  trained_at: string
  metrics: { recall_at_10: number; recall_at_15: number; ndcg_at_15: number }
  logreg: { weights: number[]; bias: number; means: number[]; stds: number[] } | null
  lightgbm: { trees: LgbmNode[] } | null
}

/**
 * Lädt das eingebettete Artefakt und verweigert bei Versions-Drift den
 * Dienst: ein Katalog-Update ohne Retrain würde sonst leise falsche Scores
 * liefern (Review-Fokus der Spec).
 */
export function loadTasteModel(): TasteModelArtifact {
  const m = artifactJson as unknown as TasteModelArtifact
  if (m.features_version !== FEATURES_VERSION) {
    throw new Error(
      `Taste-Artefakt (features_version ${m.features_version}) passt nicht zum Fragenkatalog ` +
      `(${FEATURES_VERSION}) — erst npm run taste:backfill/export/train, dann deployen.`,
    )
  }
  return m
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

export function predictTasteScore(features: Record<string, number>, m: TasteModelArtifact): number {
  const x = m.feature_names.map((n) => (Number.isFinite(features[n]) ? features[n] : 0))
  if (m.model_type === 'logreg') {
    if (!m.logreg) throw new Error('Artefakt: model_type logreg ohne logreg-Block')
    const { weights, bias, means, stds } = m.logreg
    let z = bias
    for (let i = 0; i < weights.length; i++) z += weights[i] * ((x[i] - means[i]) / (stds[i] || 1))
    return sigmoid(z)
  }
  if (!m.lightgbm) throw new Error('Artefakt: model_type lightgbm ohne lightgbm-Block')
  let raw = 0
  for (const tree of m.lightgbm.trees) raw += walkTree(tree, x)
  return sigmoid(raw)
}

function walkTree(node: LgbmNode, x: number[]): number {
  if (node.leaf_value !== undefined && node.left_child === undefined) return node.leaf_value
  const value = x[node.split_feature ?? 0] ?? 0
  // LightGBM-Default '<=': links bei value <= threshold. Andere decision_types
  // (Kategorien) entstehen bei rein numerischen Features nicht.
  const goLeft = value <= (node.threshold ?? 0)
  const next = goLeft ? node.left_child : node.right_child
  return next ? walkTree(next, x) : 0
}
```

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**

Run: `cd ~/dev/synthszr && npx vitest run tests/lib/news-taste-predict.test.ts`
Expected: alle passed

- [ ] **Step 5: Typecheck + Commit**

```bash
cd ~/dev/synthszr && npm run typecheck && git add lib/news-taste/predict.ts tests/lib/news-taste-predict.test.ts && git commit -m "feat(news-taste): TS-Inferenz ueber das Trainings-Artefakt

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Runtime-Umbau `generateRankingSuggestions()` — ⚠️ NUR NACH GATE-FREIGABE (Task 8 Step 5)

**Files:**
- Modify: `lib/news-queue/ranking-service.ts`
- Test: `tests/lib/news-taste-ranking-service.test.ts`

**Interfaces:**
- Consumes: `getOrComputeFeatures`/`extraFeatures`/`TasteInput` (Task 3/4), `loadTasteModel`/`predictTasteScore` (Task 9), `dedupeByTopic` aus `@/lib/news-queue/semantic-dedup`, `createRun`/`recordSuggestions` aus `./suggestions` (unverändert).
- Produces: `generateRankingSuggestions(): Promise<RankingResult>` — Signatur und Rückgabeform EXAKT wie bisher (Route und Cron bleiben unangetastet).

- [ ] **Step 1: Fehlschlagenden Test schreiben**

```ts
// tests/lib/news-taste-ranking-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const queueRows = Array.from({ length: 6 }, (_, i) => ({
  id: `id${i}`, title: `Artikel ${i}`, excerpt: 'E', source_display_name: 'S',
  total_score: 9 - i, email_received_at: '2026-09-29T05:00:00Z', queued_at: '2026-09-29T05:00:00Z',
  content_length: 1000, synthesis_score: 5, relevance_score: 5, uniqueness_score: 5,
  source_bonus: 0, source_pub_rate: 0,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ gt: () => ({ gte: () => ({ order: () => ({ limit: async () => ({ data: queueRows }) }) }) }) }),
      }),
    }),
  }),
}))
vi.mock('@/lib/news-queue/service', () => ({ isJunkTitle: () => false }))

const featuresMock = vi.fn()
vi.mock('@/lib/news-taste/features', async (orig) => ({
  ...(await orig<typeof import('@/lib/news-taste/features')>()),
  getOrComputeFeatures: (...a: unknown[]) => featuresMock(...a),
}))
vi.mock('@/lib/news-taste/predict', () => ({
  loadTasteModel: () => ({ features_version: 1, model_type: 'logreg' }),
  // deterministisch: id0 niedrig, id1 hoch usw. — Score = Index/10
  predictTasteScore: (f: Record<string, number>) => f.__test_p,
}))
vi.mock('@/lib/news-queue/semantic-dedup', () => ({
  dedupeByTopic: async <T,>(items: T[]) => ({ kept: items, dropped: [] }),
}))
const createRunMock = vi.fn(async () => 'run-1')
const recordMock = vi.fn(async () => {})
vi.mock('@/lib/news-queue/suggestions', () => ({
  createRun: (...a: unknown[]) => createRunMock(...a),
  recordSuggestions: (...a: unknown[]) => recordMock(...a),
}))

import { generateRankingSuggestions } from '@/lib/news-queue/ranking-service'

beforeEach(() => { featuresMock.mockReset(); createRunMock.mockClear(); recordMock.mockClear() })

describe('generateRankingSuggestions (Taste-Modell)', () => {
  it('rankt nach Modell-Score und schreibt Run + Vorschläge im alten Format', async () => {
    featuresMock.mockResolvedValue({
      features: new Map(queueRows.map((r, i) => [r.id, { __test_p: i / 10 }])),
      failedIds: [],
    })
    const res = await generateRankingSuggestions()
    expect(res.runId).toBe('run-1')
    expect(res.suggestions[0].queueItemId).toBe('id5') // höchster Score zuerst
    expect(res.suggestions[0].rank).toBe(1)
    expect(res.suggestions[0].title).toBe('Artikel 5')
    expect(recordMock).toHaveBeenCalledTimes(1)
  })

  it('Fallback: Items ohne Features landen nach den gescoreten (Review Focus 3)', async () => {
    featuresMock.mockResolvedValue({
      features: new Map([['id0', { __test_p: 0.9 }], ['id1', { __test_p: 0.8 }],
        ['id2', { __test_p: 0.7 }], ['id3', { __test_p: 0.6 }]]),
      failedIds: ['id4', 'id5'],
    })
    const res = await generateRankingSuggestions()
    const ids = res.suggestions.map((s) => s.queueItemId)
    expect(ids.slice(0, 4)).toEqual(['id0', 'id1', 'id2', 'id3'])
    expect(ids.slice(4)).toEqual(['id4', 'id5']) // total_score 5 > 4 → id4 vor id5
    expect(res.suggestions[4].reason).toContain('Fallback')
  })

  it('bricht ab, wenn mehr als die Hälfte der Features fehlt (Review Focus 3)', async () => {
    featuresMock.mockResolvedValue({
      features: new Map([['id0', { __test_p: 0.9 }]]),
      failedIds: ['id1', 'id2', 'id3', 'id4', 'id5'],
    })
    await expect(generateRankingSuggestions()).rejects.toThrow(/Taste-Features/)
    expect(createRunMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd ~/dev/synthszr && npx vitest run tests/lib/news-taste-ranking-service.test.ts`
Expected: FAIL (Service ruft noch `runReranker`/`getRankingContext` auf; Mocks greifen nicht)

- [ ] **Step 3: Service umbauen**

`lib/news-queue/ranking-service.ts` — Imports und Mittelteil ersetzen; Stufe 1 (Query, `isJunkTitle`, `MIN_CONTENT_LENGTH`, `MAX_CANDIDATES`, `RECENCY_HOURS`, `TARGET`) bleibt wörtlich stehen. Die Stufe-1-Query um die Zusatzsignal-Spalten erweitern (`synthesis_score, relevance_score, uniqueness_score, source_bonus, source_pub_rate`):

```ts
// lib/news-queue/ranking-service.ts  (neuer Kopf + Mittelteil)
import { createAdminClient } from '@/lib/supabase/admin'
import { isJunkTitle } from './service'
import { createRun, recordSuggestions } from './suggestions'
import { dedupeByTopic } from './semantic-dedup'
import { getOrComputeFeatures, extraFeatures, type TasteInput } from '@/lib/news-taste/features'
import { loadTasteModel, predictTasteScore } from '@/lib/news-taste/predict'
import { JEV_MODEL } from '@/lib/ai/evaluate'
import { FEATURES_VERSION } from '@/lib/news-taste/questions'
import type { RankedSuggestion } from './ranking-types'

// … Konstanten und RankingResult unverändert …

export async function generateRankingSuggestions(): Promise<RankingResult> {
  const supabase = createAdminClient()
  // … Stufe-1-Query wie bisher, select um die Signal-Spalten erweitert …

  const inputs: TasteInput[] = cleaned.map((r) => ({
    queueItemId: r.id,
    title: r.title,
    source: r.source_display_name ?? null,
    text: r.excerpt ?? null,
    synthesis: Number(r.synthesis_score) || 0,
    relevance: Number(r.relevance_score) || 0,
    uniqueness: Number(r.uniqueness_score) || 0,
    sourceBonus: Number(r.source_bonus) || 0,
    sourcePubRate: Number(r.source_pub_rate) || 0,
    contentLength: Number(r.content_length) || 0,
  }))
  if (inputs.length === 0) return { runId: '', suggestions: [] }

  const { features, failedIds } = await getOrComputeFeatures(inputs, { concurrency: 20 })
  // Mehr als die Hälfte ohne Features = Gateway-Störung: sichtbar abbrechen
  // statt eine leise total_score-Liste als „Taste-Vorschlag" auszugeben.
  if (failedIds.length > inputs.length / 2) {
    throw new Error(`Taste-Features für ${failedIds.length}/${inputs.length} Kandidaten fehlgeschlagen — Lauf abgebrochen`)
  }

  const model = loadTasteModel()
  const scored: Array<{ input: TasteInput; p: number; fallback: boolean }> = []
  for (const input of inputs) {
    const jev = features.get(input.queueItemId)
    if (jev) {
      scored.push({ input, p: predictTasteScore({ ...jev, ...extraFeatures(input) }, model), fallback: false })
    } else {
      scored.push({ input, p: -1, fallback: true }) // einsortiert nach den gescoreten
    }
  }
  const byId = new Map(cleaned.map((r) => [r.id, r]))
  scored.sort((a, b) => {
    if (a.fallback !== b.fallback) return a.fallback ? 1 : -1
    if (a.fallback) {
      return (Number(byId.get(b.input.queueItemId)?.total_score) || 0)
        - (Number(byId.get(a.input.queueItemId)?.total_score) || 0)
    }
    return b.p - a.p
  })

  // Dedup über die Top 40: dieselbe Story aus drei Quellen soll einen, nicht
  // drei Plätze belegen. total_score-Feld trägt hier den Modell-Score, damit
  // dedupeByTopic (sortiert intern danach) die Modell-Reihenfolge behält.
  const top = scored.slice(0, 40)
  const { kept } = await dedupeByTopic(
    top.map((s) => ({
      id: s.input.queueItemId, title: s.input.title, content: s.input.text,
      source_identifier: s.input.source ?? undefined,
      total_score: s.fallback ? 0 : s.p,
    })),
    { recentCoverageDays: 7 },
  )
  const scoreById = new Map(top.map((s) => [s.input.queueItemId, s]))

  const suggestions: RankedSuggestion[] = kept.slice(0, TARGET).map((k, i) => {
    const s = scoreById.get(k.id)!
    return {
      queueItemId: k.id,
      rank: i + 1,
      reason: s.fallback
        ? `Fallback total_score ${(Number(byId.get(k.id)?.total_score) || 0).toFixed(1)} (Jev-Features fehlten)`
        : `Taste-Score ${s.p.toFixed(2)}`,
      confidence: s.fallback ? 0 : s.p,
    }
  })

  const runId = await createRun({
    candidateCount: inputs.length,
    suggestedCount: suggestions.length,
    stage1Method: 'recency+junk+taste',
    model: `${JEV_MODEL}+${model.model_type}@fv${FEATURES_VERSION}`,
  })
  await recordSuggestions(runId, suggestions)

  return {
    runId,
    suggestions: suggestions.map((s) => {
      const c = byId.get(s.queueItemId)
      return { ...s, title: c?.title ?? '', source: c?.source_display_name ?? null, date: c?.email_received_at ?? c?.queued_at ?? null }
    }),
  }
}
```

Entfallende Imports (`runReranker`, `getRankingContext`, `getModelForUseCase`) und der `RankingCandidate`-Umbau (`byId`-Map alter Bauart) werden gelöscht; `dateById` geht im neuen Rückgabe-Mapping auf.

- [ ] **Step 4: Tests laufen lassen — müssen bestehen, Gesamtsuite grün**

Run: `cd ~/dev/synthszr && npx vitest run tests/lib/news-taste-ranking-service.test.ts && npm run test`
Expected: neue Tests passed; in der Gesamtsuite scheitern höchstens die Alt-Tests des Rerankers (werden in Task 11 entfernt) — KEINE anderen Regressionen.

- [ ] **Step 5: Typecheck + Commit**

```bash
cd ~/dev/synthszr && npm run typecheck && git add lib/news-queue/ranking-service.ts tests/lib/news-taste-ranking-service.test.ts && git commit -m "feat(news-taste): Ranking-Service nutzt Jev-Features + trainiertes Modell statt LLM-Reranker

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Aufräumen, Doku, Deploy, Prod-Verifikation

**Files:**
- Delete: `lib/news-queue/reranker.ts`, `lib/news-queue/few-shot.ts`, `lib/news-queue/reranker-parse.ts`, `lib/news-queue/winner-similarity.ts` und deren Tests unter `tests/lib/`
- Modify: `lib/ai/use-cases.ts` (Use Case `queue_ranking` entfernen), `tests/lib/use-cases.test.ts`, `app/admin/settings/page.tsx:108` (`queue_ranking` aus der Gruppen-Liste), `lib/news-queue/index.ts` (falls Re-Exports), `CLAUDE.md`

- [ ] **Step 1: Verwaiste Module identifizieren und löschen**

```bash
cd ~/dev/synthszr && grep -rn "reranker\|few-shot\|winner-similarity" lib app --include='*.ts*' | grep -v "lib/news-queue/reranker\|lib/news-queue/few-shot\|lib/news-queue/winner-similarity\|search/rerank"
```
Expected: keine Treffer außerhalb der zu löschenden Dateien (Stand Plan-Erstellung: `winner-similarity` hat null Nutzer, `runReranker`/`buildRerankerPrompt` nur den alten Service). Dann:

```bash
git rm lib/news-queue/reranker.ts lib/news-queue/few-shot.ts lib/news-queue/reranker-parse.ts lib/news-queue/winner-similarity.ts
git rm $(grep -rl "reranker\|few-shot\|winner-similarity" tests/lib --include='*.test.ts' | grep -v news-taste | grep -v search)
```

- [ ] **Step 2: Use Case `queue_ranking` austragen**

In `lib/ai/use-cases.ts`: den Eintrag `'queue_ranking'` aus dem Union-Typ (Zeile ~21) und den Definitionsblock (Zeilen ~111–116) löschen. In `app/admin/settings/page.tsx:108` `'queue_ranking'` aus dem `useCases`-Array der Gruppe nehmen. In `tests/lib/use-cases.test.ts` den Eintrag aus der Liste entfernen und eine etwaige Gesamtzahl-Assertion (37 → 36) anpassen.

- [ ] **Step 3: `lib/news-queue/index.ts` prüfen**

```bash
grep -n "reranker\|few-shot\|winner" lib/news-queue/index.ts
```
Re-Exports der gelöschten Module entfernen, falls vorhanden.

- [ ] **Step 4: CLAUDE.md ergänzen**

Im Abschnitt „News Queue & Article Selection" den Reranker-Verweis ersetzen (drei Zeilen genügen): Vorschläge kommen jetzt aus `lib/news-taste/` (Jev via Vercel AI Gateway, `AI_GATEWAY_API_KEY`, Modell-Artefakt `lib/news-taste/model.json`); Retrain-Runbook `npm run taste:backfill && npm run taste:export && npm run taste:train`. Unter „Environment Variables" die Zeile `AI_GATEWAY_API_KEY` aufnehmen.

- [ ] **Step 5: Gesamtsuite + Typecheck**

Run: `cd ~/dev/synthszr && npm run test && npm run typecheck`
Expected: alles grün, keine Referenzen auf gelöschte Module.

- [ ] **Step 6: Commit + Push (deployt automatisch)**

```bash
cd ~/dev/synthszr && git add -A && git commit -m "refactor(news-taste): LLM-Reranker entfernt — Taste-Modell uebernimmt

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" && git push origin main
```

- [ ] **Step 7: Deploy abwarten und Prod verifizieren**

```bash
cd ~/dev/synthszr && vercel ls --prod 2>&1 | head -8
```
Expected: neuestes Deployment `● Ready`. Dann ein echter Lauf gegen Prod-Daten (lokal, gleiche Codepfade):

```bash
cat > /tmp/taste_prod_check.ts <<'EOF'
import { config } from 'dotenv'
config({ path: process.env.HOME + '/.synthszr.env.prod', quiet: true })
async function main() {
  const { generateRankingSuggestions } = await import('@/lib/news-queue/ranking-service')
  const res = await generateRankingSuggestions()
  console.log('runId:', res.runId)
  for (const s of res.suggestions) console.log(String(s.rank).padStart(2), s.confidence.toFixed(2), s.title.slice(0, 70), '|', s.reason)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
EOF
cd ~/dev/synthszr && npx tsx /tmp/taste_prod_check.ts
```
Expected: `runId` gesetzt, ≤ 15 Vorschläge mit `Taste-Score`-Reasons, Lauf < 30 s. Anschließend Betreiber bitten, den Button in `/admin/news-queue` einmal selbst zu klicken und die Vorschlagsqualität zu beurteilen.

---

## Nacharbeit (außerhalb dieses Plans)

- Feedback-Schleife: `recordFeedback` schreibt weiter Labels; nach ~4 Wochen Retrain und Metrik-Vergleich.
- Optional BYOK (TypeSafe-Key im Vercel-Dashboard), optional Cron-Retrain.

---

## Iteration nach dem Gate (Betreiber-Entscheidung 2026-09-29)

**Befund am Gate (Task 8, Volldaten):** Gate-Vergleich über 36 Läufe (gleiche Pools/Relevanzmengen): Modell (LR) R@15 0,104 / NDCG@15 0,116 · alter LLM-Reranker 0,095 / 0,089 · produktive `total_score`-Sortierung **0,142 / 0,141** · Zufall 0,018 / 0,015. Das Modell schlägt den Reranker, nicht aber `total_score`.

**Betreiber-Entscheidung:** zweiter Trainingsversuch ohne neue Jev-Kosten (Tasks 8b, 8c). **Entscheidungsregel (vom Betreiber vorab freigegeben):** Schlägt der neue Gewinner `total_score` im Gate-Vergleich bei R@15 UND NDCG@15, werden Tasks 9–11 wie geplant umgesetzt (Umschalten auf das Modell). Sonst wird Option 2 umgesetzt: der Button sortiert nach `total_score` + semantischer Dedup, ohne LLM und ohne Modell zur Laufzeit (Tasks 9–11 werden dafür angepasst).

### Task 8b: `total_score` als Zusatzsignal

**Files:**
- Modify: `lib/news-taste/questions.ts`, `lib/news-taste/features.ts`, `scripts/backfill-taste-features.ts`, `scripts/export-taste-dataset.ts` (ggf. `scripts/lib/taste-ground-truth.ts`, falls dort die Spaltenliste steht)
- Test: `tests/lib/news-taste-features.test.ts`, `tests/lib/news-taste-get-or-compute.test.ts`

**Interfaces:**
- Produces: `EXTRA_FEATURE_NAMES` endet mit `'total_score'` (an das ENDE angehängt, bestehende Reihenfolge bleibt) → `FEATURE_NAMES.length === 39`; `TasteInput.totalScore: number`; `extraFeatures()` liefert `total_score: num(input.totalScore)`.
- `FEATURES_VERSION` bleibt **1**: Die Version beschreibt den Jev-Fragenkatalog, dessen Vektoren in `news_taste_features` liegen; Zusatzsignale werden immer frisch berechnet. Eine Erhöhung würde die 58.602 bezahlten Vektoren verwaisen lassen. Kommentar entsprechend ergänzen.

`news_queue.total_score` ist eine GENERATED STORED Spalte mit exakt der Produktionsformel (Migration `20260328_optimized_scoring.sql`) — der echte DB-Wert wird verwendet, keine Rekonstruktion. Backfill und Export selektieren `total_score` zusätzlich und füllen `totalScore`.

- [ ] Tests zuerst anpassen/erweitern (extraFeatures liefert `total_score`; FEATURE_NAMES hat 39 Einträge und endet auf `total_score`), RED, dann Implementierung, GREEN
- [ ] `npm run typecheck`, `pnpm test`
- [ ] `npm run taste:export` erneut (read-only) → `taste-dataset.json` mit 39 Features; prüfen: jede `x`-Länge 39, kein NaN
- [ ] Commit

### Task 8c: Ranking-Objective und Gewinnerwahl auf Validierung

**Files:**
- Modify: `scripts/train_news_taste.py`; regeneriert: `lib/news-taste/model.json`, `scripts/taste-train-report.json`

**Anforderungen:**
- Innere Validierung: die jüngsten 20 % der TRAININGS-Tage (chronologisch) sind Validierung. Alle Kandidaten werden auf „Train ohne Validierung" gefittet und auf Validierung per Tages-NDCG@15 verglichen. **Der Gewinner wird auf der Validierung gewählt, nie auf dem Testzeitraum.** Danach wird der Gewinner auf allen Trainingstagen neu gefittet (Ranker mit der auf Validierung gefundenen Iterationszahl) und auf dem Testzeitraum berichtet. Testmetriken ALLER Kandidaten werden berichtet, fließen aber nicht in die Wahl ein. (Ersetzt die bisherige Regel „NDCG@15 auf Test, LR-Tiebreak".)
- Kandidaten: `logreg` (wie bisher), `lightgbm` (Klassifikator wie bisher), neu `lightgbm_ranker` (`LGBMRanker`, `objective='lambdarank'`, Gruppen = Tage, `eval_at=[15]`, Early Stopping auf der Validierung, `deterministic=True`, `force_row_wise=True`, fester Seed).
- `total_score_baseline` nutzt jetzt das echte Feature `total_score`; die Rekonstruktion entfällt, `legacy_formula_baseline` bleibt.
- Artefakt: Gewinnt der Ranker, ist `model_type` `'lightgbm'` mit denselben `tree_structure`-Bäumen (die TS-Inferenz wendet sigmoid auf die Baumsumme an — monoton, ranking-neutral). Parität für den Ranker: Artefakt-Walk vs. `booster_.predict(X, raw_score=True)` (roher Score, beide ohne sigmoid oder beide mit), Toleranz 1e-6, für alle Kandidaten.
- `gate_comparison` wie bisher (Modell = Gewinner, Reranker, total_score, Zufall) plus zusätzlich die Zeilen aller Kandidaten, damit der Betreiber sieht, ob irgendein Kandidat `total_score` schlägt.
- Report: `validation_metrics` je Kandidat, `test_metrics` je Kandidat, `winner` + Begründung, Gate-Tabelle.
- [ ] Umsetzen, `npm run taste:train`, Parität grün
- [ ] Commit (Skript, `model.json`, Report)
- [ ] Controller wendet die Entscheidungsregel an

---

## Ergebnis der Iteration und Option 2 (2026-09-29)

**Task 8c (Volldaten, Gewinner auf Validierung gewählt):** Gewinner `lightgbm_ranker` (Val-NDCG@15 0,340; logreg 0,304; lightgbm 0,298; total_score 0,331). **Gate-Vergleich (36 Läufe, R@15 / NDCG@15):** ranker 0,118 / 0,089 · logreg 0,104 / 0,116 · lightgbm 0,099 / 0,075 · **total_score 0,142 / 0,138** · Reranker 0,095 / 0,089 · Zufall 0,018 / 0,015. Kein Kandidat schlägt `total_score` → laut vorab freigegebener Regel **Option 2**.

**Folgen für den Plan:** Task 9 (TS-Inferenz) entfällt — zur Laufzeit läuft kein Modell. Tasks 10 und 11 werden durch 10' und 11' ersetzt. Die Jev-/Trainings-Pipeline (`lib/ai/evaluate.ts`, `lib/news-taste/*`, `scripts/*taste*`, `news_taste_features`) bleibt als Offline-Werkzeug für spätere Neuversuche erhalten; `lib/news-taste/model.json` + `scripts/taste-train-report.json` dokumentieren den Gate-Befund.

### Task 10': Ranking-Service auf `total_score` + Dedup

**Files:**
- Modify: `lib/news-queue/ranking-service.ts`
- Test: `tests/lib/ranking-service-total-score.test.ts`

**Interfaces:**
- Consumes: `dedupeByTopic(items, { recentCoverageDays })` aus `./semantic-dedup` (best-effort: bei Embedding-Fehler kommt die Eingabe unverändert zurück), `createRun`/`recordSuggestions` aus `./suggestions` (unverändert).
- Produces: `generateRankingSuggestions(): Promise<RankingResult>` — Signatur und Rückgabeform EXAKT wie bisher (Route `app/api/admin/ranking/route.ts` und Cron `app/api/cron/scheduled-tasks/route.ts` bleiben unangetastet).

**Verhalten:**
1. Stufe 1 bleibt wörtlich (pending, nicht abgelaufen, `queued_at` ≥ jetzt − 24 h, `order total_score desc`, `limit 300`, `isJunkTitle`-Filter, `content_length ≥ 500`, max. 200 Kandidaten).
2. Die obersten 40 Kandidaten (nach `total_score`) gehen durch `dedupeByTopic(..., { recentCoverageDays: 7 })` (DedupItem: `id`, `title`, `content: excerpt`, `total_score`); `kept` bleibt nach `total_score` absteigend sortiert.
3. Top 15 (`TARGET`) werden Vorschläge: `rank` 1..n, `reason` = `total_score 7.4` (eine Nachkommastelle), `confidence` = `total_score / höchster total_score der Vorschläge` (0..1; 0, falls der höchste Wert ≤ 0 ist).
4. `createRun({ candidateCount, suggestedCount, stage1Method: 'recency+junk+total_score+dedup', model: 'total_score' })`, danach `recordSuggestions`.
5. Leerer Pool → `{ runId: '', suggestions: [] }` ohne Run-Zeile (wie bisher).
6. Kein LLM-Aufruf, kein `getModelForUseCase`, keine Jev-Aufrufe. Imports von `./reranker`, `getRankingContext`, `getModelForUseCase` entfallen.
7. Kopfkommentar der Datei: WARUM `total_score` (Gate-Befund mit Zahlen, Verweis auf `scripts/taste-train-report.json`).

- [ ] **Test zuerst** (`tests/lib/ranking-service-total-score.test.ts`, Supabase-Kette `.from().select().eq().gt().gte().order().limit()` gemockt, `isJunkTitle` → false, `dedupeByTopic` und `./suggestions` gemockt): (a) Vorschläge in `total_score`-Reihenfolge, `rank` ab 1, `reason` enthält den Score, `confidence` des ersten = 1; (b) ein von `dedupeByTopic` verworfenes Item erscheint nicht, das nächste rückt nach; (c) höchstens 15 Vorschläge bei 40 Kandidaten; (d) `createRun` mit `model: 'total_score'` und `stage1Method: 'recency+junk+total_score+dedup'`; (e) leerer Pool → `runId ''`, `createRun` nicht aufgerufen; (f) Items mit `content_length < 500` fehlen.
- [ ] RED, Implementierung, GREEN; `npm run typecheck`; `pnpm test` (Alt-Tests des Rerankers dürfen hier noch laufen — sie werden in 11' entfernt; keine anderen Regressionen)
- [ ] Commit

### Task 11': Aufräumen und Doku (kein Push, kein Deploy)

**Files:**
- Delete: `lib/news-queue/reranker.ts`, `lib/news-queue/few-shot.ts`, `lib/news-queue/reranker-parse.ts`, `lib/news-queue/winner-similarity.ts`, `tests/lib/ranking-fewshot.test.ts`, `tests/lib/ranking-parse.test.ts`, `tests/lib/ranking-modelconfig.test.ts`, sowie weitere Tests, die ausschließlich gelöschte Module testen
- Modify: `lib/ai/use-cases.ts` (Use Case `queue_ranking` entfernen), `tests/lib/use-cases.test.ts`, `app/admin/settings/page.tsx` (`queue_ranking` aus der Gruppe), `lib/news-queue/index.ts` (Re-Exports prüfen), `lib/news-queue/suggestions.ts` (`getRankingContext`/`extractHeadingTexts` entfernen, falls danach unbenutzt), `CLAUDE.md`

- [ ] Verwaiste Referenzen suchen (`grep -rn "reranker\|few-shot\|reranker-parse\|winner-similarity\|getRankingContext\|queue_ranking" lib app tests`), dann löschen/anpassen; `search/rerank` ist ein anderes Modul und bleibt
- [ ] `CLAUDE.md`: Abschnitt „News Queue & Article Selection" — der Vorschlags-Button sortiert nach `total_score` + semantischer Dedup (kein LLM); Taste-Pipeline als Offline-Werkzeug mit Runbook `npm run taste:backfill && npm run taste:export && npm run taste:train` und Gate-Befund (Zahlen, Verweis auf Report); Env `AI_GATEWAY_API_KEY` (nur Offline-Skripte)
- [ ] `pnpm test`, `npm run typecheck` grün
- [ ] Commit auf `feat/news-taste-model` — **kein Push, kein Deploy** (Merge/Push erst in finishing-a-development-branch mit Betreiber-Zustimmung)
