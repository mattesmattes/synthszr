# Servergetriebener Lexikonlauf — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die drei langen Lexikonläufe (Begriffe erzeugen, Illustrationen, Nachverlinkung) laufen servergetrieben über eine Job-Queue mit Minutentakt-Cron zu Ende; der Browser legt nur einen Job an und zeigt Fortschritt.

**Architecture:** Neue Tabelle `glossary_jobs` (eine Zeile je Lauf, `kind` unterscheidet die Art) plus `lib/glossary/jobs/service.ts` nach dem Muster von `lib/article-jobs/service.ts`: `last_advanced_at` als Lease verhindert überlappende Ticks, das Protokoll liegt als JSONB in der Zeile. Ein Cron (`*/1`) holt den ältesten offenen Job und arbeitet innerhalb eines Zeitbudgets Arbeitseinheiten ab, indem er die **bestehenden** Fachfunktionen aufruft. Das Panel verliert seine drei `for(;;)`-Schleifen und pollt stattdessen.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (postgres-js, Service-Role-Client), vitest, Vercel Cron, Supabase-CLI für Migrationen.

## Global Constraints

- **Migrationen über die Supabase-CLI**, nicht über den MCP — dieses Projekt ist dort nicht erreichbar.
- **`maxDuration = 300`** auf allen beteiligten Routen; das Zeitbudget je Tick ist 240 s, die erste Arbeitseinheit läuft immer (Obergrenze 270 s laut `glossary-crawl/route.ts:154`).
- **`LEASE_STALE_MS = 360_000`** (6 Min). MUSS über `maxDuration` liegen, sonst übernimmt ein zweiter Tick einen laufenden Job und erzeugt denselben Begriff doppelt.
- **Cron-Routen antworten immer 200**, wenn nichts zu tun ist, und nutzen `verifyCronAuth` aus `@/lib/security/cron-auth`.
- **Admin-Routen** prüfen `getSession()` aus `@/lib/auth/session` und antworten sonst 401 `{ error: 'Nicht autorisiert' }`.
- **Kein `includeHistory` in Renderpfaden** (Egress-Regel des Projekts).
- **PostgREST kappt still bei 1000 Zeilen** — jede Listenabfrage bekommt `.range()`.
- **Deutsche Kommentare**, die das WARUM festhalten, im Stil der umliegenden Dateien. Commit-Messages ohne Umlaute (Projektkonvention).
- **Fachlogik wird nicht dupliziert:** Cron und Admin-Route rufen dieselben Funktionen.

---

### Task 1: Migration und Service-Grundgerüst

**Files:**
- Create: `supabase/migrations/20260805120000_glossary_jobs.sql`
- Create: `lib/glossary/jobs/service.ts`
- Test: `tests/lib/glossary-jobs-service.test.ts`

**Interfaces:**
- Consumes: `createAdminClient` aus `@/lib/supabase/admin` (nur als Typ `AdminClient`), `openCandidateCount` aus `@/lib/glossary/crawl`
- Produces:
  - `type GlossaryJobKind = 'generate' | 'images' | 'relink'`
  - `type GlossaryJobStatus = 'pending' | 'processing' | 'done' | 'error' | 'cancelled'`
  - `interface GlossaryJobLogEntry { at: string; text: string; ok: boolean }`
  - `interface GlossaryJob { id: string; kind: GlossaryJobKind; status: GlossaryJobStatus; total: number | null; done_count: number; log: GlossaryJobLogEntry[]; cancel_requested: boolean; last_advanced_at: string | null; attempts: number; params: Record<string, unknown>; error_message: string | null; created_at: string; finished_at: string | null }`
  - `createOrGetJob(supabase: AdminClient, kind: GlossaryJobKind, params?: Record<string, unknown>): Promise<GlossaryJob>`
  - `getJobStatus(supabase: AdminClient, kind: GlossaryJobKind): Promise<GlossaryJob | null>`
  - `LEASE_STALE_MS = 360_000`

- [ ] **Step 1: Migration schreiben**

```sql
-- supabase/migrations/20260805120000_glossary_jobs.sql
--
-- Servergetriebene Lexikonlaeufe. Bisher trieb der Browser die drei langen
-- Laeufe in for(;;)-Schleifen, um maxDuration=300 zu umgehen. Der Preis war
-- messbar: bei einem Lauf am 2026-08-05 war der Server fuer "Provenienz" um
-- 14:05:51 fertig, das UI zeigte den Begriff um 15:25:58 — 80 Minuten
-- Leerlauf, weil der naechste Request erst nach Verarbeitung der Antwort
-- rausgeht und der Tab gedrosselt war.
create table if not exists glossary_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('generate','images','relink')),
  status text not null default 'pending'
    check (status in ('pending','processing','done','error','cancelled')),
  -- Bekannte Gesamtzahl. Bei relink NULL: die Zahl der noch zu pruefenden
  -- Artikel haengt am Cursor und steht nicht vorab fest.
  total int,
  done_count int not null default 0,
  -- Protokoll fuer die Anzeige. JSONB statt eigener Tabelle: der Verlauf wird
  -- immer komplett gelesen, nie einzeln abgefragt, und ein Lauf erzeugt
  -- Dutzende, nicht Millionen Eintraege. Ausserdem uebersteht er damit ein
  -- Neuladen des Tabs — vorher lebte er nur im React-State.
  log jsonb not null default '[]'::jsonb,
  cancel_requested boolean not null default false,
  -- Lease gegen ueberlappende Ticks. Bei Minutentakt startet waehrend eines
  -- laufenden Ticks fuenfmal ein neuer Cron.
  last_advanced_at timestamptz,
  -- Erfolglose Ticks in Folge (Modell-Ueberlast). Bei Erfolg zurueck auf 0.
  attempts int not null default 0,
  params jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Hoechstens EIN offener Job je Art. Erledigt den Doppelstart auf DB-Ebene,
-- statt sich auf die UI zu verlassen.
create unique index if not exists glossary_jobs_one_open_per_kind
  on glossary_jobs (kind) where status in ('pending','processing');

-- Der Cron sucht den aeltesten offenen Job mit abgelaufenem Lease.
create index if not exists glossary_jobs_open_by_age
  on glossary_jobs (created_at) where status in ('pending','processing');

alter table glossary_jobs enable row level security;
-- Kein anon-Zugriff: die Jobs werden ausschliesslich ueber den
-- Service-Role-Client von Admin-Routen und Cron gelesen und geschrieben
-- (Klasse ADMIN-ONLY des RLS-Umbaus). Ohne Policy sieht anon nichts.
```

- [ ] **Step 2: Failing test für `createOrGetJob` schreiben**

```typescript
// tests/lib/glossary-jobs-service.test.ts
/**
 * Job-Service der servergetriebenen Lexikonlaeufe.
 *
 * Testmuster wie glossary-detail.test.ts: pro Tabelle eine FIFO-Queue, jede
 * Filtermethode bleibt ein vi.fn(), damit auch die Constraints prüfbar sind.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  queues: {} as Record<string, unknown[]>,
  fallback: { data: null as unknown, error: null as unknown },
  chains: {} as Record<string, any[]>,
}))

function makeChain(table: string) {
  const chain: any = {}
  for (const m of ['select', 'eq', 'in', 'is', 'or', 'lt', 'order', 'limit', 'range', 'update', 'insert']) {
    chain[m] = vi.fn(() => chain)
  }
  const queue = state.queues[table]
  const own = queue && queue.length ? queue.shift() : undefined
  const resolved = () => own ?? state.fallback
  chain.single = vi.fn(async () => resolved())
  chain.maybeSingle = vi.fn(async () => resolved())
  chain.then = (res: (v: unknown) => void) => res(resolved())
  ;(state.chains[table] ??= []).push(chain)
  return chain
}

const client = { from: vi.fn((t: string) => makeChain(t)) } as any

beforeEach(() => {
  state.queues = {}
  state.chains = {}
  state.fallback = { data: null, error: null }
})

const JOB = {
  id: 'j1', kind: 'generate', status: 'pending', total: 47, done_count: 0,
  log: [], cancel_requested: false, last_advanced_at: null, attempts: 0,
  params: {}, error_message: null, created_at: '2026-08-05T10:00:00Z', finished_at: null,
}

describe('createOrGetJob', () => {
  it('legt einen Job an und gibt ihn zurueck', async () => {
    const { createOrGetJob } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [{ data: JOB, error: null }]

    const job = await createOrGetJob(client, 'generate', {})

    expect(job.id).toBe('j1')
    expect(job.kind).toBe('generate')
  })

  it('gibt bei verletztem Unique-Index den bestehenden offenen Job zurueck', async () => {
    // 23505 = unique_violation. Der partielle Index laesst nur einen offenen
    // Job je Art zu; ein zweiter Klick darf deshalb nicht scheitern, sondern
    // muss den laufenden Lauf liefern.
    const { createOrGetJob } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [
      { data: null, error: { code: '23505', message: 'duplicate key' } },
      { data: { ...JOB, status: 'processing', done_count: 3 }, error: null },
    ]

    const job = await createOrGetJob(client, 'generate', {})

    expect(job.status).toBe('processing')
    expect(job.done_count).toBe(3)
  })
})

describe('getJobStatus', () => {
  it('liefert den offenen Job', async () => {
    const { getJobStatus } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [{ data: { ...JOB, status: 'processing' }, error: null }]

    const job = await getJobStatus(client, 'generate')

    expect(job?.status).toBe('processing')
  })

  it('liefert ohne offenen Job den juengsten abgeschlossenen', async () => {
    // Sonst wuerde das Panel nach Abschluss leer — der Betreiber soll Ergebnis
    // und Protokoll noch sehen.
    const { getJobStatus } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [
      { data: null, error: null },
      { data: { ...JOB, status: 'done', done_count: 47 }, error: null },
    ]

    const job = await getJobStatus(client, 'generate')

    expect(job?.status).toBe('done')
    expect(job?.done_count).toBe(47)
  })
})
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/lib/glossary-jobs-service.test.ts`
Expected: FAIL — `Cannot find module '@/lib/glossary/jobs/service'`

- [ ] **Step 4: Service implementieren**

```typescript
// lib/glossary/jobs/service.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { openCandidateCount, readCrawlState } from '@/lib/glossary/crawl'

type AdminClient = SupabaseClient<any, any, any>

export type GlossaryJobKind = 'generate' | 'images' | 'relink'
export type GlossaryJobStatus = 'pending' | 'processing' | 'done' | 'error' | 'cancelled'

export interface GlossaryJobLogEntry {
  at: string
  text: string
  ok: boolean
}

export interface GlossaryJob {
  id: string
  kind: GlossaryJobKind
  status: GlossaryJobStatus
  total: number | null
  done_count: number
  log: GlossaryJobLogEntry[]
  cancel_requested: boolean
  last_advanced_at: string | null
  attempts: number
  params: Record<string, unknown>
  error_message: string | null
  created_at: string
  finished_at: string | null
}

/**
 * Wie lange ein Lease gilt. MUSS ueber maxDuration (300s) liegen: das Lease
 * wird nur ZWISCHEN Arbeitseinheiten gestempelt, eine einzelne Einheit kann
 * 270s ohne Stempel laufen. Waere das Lease kuerzer, wuerde der naechste
 * Minutentick denselben Job uebernehmen und derselbe Begriff zweimal erzeugt —
 * mit doppelten Modellkosten. Sechs Minuten liegen ueber allem, was ein Tick
 * ueberleben kann; ein abgestuerzter Tick blockiert damit hoechstens so lange.
 */
export const LEASE_STALE_MS = 360_000

const OPEN = ['pending', 'processing'] as const

/** Postgres-Code fuer unique_violation. */
const UNIQUE_VIOLATION = '23505'

/**
 * Legt einen Lauf an — oder liefert den bereits offenen derselben Art.
 *
 * Idempotent, weil der partielle Unique-Index glossary_jobs_one_open_per_kind
 * nur einen offenen Job je Art zulaesst. Ein doppelter Klick im Panel soll
 * nicht in einen Fehler laufen, sondern auf den laufenden Lauf zeigen.
 */
export async function createOrGetJob(
  supabase: AdminClient,
  kind: GlossaryJobKind,
  params: Record<string, unknown> = {},
): Promise<GlossaryJob> {
  const total = await estimateTotal(supabase, kind)

  const { data, error } = await supabase
    .from('glossary_jobs')
    .insert({ kind, params, total })
    .select('*')
    .single()

  if (!error && data) return data as GlossaryJob

  if (error && error.code === UNIQUE_VIOLATION) {
    const existing = await getOpenJob(supabase, kind)
    if (existing) return existing
  }
  throw new Error(`Job (${kind}) nicht anlegbar: ${error?.message ?? 'unbekannt'}`)
}

/**
 * Gesamtzahl fuer die Fortschrittsanzeige. Bei relink absichtlich null: die
 * Zahl der noch zu pruefenden Artikel haengt am Cursor und steht nicht vorab
 * fest — die Anzeige muss null als "Anzahl offen" lesen, nicht als Null.
 */
async function estimateTotal(supabase: AdminClient, kind: GlossaryJobKind): Promise<number | null> {
  if (kind === 'relink') return null
  if (kind === 'generate') {
    const state = await readCrawlState(supabase)
    return openCandidateCount(state)
  }
  const { count } = await supabase
    .from('glossary_terms')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .is('illustration_url', null)
  return count ?? null
}

async function getOpenJob(supabase: AdminClient, kind: GlossaryJobKind): Promise<GlossaryJob | null> {
  const { data } = await supabase
    .from('glossary_jobs')
    .select('*')
    .eq('kind', kind)
    .in('status', OPEN as unknown as string[])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as GlossaryJob | null) ?? null
}

/**
 * Lesepfad fuer das Polling im Panel: der offene Job dieser Art, sonst der
 * juengste abgeschlossene. Ohne den zweiten Teil wuerde das Panel in dem
 * Moment leer, in dem der Lauf fertig ist.
 */
export async function getJobStatus(
  supabase: AdminClient,
  kind: GlossaryJobKind,
): Promise<GlossaryJob | null> {
  const open = await getOpenJob(supabase, kind)
  if (open) return open

  const { data } = await supabase
    .from('glossary_jobs')
    .select('*')
    .eq('kind', kind)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as GlossaryJob | null) ?? null
}
```

- [ ] **Step 5: Test laufen lassen, Erfolg bestätigen**

Run: `npx vitest run tests/lib/glossary-jobs-service.test.ts`
Expected: PASS (4 Tests)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: keine Ausgabe

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260805120000_glossary_jobs.sql lib/glossary/jobs/service.ts tests/lib/glossary-jobs-service.test.ts
git commit -m "feat(lexikon): glossary_jobs Tabelle und Job-Service

Grundgeruest fuer servergetriebene Laeufe: eine Zeile je Lauf, kind
unterscheidet die drei Arten, partieller Unique-Index laesst nur einen offenen
Job je Art zu. createOrGetJob ist deshalb idempotent."
```

---

### Task 2: Lease, Protokoll und Abbruch

**Files:**
- Modify: `lib/glossary/jobs/service.ts`
- Test: `tests/lib/glossary-jobs-service.test.ts` (erweitern)

**Interfaces:**
- Consumes: alles aus Task 1
- Produces:
  - `getNextOpenJob(supabase: AdminClient, now?: number): Promise<GlossaryJob | null>`
  - `stampLease(supabase: AdminClient, id: string): Promise<void>`
  - `appendLog(supabase: AdminClient, job: GlossaryJob, entries: GlossaryJobLogEntry[], doneDelta: number): Promise<void>`
  - `requestCancel(supabase: AdminClient, kind: GlossaryJobKind): Promise<void>`
  - `finishJob(supabase: AdminClient, id: string, status: GlossaryJobStatus, errorMessage?: string): Promise<void>`
  - `setAttempts(supabase: AdminClient, id: string, attempts: number): Promise<void>` — Task 4 mockt diese Funktion, sie muss also exportiert sein.

- [ ] **Step 1: Failing tests schreiben (an die bestehende Datei anhängen)**

```typescript
describe('getNextOpenJob', () => {
  it('filtert Jobs mit frischem Lease heraus', async () => {
    // Der Filter muss "last_advanced_at ist null ODER aelter als die
    // Lease-Grenze" ausdruecken, sonst greift ein zweiter Minutentick in einen
    // laufenden Job.
    const { getNextOpenJob, LEASE_STALE_MS } = await import('@/lib/glossary/jobs/service')
    const now = Date.parse('2026-08-05T12:00:00Z')
    state.queues['glossary_jobs'] = [{ data: null, error: null }]

    await getNextOpenJob(client, now)

    const chain = state.chains['glossary_jobs'][0]
    const expected = new Date(now - LEASE_STALE_MS).toISOString()
    expect(chain.or).toHaveBeenCalledWith(
      `last_advanced_at.is.null,last_advanced_at.lt.${expected}`,
    )
    expect(chain.in).toHaveBeenCalledWith('status', ['pending', 'processing'])
  })

  it('nimmt den aeltesten offenen Job', async () => {
    const { getNextOpenJob } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [{ data: { ...JOB, id: 'alt' }, error: null }]

    const job = await getNextOpenJob(client, Date.parse('2026-08-05T12:00:00Z'))

    expect(job?.id).toBe('alt')
    expect(state.chains['glossary_jobs'][0].order).toHaveBeenCalledWith('created_at', { ascending: true })
  })
})

describe('appendLog', () => {
  it('haengt an das bestehende Protokoll an und zaehlt hoch', async () => {
    const { appendLog } = await import('@/lib/glossary/jobs/service')
    const job = { ...JOB, log: [{ at: '10:00:00', text: 'A', ok: true }], done_count: 1 } as any
    state.queues['glossary_jobs'] = [{ data: null, error: null }]

    await appendLog(client, job, [{ at: '10:02:00', text: 'B', ok: true }], 1)

    const chain = state.chains['glossary_jobs'][0]
    const payload = chain.update.mock.calls[0][0]
    expect(payload.log).toEqual([
      { at: '10:00:00', text: 'A', ok: true },
      { at: '10:02:00', text: 'B', ok: true },
    ])
    expect(payload.done_count).toBe(2)
    // Jede Protokollzeile stempelt das Lease neu: so bleibt der Job auch bei
    // einem langen Tick als "in Arbeit" erkennbar.
    expect(payload.last_advanced_at).toBeTypeOf('string')
  })
})

describe('requestCancel', () => {
  it('setzt cancel_requested nur auf offenen Jobs', async () => {
    const { requestCancel } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [{ data: null, error: null }]

    await requestCancel(client, 'generate')

    const chain = state.chains['glossary_jobs'][0]
    expect(chain.update).toHaveBeenCalledWith({ cancel_requested: true })
    expect(chain.in).toHaveBeenCalledWith('status', ['pending', 'processing'])
  })
})

describe('finishJob', () => {
  it('setzt Status, finished_at und die Fehlermeldung', async () => {
    const { finishJob } = await import('@/lib/glossary/jobs/service')
    state.queues['glossary_jobs'] = [{ data: null, error: null }]

    await finishJob(client, 'j1', 'error', 'Modell dauerhaft ueberlastet')

    const payload = state.chains['glossary_jobs'][0].update.mock.calls[0][0]
    expect(payload.status).toBe('error')
    expect(payload.error_message).toBe('Modell dauerhaft ueberlastet')
    expect(payload.finished_at).toBeTypeOf('string')
  })
})
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/lib/glossary-jobs-service.test.ts`
Expected: FAIL — `getNextOpenJob is not a function` (und drei weitere)

- [ ] **Step 3: Implementieren (an `service.ts` anhängen)**

```typescript
/**
 * Der aelteste offene Job, dessen Lease abgelaufen ist.
 *
 * Gleiche Bauart wie article-jobs/service.ts:207. `now` ist Parameter, nicht
 * Date.now() im Rumpf, damit der Lease-Filter testbar bleibt.
 */
export async function getNextOpenJob(
  supabase: AdminClient,
  now: number = Date.now(),
): Promise<GlossaryJob | null> {
  const staleBefore = new Date(now - LEASE_STALE_MS).toISOString()
  const { data } = await supabase
    .from('glossary_jobs')
    .select('*')
    .in('status', OPEN as unknown as string[])
    .or(`last_advanced_at.is.null,last_advanced_at.lt.${staleBefore}`)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as GlossaryJob | null) ?? null
}

/** Stempelt das Lease und setzt den Job auf 'processing'. */
export async function stampLease(supabase: AdminClient, id: string): Promise<void> {
  await supabase
    .from('glossary_jobs')
    .update({ status: 'processing', last_advanced_at: new Date().toISOString() })
    .eq('id', id)
}

/**
 * Haengt Protokollzeilen an und erhoeht den Zaehler.
 *
 * Read-modify-write auf dem JSONB: der Job wird immer nur von EINEM Tick
 * bearbeitet (Lease), ein verlorenes Update ist damit ausgeschlossen. Das Lease
 * wird gleich mitgestempelt, weil eine Protokollzeile beweist, dass der Tick
 * lebt.
 */
export async function appendLog(
  supabase: AdminClient,
  job: GlossaryJob,
  entries: GlossaryJobLogEntry[],
  doneDelta: number,
): Promise<void> {
  await supabase
    .from('glossary_jobs')
    .update({
      log: [...job.log, ...entries],
      done_count: job.done_count + doneDelta,
      last_advanced_at: new Date().toISOString(),
    })
    .eq('id', job.id)
  // Der Aufrufer arbeitet mit derselben Job-Kopie weiter.
  job.log = [...job.log, ...entries]
  job.done_count = job.done_count + doneDelta
}

/** Merkt den Abbruchwunsch an. Der naechste Tick wertet ihn aus. */
export async function requestCancel(supabase: AdminClient, kind: GlossaryJobKind): Promise<void> {
  await supabase
    .from('glossary_jobs')
    .update({ cancel_requested: true })
    .eq('kind', kind)
    .in('status', OPEN as unknown as string[])
}

export async function finishJob(
  supabase: AdminClient,
  id: string,
  status: GlossaryJobStatus,
  errorMessage?: string,
): Promise<void> {
  await supabase
    .from('glossary_jobs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      error_message: errorMessage ?? null,
    })
    .eq('id', id)
}

/** Zaehlt erfolglose Ticks; bei Erfolg zurueck auf 0. */
export async function setAttempts(supabase: AdminClient, id: string, attempts: number): Promise<void> {
  await supabase.from('glossary_jobs').update({ attempts }).eq('id', id)
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npx vitest run tests/lib/glossary-jobs-service.test.ts`
Expected: PASS (9 Tests)

- [ ] **Step 5: Commit**

```bash
git add lib/glossary/jobs/service.ts tests/lib/glossary-jobs-service.test.ts
git commit -m "feat(lexikon): Lease, Protokoll und Abbruch im Job-Service

LEASE_STALE_MS liegt mit 6 Minuten bewusst ueber maxDuration=300: das Lease
wird nur zwischen Arbeitseinheiten gestempelt, eine Einheit kann 270s ohne
Stempel laufen. Kuerzer wuerde der naechste Minutentick denselben Job
uebernehmen und denselben Begriff doppelt erzeugen."
```

---

### Task 3: relink-Orchestrierung extrahieren

**Files:**
- Modify: `lib/glossary/crawl.ts` (neue Funktion am Ende)
- Modify: `app/api/admin/glossary-crawl/route.ts:117-141` (Zweig ruft die neue Funktion)
- Test: `tests/lib/glossary-relink-batch.test.ts`

**Interfaces:**
- Consumes: `backfillGlossaryLinks` aus `@/lib/glossary/backfill` (Signatur: `(supabase, terms, reserved, cursor, limit?, since?) => Promise<BackfillResult>`), `getMatcherTerms`/`buildReservedNames`/`getChartProductNames` aus `@/lib/glossary/terms`, `readCrawlState`/`writeRelinkCursor` aus `@/lib/glossary/crawl`
- Produces: `relinkNextBatch(supabase: AdminClient, opts?: { since?: string | null }): Promise<BackfillResult>` — `BackfillResult` ist `{ linked: string[]; unchanged: number; remaining: number; cursor: string | null }`

- [ ] **Step 1: Failing test schreiben**

```typescript
// tests/lib/glossary-relink-batch.test.ts
/**
 * relinkNextBatch buendelt die Orchestrierung, die bisher inline im
 * Route-Zweig action=relink lag: Begriffe laden, reservierte Namen bauen,
 * Cursor lesen und zurueckschreiben. Die Verlinkungsarbeit selbst steckte
 * schon in backfillGlossaryLinks — nur war sie vom Cron aus nicht erreichbar.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  backfill: vi.fn(),
  matcherTerms: vi.fn(),
  chartNames: vi.fn(),
  readState: vi.fn(),
  writeCursor: vi.fn(),
}))

vi.mock('@/lib/glossary/backfill', () => ({ backfillGlossaryLinks: mocks.backfill }))
vi.mock('@/lib/glossary/terms', () => ({
  getMatcherTerms: mocks.matcherTerms,
  buildReservedNames: (n: string[]) => n,
  getChartProductNames: mocks.chartNames,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.matcherTerms.mockResolvedValue([{ slug: 'transformer', canonicalName: 'Transformer', aliases: [] }])
  mocks.chartNames.mockResolvedValue(['GPT-5'])
  mocks.backfill.mockResolvedValue({ linked: ['a'], unchanged: 2, remaining: 5, cursor: 'c2' })
})

describe('relinkNextBatch', () => {
  it('reicht den gespeicherten Cursor an backfillGlossaryLinks weiter', async () => {
    const { relinkNextBatch } = await import('@/lib/glossary/crawl')
    const supabase = makeSupabaseWithCrawlState({ relinkCursor: 'c1' })

    const result = await relinkNextBatch(supabase, { since: null })

    expect(mocks.backfill.mock.calls[0][3]).toBe('c1')
    expect(result.linked).toEqual(['a'])
  })

  it('schreibt den neuen Cursor zurueck, solange Artikel offen sind', async () => {
    const { relinkNextBatch } = await import('@/lib/glossary/crawl')
    const supabase = makeSupabaseWithCrawlState({ relinkCursor: 'c1' })

    await relinkNextBatch(supabase, { since: null })

    expect(cursorWrittenTo(supabase)).toBe('c2')
  })

  it('setzt den Cursor auf null, wenn nichts mehr offen ist', async () => {
    // Sonst wuerde der naechste Lauf mitten im Bestand weitermachen statt von
    // vorn zu pruefen.
    mocks.backfill.mockResolvedValue({ linked: [], unchanged: 3, remaining: 0, cursor: 'c9' })
    const { relinkNextBatch } = await import('@/lib/glossary/crawl')
    const supabase = makeSupabaseWithCrawlState({ relinkCursor: 'c1' })

    await relinkNextBatch(supabase, { since: null })

    expect(cursorWrittenTo(supabase)).toBeNull()
  })

  it('wirft, wenn die Begriffsliste nicht ladbar ist', async () => {
    // Ohne Begriffe wuerde der Lauf jeden Artikel als "nichts zu verlinken"
    // abhaken und den Bestand stillschweigend durchbrennen.
    mocks.matcherTerms.mockResolvedValue(null)
    const { relinkNextBatch } = await import('@/lib/glossary/crawl')
    const supabase = makeSupabaseWithCrawlState({ relinkCursor: null })

    await expect(relinkNextBatch(supabase, { since: null })).rejects.toThrow(/Begriffsliste/)
  })
})
```

Dazu die beiden Helfer oben in der Datei (nach den Mocks):

```typescript
/** Minimaler Supabase-Doppelgaenger: nur der Crawl-State wird gelesen/geschrieben. */
function makeSupabaseWithCrawlState(state: { relinkCursor: string | null }) {
  const writes: Array<Record<string, unknown>> = []
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: { state: { relinkCursor: state.relinkCursor, candidates: {}, generated: [], excluded: [] } }, error: null }),
    single: async () => ({ data: null, error: null }),
    update: (payload: Record<string, unknown>) => { writes.push(payload); return chain },
    upsert: (payload: Record<string, unknown>) => { writes.push(payload); return chain },
    insert: () => chain,
    then: (res: (v: unknown) => void) => res({ data: null, error: null }),
  }
  return { from: () => chain, __writes: writes } as any
}

/** Der zuletzt geschriebene relinkCursor, egal ob update oder upsert. */
function cursorWrittenTo(supabase: any): string | null | undefined {
  for (const w of [...supabase.__writes].reverse()) {
    const s = (w.state ?? w) as Record<string, unknown>
    if ('relinkCursor' in s) return s.relinkCursor as string | null
  }
  return undefined
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/lib/glossary-relink-batch.test.ts`
Expected: FAIL — `relinkNextBatch is not a function`

- [ ] **Step 3: Funktion in `lib/glossary/crawl.ts` anlegen**

```typescript
/**
 * Ein Nachverlinkungs-Durchgang ueber den Bestand.
 *
 * Buendelt, was bisher inline im Route-Zweig action=relink stand
 * (glossary-crawl/route.ts:117-141): Begriffe laden, reservierte Namen bauen,
 * Cursor lesen und zurueckschreiben. Die Verlinkung selbst steckte schon in
 * backfillGlossaryLinks — erreichbar war sie vom Cron aber nicht, und genau das
 * braucht der servergetriebene Lauf.
 *
 * @param since UNTERE Zeitgrenze ("verlinke Artikel AB diesem Tag"), wie im
 *   Panel. null heisst: der ganze Bestand.
 */
export async function relinkNextBatch(
  supabase: AdminClient,
  opts: { since?: string | null } = {},
): Promise<BackfillResult> {
  const terms = await getMatcherTerms('de')
  if (terms === null) {
    // Harter Fehler statt leerer Liste: mit null Begriffen wuerde jeder Artikel
    // als "nichts zu verlinken" abgehakt und der Cursor durch den ganzen
    // Bestand laufen, ohne etwas zu tun.
    throw new Error('Begriffsliste nicht ladbar — Nachverlinkung abgebrochen')
  }
  const reserved = buildReservedNames(await getChartProductNames())
  const state = await readCrawlState(supabase)

  const result = await backfillGlossaryLinks(
    supabase, terms, reserved, state.relinkCursor ?? null, undefined, opts.since ?? null,
  )
  // remaining === 0 setzt den Cursor zurueck, damit der naechste Lauf wieder
  // von vorn prueft statt mitten im Bestand aufzusetzen.
  await writeRelinkCursor(supabase, result.remaining === 0 ? null : result.cursor)
  return result
}
```

Nötige Ergänzungen im Kopf von `crawl.ts` (falls nicht vorhanden):

```typescript
import { backfillGlossaryLinks, type BackfillResult } from '@/lib/glossary/backfill'
import { getMatcherTerms, buildReservedNames, getChartProductNames } from '@/lib/glossary/terms'
```

- [ ] **Step 4: Route-Zweig auf die Funktion umstellen**

`app/api/admin/glossary-crawl/route.ts`, Zweig `action === 'relink'` ersetzen durch:

```typescript
    if (action === 'relink') {
      // `from` ist die UNTERE Grenze: "verlinke Artikel AB diesem Tag". Auf
      // 00:00 gesetzt, damit der Tag selbst vollstaendig dabei ist.
      const from = request.nextUrl.searchParams.get('from')
      const since = from ? `${from}T00:00:00.000Z` : null
      try {
        const result = await relinkNextBatch(supabase, { since })
        return NextResponse.json(result)
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'Nachverlinkung fehlgeschlagen' },
          { status: 503 },
        )
      }
    }
```

Import ergänzen, nicht mehr benötigte Importe (`backfillGlossaryLinks`, `getMatcherTerms`, `buildReservedNames`, `getChartProductNames`, `writeRelinkCursor`) entfernen — **nur wenn kein anderer Zweig der Datei sie noch nutzt.** Prüfen mit:

Run: `grep -n "backfillGlossaryLinks\|getMatcherTerms\|buildReservedNames\|getChartProductNames\|writeRelinkCursor" app/api/admin/glossary-crawl/route.ts`

- [ ] **Step 5: Tests und Typecheck**

Run: `npx vitest run tests/lib/glossary-relink-batch.test.ts && npx tsc --noEmit`
Expected: PASS (4 Tests), tsc ohne Ausgabe

- [ ] **Step 6: Commit**

```bash
git add lib/glossary/crawl.ts app/api/admin/glossary-crawl/route.ts tests/lib/glossary-relink-batch.test.ts
git commit -m "refactor(lexikon): relink-Orchestrierung als relinkNextBatch

Die Verlinkungsarbeit lag schon in backfillGlossaryLinks, die Orchestrierung
drumherum (Begriffe, reservierte Namen, Cursor) aber inline im Route-Zweig und
war vom Cron nicht erreichbar. Route und Cron rufen jetzt dieselbe Funktion."
```

---

### Task 4: Cron-Route mit Zeitbudget

**Files:**
- Create: `lib/glossary/jobs/advance.ts`
- Create: `app/api/cron/glossary-jobs/route.ts`
- Modify: `vercel.json` (Cron-Eintrag)
- Test: `tests/lib/glossary-jobs-advance.test.ts`

**Interfaces:**
- Consumes: Service aus Task 1+2, `generateCandidates(supabase, limit) => Promise<GenerationResult>` mit `GenerationResult = { generated: Array<{name,slug,mentions}>; failed: string[]; retryable: string[]; alreadyExisting: string[] }`, `generateMissingIllustrations(supabase) => Promise<{ done: string[]; failed: string[]; remaining: number }>`, `relinkNextBatch` aus Task 3
- Produces: `advanceJob(supabase: AdminClient, job: GlossaryJob, opts?: { now?: () => number; budgetMs?: number }): Promise<{ units: number; finished: boolean }>`

- [ ] **Step 1: Failing tests schreiben**

```typescript
// tests/lib/glossary-jobs-advance.test.ts
/**
 * Ein Cron-Tick arbeitet Einheiten ab, bis das Zeitbudget aufgebraucht ist.
 *
 * Die erste Einheit laeuft immer: fuer sie gibt es noch keinen Messwert, und
 * die belegte Obergrenze (270s, glossary-crawl/route.ts:154) bleibt unter
 * maxDuration=300. Jede weitere nur, wenn die Restzeit fuer die bisher
 * langsamste Einheit dieses Ticks reicht.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  images: vi.fn(),
  relink: vi.fn(),
  appendLog: vi.fn(),
  finishJob: vi.fn(),
  setAttempts: vi.fn(),
  stampLease: vi.fn(),
}))

vi.mock('@/lib/glossary/crawl', () => ({
  generateCandidates: mocks.generate,
  generateMissingIllustrations: mocks.images,
  relinkNextBatch: mocks.relink,
}))
vi.mock('@/lib/glossary/jobs/service', () => ({
  appendLog: mocks.appendLog,
  finishJob: mocks.finishJob,
  setAttempts: mocks.setAttempts,
  stampLease: mocks.stampLease,
}))

const client = {} as any
const JOB = {
  id: 'j1', kind: 'generate' as const, status: 'processing' as const, total: 10,
  done_count: 0, log: [], cancel_requested: false, last_advanced_at: null,
  attempts: 0, params: {}, error_message: null, created_at: '', finished_at: null,
}

beforeEach(() => vi.clearAllMocks())

/**
 * Uhr, die NUR voranspringt, wenn Arbeit getan wurde — nicht bei jedem
 * now()-Aufruf.
 *
 * Das ist wesentlich: advanceJob liest die Uhr mehrfach je Runde (Budget-Check,
 * Start der Einheit, Ende der Einheit). Eine Uhr, die bei jedem Lesen springt,
 * würde Zeit erfinden, die niemand verbraucht hat, und das Budget wäre nach
 * zwei Runden scheinbar aufgebraucht. `advance` wird deshalb von den
 * Fachfunktions-Mocks aufgerufen.
 */
function workClock(stepMs: number) {
  let t = 0
  return { now: () => t, advance: () => { t += stepMs } }
}

/** Ein Ergebnis, bei dem ein Begriff erzeugt wurde und weitere offen sind. */
const ONE_GENERATED = {
  generated: [{ name: 'Transformer', slug: 't', mentions: 3 }],
  failed: [] as string[], retryable: [] as string[], alreadyExisting: [] as string[],
}

describe('advanceJob (generate)', () => {
  it('arbeitet mehrere Einheiten, solange das Budget reicht', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    // 60s je Einheit, 240s Budget → vier Einheiten passen hinein.
    const clock = workClock(60_000)
    mocks.generate.mockImplementation(async () => { clock.advance(); return ONE_GENERATED })

    const res = await advanceJob(client, { ...JOB }, { now: clock.now, budgetMs: 240_000 })

    expect(res.units).toBe(4)
    expect(mocks.generate).toHaveBeenCalledWith(client, 1)
  })

  it('laesst die erste Einheit immer laufen, auch bei knappem Budget', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    // Eine Einheit verbraucht mehr als das ganze Budget. Sie muss trotzdem
    // laufen, sonst kaeme der Job nie voran.
    const clock = workClock(300_000)
    mocks.generate.mockImplementation(async () => { clock.advance(); return ONE_GENERATED })

    const res = await advanceJob(client, { ...JOB }, { now: clock.now, budgetMs: 240_000 })

    expect(res.units).toBe(1)
    expect(res.finished).toBe(false)
  })

  it('beendet den Job, wenn nichts mehr offen ist', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.generate.mockImplementation(async () => {
      clock.advance()
      return { generated: [], failed: [], retryable: [], alreadyExisting: [] }
    })

    const res = await advanceJob(client, { ...JOB }, { now: clock.now, budgetMs: 240_000 })

    expect(res.finished).toBe(true)
    expect(mocks.finishJob).toHaveBeenCalledWith(client, 'j1', 'done')
  })

  it('eskaliert nach zehn erfolglosen Durchgaengen zu error', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.generate.mockImplementation(async () => {
      clock.advance()
      return { generated: [], failed: [], retryable: ['Transformer'], alreadyExisting: [] }
    })

    const res = await advanceJob(client, { ...JOB, attempts: 9 }, { now: clock.now, budgetMs: 240_000 })

    expect(res.finished).toBe(true)
    expect(mocks.finishJob).toHaveBeenCalledWith(
      client, 'j1', 'error', expect.stringContaining('überlastet'),
    )
  })

  it('bleibt bei Ueberlast unter zehn Versuchen offen und beendet nur den Tick', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.generate.mockImplementation(async () => {
      clock.advance()
      return { generated: [], failed: [], retryable: ['Transformer'], alreadyExisting: [] }
    })

    const res = await advanceJob(client, { ...JOB, attempts: 2 }, { now: clock.now, budgetMs: 240_000 })

    expect(res.finished).toBe(false)
    expect(mocks.setAttempts).toHaveBeenCalledWith(client, 'j1', 3)
    expect(mocks.finishJob).not.toHaveBeenCalled()
  })

  it('bricht bei cancel_requested ab, ohne zu arbeiten', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)

    const res = await advanceJob(
      client, { ...JOB, cancel_requested: true }, { now: clock.now, budgetMs: 240_000 },
    )

    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.finishJob).toHaveBeenCalledWith(client, 'j1', 'cancelled')
  })
})

describe('advanceJob (images, relink)', () => {
  it('ruft fuer images generateMissingIllustrations und endet bei remaining 0', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.images.mockImplementation(async () => {
      clock.advance()
      return { done: ['a'], failed: [], remaining: 0 }
    })

    const res = await advanceJob(
      client, { ...JOB, kind: 'images' }, { now: clock.now, budgetMs: 240_000 },
    )

    expect(mocks.images).toHaveBeenCalledWith(client)
    expect(res.finished).toBe(true)
  })

  it('reicht bei relink das since aus params durch', async () => {
    const { advanceJob } = await import('@/lib/glossary/jobs/advance')
    const clock = workClock(1000)
    mocks.relink.mockImplementation(async () => {
      clock.advance()
      return { linked: ['p'], unchanged: 1, remaining: 0, cursor: null }
    })

    await advanceJob(
      client,
      { ...JOB, kind: 'relink', params: { since: '2020-01-01T00:00:00.000Z' } },
      { now: clock.now, budgetMs: 240_000 },
    )

    expect(mocks.relink).toHaveBeenCalledWith(client, { since: '2020-01-01T00:00:00.000Z' })
  })
})
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/lib/glossary-jobs-advance.test.ts`
Expected: FAIL — `Cannot find module '@/lib/glossary/jobs/advance'`

- [ ] **Step 3: `advance.ts` implementieren**

```typescript
// lib/glossary/jobs/advance.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateCandidates, generateMissingIllustrations, relinkNextBatch } from '@/lib/glossary/crawl'
import { appendLog, finishJob, setAttempts, type GlossaryJob, type GlossaryJobLogEntry } from '@/lib/glossary/jobs/service'

type AdminClient = SupabaseClient<any, any, any>

/**
 * Zeitbudget je Tick. 240s von 300s maxDuration — 60s Sicherheitsabstand, damit
 * das Schreiben des Protokolls nicht in den Timeout laeuft.
 */
const BUDGET_MS = 240_000

/**
 * Annahme fuer die Dauer der ERSTEN Einheit, fuer die es noch keinen Messwert
 * gibt. 270s ist die im Route-Kommentar belegte Obergrenze (ein Begriff mit
 * Nachforderung nach Regel 4). Die erste Einheit laeuft trotzdem immer, sonst
 * kaeme der Job nie voran; jede weitere nur bei ausreichendem Rest.
 */
const ASSUMED_FIRST_UNIT_MS = 270_000

/** Erfolglose Ticks in Folge, ab denen der Job aufgibt. */
const MAX_ATTEMPTS = 10

function stamp(): string {
  return new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

interface UnitOutcome {
  entries: GlossaryJobLogEntry[]
  /** Etwas erledigt — der Zaehler steigt um diesen Wert. */
  doneDelta: number
  /** Nichts mehr offen: der Job ist fertig. */
  exhausted: boolean
  /** Nur voruebergehend gescheitert (Modell-Ueberlast). */
  overloaded: boolean
}

async function runUnit(supabase: AdminClient, job: GlossaryJob): Promise<UnitOutcome> {
  if (job.kind === 'generate') {
    const r = await generateCandidates(supabase, 1)
    const entries: GlossaryJobLogEntry[] = [
      ...r.generated.map((g) => ({ at: stamp(), text: `${g.name} — erzeugt und veroeffentlicht`, ok: true })),
      ...r.alreadyExisting.map((n) => ({ at: stamp(), text: `${n} — gab es schon, aus der Liste genommen`, ok: true })),
      ...r.failed.map((n) => ({
        at: stamp(),
        text: r.retryable.includes(n)
          ? `${n} — Modell überlastet, bleibt in der Warteschlange`
          : `${n} — fehlgeschlagen, siehe Server-Log`,
        ok: false,
      })),
    ]
    const nothingHappened = r.generated.length === 0 && r.failed.length === 0 && r.alreadyExisting.length === 0
    return {
      entries,
      doneDelta: r.generated.length,
      exhausted: nothingHappened,
      overloaded: r.generated.length === 0 && r.retryable.length > 0,
    }
  }

  if (job.kind === 'images') {
    const r = await generateMissingIllustrations(supabase)
    return {
      entries: [
        ...r.done.map((s) => ({ at: stamp(), text: `${s} — Illustration erzeugt`, ok: true })),
        ...r.failed.map((s) => ({ at: stamp(), text: `${s} — Illustration fehlgeschlagen`, ok: false })),
      ],
      doneDelta: r.done.length,
      exhausted: r.remaining === 0,
      overloaded: false,
    }
  }

  const since = (job.params.since as string | undefined) ?? null
  const r = await relinkNextBatch(supabase, { since })
  return {
    entries: [
      ...r.linked.map((s) => ({ at: stamp(), text: `${s} — neu verlinkt`, ok: true })),
      { at: stamp(), text: `${r.unchanged} Artikel unveraendert, ${r.remaining} offen`, ok: true },
    ],
    doneDelta: r.linked.length,
    exhausted: r.remaining === 0,
    overloaded: false,
  }
}

/**
 * Arbeitet Einheiten ab, bis das Zeitbudget aufgebraucht oder nichts mehr offen
 * ist. `now` ist injizierbar, damit das Budget testbar bleibt.
 */
export async function advanceJob(
  supabase: AdminClient,
  job: GlossaryJob,
  opts: { now?: () => number; budgetMs?: number } = {},
): Promise<{ units: number; finished: boolean }> {
  const now = opts.now ?? (() => Date.now())
  const budgetMs = opts.budgetMs ?? BUDGET_MS
  const started = now()
  let units = 0
  /**
   * Die langsamste bisher gemessene Einheit dieses Ticks. Vor der ersten Einheit
   * gibt es keinen Messwert — dort gilt die Annahme aus
   * ASSUMED_FIRST_UNIT_MS, die aber nie in die Messung eingeht.
   */
  let slowestMs = ASSUMED_FIRST_UNIT_MS

  for (;;) {
    if (job.cancel_requested) {
      await finishJob(supabase, job.id, 'cancelled')
      return { units, finished: true }
    }

    // Die erste Einheit laeuft immer; jede weitere nur, wenn die Restzeit fuer
    // die bisher langsamste reicht.
    if (units > 0) {
      const elapsed = now() - started
      if (elapsed + slowestMs > budgetMs) return { units, finished: false }
    }

    const before = now()
    const outcome = await runUnit(supabase, job)
    const tookMs = now() - before
    // Beim ersten Durchgang die Annahme durch den echten Messwert ERSETZEN,
    // danach das Maximum halten. Ohne das Ersetzen bliebe die 270s-Annahme fuer
    // immer die Untergrenze und nach der ersten Einheit waere immer Schluss.
    slowestMs = units === 0 ? tookMs : Math.max(slowestMs, tookMs)
    units++

    if (outcome.entries.length > 0 || outcome.doneDelta > 0) {
      await appendLog(supabase, job, outcome.entries, outcome.doneDelta)
    }

    if (outcome.overloaded) {
      const attempts = job.attempts + 1
      if (attempts >= MAX_ATTEMPTS) {
        await finishJob(
          supabase, job.id, 'error',
          `Modell dauerhaft überlastet — nach ${MAX_ATTEMPTS} erfolglosen Durchgaengen aufgegeben. `
          + 'Die Begriffe bleiben in der Warteschlange, ein neuer Lauf setzt fort.',
        )
        return { units, finished: true }
      }
      await setAttempts(supabase, job.id, attempts)
      // Tick beenden statt sofort erneut zu versuchen: der naechste Cron
      // kommt in einer Minute, das ist die Wartezeit.
      return { units, finished: false }
    }

    if (job.attempts > 0) await setAttempts(supabase, job.id, 0)

    if (outcome.exhausted) {
      await finishJob(supabase, job.id, 'done')
      return { units, finished: true }
    }
  }
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npx vitest run tests/lib/glossary-jobs-advance.test.ts`
Expected: PASS (8 Tests)

- [ ] **Step 5: Cron-Route anlegen**

```typescript
// app/api/cron/glossary-jobs/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getNextOpenJob, stampLease } from '@/lib/glossary/jobs/service'
import { advanceJob } from '@/lib/glossary/jobs/advance'

export const maxDuration = 300

/**
 * Treibt die Lexikonlaeufe. Vorher trieb sie der Browser in for(;;)-Schleifen,
 * was den Fortschritt an einen aktiven Tab band: bei einem Lauf am 2026-08-05
 * stand der Lauf 80 Minuten, obwohl der Server nach 12s fertig war.
 *
 * Immer 200, auch wenn nichts zu tun ist — wie die uebrigen Cron-Routen dieses
 * Projekts, damit Vercel den Job nicht als fehlgeschlagen fuehrt.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const job = await getNextOpenJob(supabase)
  if (!job) return NextResponse.json({ ok: true, idle: true })

  await stampLease(supabase, job.id)

  try {
    const result = await advanceJob(supabase, job)
    return NextResponse.json({ ok: true, kind: job.kind, ...result })
  } catch (err) {
    // Nicht als Job-Fehler abhaken: ein einzelner geplatzter Tick ist normal
    // (Netz, Timeout). Das Lease laeuft ab, der naechste Cron nimmt den Job
    // wieder auf — jede Einheit ist atomar.
    console.error('[GlossaryJobs] Tick fehlgeschlagen:', err)
    return NextResponse.json({ ok: true, error: err instanceof Error ? err.message : 'unbekannt' })
  }
}
```

- [ ] **Step 6: Cron in `vercel.json` eintragen**

Den Eintrag in das `crons`-Array aufnehmen:

```json
  {
    "path": "/api/cron/glossary-jobs",
    "schedule": "*/1 * * * *"
  }
```

- [ ] **Step 7: Typecheck, volle Suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc ohne Ausgabe, alle Tests grün

- [ ] **Step 8: Commit**

```bash
git add lib/glossary/jobs/advance.ts app/api/cron/glossary-jobs/route.ts vercel.json tests/lib/glossary-jobs-advance.test.ts
git commit -m "feat(lexikon): Minutentakt-Cron treibt die Lexikonlaeufe

Ein Tick arbeitet Einheiten ab, bis 240s von 300s verbraucht sind. Die erste
Einheit laeuft immer (fuer sie gibt es keinen Messwert, Obergrenze 270s), jede
weitere nur bei ausreichendem Rest. Bei Modell-Ueberlast endet der Tick und der
naechste Cron versucht es in einer Minute; nach zehn erfolglosen Durchgaengen
gibt der Job auf."
```

---

### Task 5: Admin-API für Anlegen, Lesen, Abbrechen

**Files:**
- Create: `app/api/admin/glossary-jobs/route.ts`
- Test: `tests/api/glossary-jobs-route.test.ts`

**Interfaces:**
- Consumes: `createOrGetJob`, `getJobStatus`, `requestCancel` aus Task 1+2, `getSession` aus `@/lib/auth/session`
- Produces: HTTP-Schnittstelle — `POST {kind, params?}` → `{ job }`, `GET ?kind=…` → `{ job: GlossaryJob | null }`, `PATCH {kind}` → `{ ok: true }`

- [ ] **Step 1: Failing test schreiben**

```typescript
// tests/api/glossary-jobs-route.test.ts
/**
 * Admin-Schnittstelle der Lexikon-Jobs. Der Browser darf hier nur anlegen,
 * lesen und abbrechen — getrieben wird der Lauf vom Cron.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  createOrGet: vi.fn(),
  status: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.session }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/glossary/jobs/service', () => ({
  createOrGetJob: mocks.createOrGet,
  getJobStatus: mocks.status,
  requestCancel: mocks.cancel,
}))

function req(body?: unknown, url = 'https://x/api/admin/glossary-jobs') {
  return new Request(url, {
    method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'content-type': 'application/json' },
  }) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: 'admin' })
})

describe('POST /api/admin/glossary-jobs', () => {
  it('lehnt ohne Session mit 401 ab', async () => {
    mocks.session.mockResolvedValue(null)
    const { POST } = await import('@/app/api/admin/glossary-jobs/route')

    const res = await POST(req({ kind: 'generate' }))

    expect(res.status).toBe(401)
    expect(mocks.createOrGet).not.toHaveBeenCalled()
  })

  it('weist eine unbekannte Art ab', async () => {
    const { POST } = await import('@/app/api/admin/glossary-jobs/route')

    const res = await POST(req({ kind: 'unsinn' }))

    expect(res.status).toBe(400)
  })

  it('legt einen Job an', async () => {
    mocks.createOrGet.mockResolvedValue({ id: 'j1', kind: 'generate', status: 'pending' })
    const { POST } = await import('@/app/api/admin/glossary-jobs/route')

    const res = await POST(req({ kind: 'generate' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.job.id).toBe('j1')
  })

  it('reicht since fuer relink als params durch', async () => {
    mocks.createOrGet.mockResolvedValue({ id: 'j2', kind: 'relink', status: 'pending' })
    const { POST } = await import('@/app/api/admin/glossary-jobs/route')

    await POST(req({ kind: 'relink', from: '2020-01-01' }))

    expect(mocks.createOrGet).toHaveBeenCalledWith(
      expect.anything(), 'relink', { since: '2020-01-01T00:00:00.000Z' },
    )
  })
})

describe('GET /api/admin/glossary-jobs', () => {
  it('liefert den Status der angefragten Art', async () => {
    mocks.status.mockResolvedValue({ id: 'j1', kind: 'images', status: 'processing' })
    const { GET } = await import('@/app/api/admin/glossary-jobs/route')

    const res = await GET(req(undefined, 'https://x/api/admin/glossary-jobs?kind=images'))
    const body = await res.json()

    expect(body.job.status).toBe('processing')
    expect(mocks.status).toHaveBeenCalledWith(expect.anything(), 'images')
  })
})
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npx vitest run tests/api/glossary-jobs-route.test.ts`
Expected: FAIL — Modul nicht gefunden

- [ ] **Step 3: Route implementieren**

```typescript
// app/api/admin/glossary-jobs/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  createOrGetJob, getJobStatus, requestCancel, type GlossaryJobKind,
} from '@/lib/glossary/jobs/service'

export const maxDuration = 60

const KINDS: GlossaryJobKind[] = ['generate', 'images', 'relink']

function parseKind(value: unknown): GlossaryJobKind | null {
  return KINDS.includes(value as GlossaryJobKind) ? (value as GlossaryJobKind) : null
}

/** Legt einen Lauf an — oder liefert den bereits offenen derselben Art. */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const kind = parseKind(body?.kind)
  if (!kind) return NextResponse.json({ error: 'Unbekannte Lauf-Art' }, { status: 400 })

  // `from` kommt aus dem Panel als Tagesdatum und ist die UNTERE Grenze.
  const params = kind === 'relink' && body?.from
    ? { since: `${body.from}T00:00:00.000Z` }
    : {}

  try {
    const job = await createOrGetJob(createAdminClient(), kind, params)
    return NextResponse.json({ job })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Job nicht anlegbar' },
      { status: 500 },
    )
  }
}

/** Lesepfad fuer das Polling im Panel. */
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const kind = parseKind(request.nextUrl.searchParams.get('kind'))
  if (!kind) return NextResponse.json({ error: 'Unbekannte Lauf-Art' }, { status: 400 })

  const job = await getJobStatus(createAdminClient(), kind)
  return NextResponse.json({ job })
}

/** Abbruchwunsch; der naechste Cron-Tick wertet ihn aus. */
export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const kind = parseKind(body?.kind)
  if (!kind) return NextResponse.json({ error: 'Unbekannte Lauf-Art' }, { status: 400 })

  await requestCancel(createAdminClient(), kind)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Tests und Typecheck**

Run: `npx vitest run tests/api/glossary-jobs-route.test.ts && npx tsc --noEmit`
Expected: PASS (5 Tests), tsc ohne Ausgabe

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/glossary-jobs/route.ts tests/api/glossary-jobs-route.test.ts
git commit -m "feat(lexikon): Admin-API fuer Lexikon-Jobs

POST legt an (idempotent), GET liest den Status fuer das Polling, PATCH merkt
einen Abbruchwunsch an. Kein Treiben mehr im Browser."
```

---

### Task 6: Panel auf Anzeige umbauen

**Files:**
- Modify: `components/admin/glossary-crawl-panel.tsx` (die drei `for(;;)`-Schleifen bei :111, :181, :307 entfernen)

**Interfaces:**
- Consumes: die HTTP-Schnittstelle aus Task 5
- Produces: nichts für spätere Tasks

- [ ] **Step 1: Polling-Hook ergänzen**

Oberhalb der Komponente einfügen:

```typescript
type JobKind = 'generate' | 'images' | 'relink'

interface JobView {
  status: 'pending' | 'processing' | 'done' | 'error' | 'cancelled'
  total: number | null
  done_count: number
  log: Array<{ at: string; text: string; ok: boolean }>
  error_message: string | null
}

/**
 * Liest den Job-Status, solange ein Lauf offen ist.
 *
 * Der Browser TREIBT NICHTS mehr — er zeigt nur. Dieses Polling darf gedrosselt
 * werden, ohne dass ein Lauf langsamer wird: den treibt der Minutentakt-Cron.
 * Genau das war vorher das Problem, als drei for(;;)-Schleifen den Fortschritt
 * an einen aktiven Tab banden.
 */
function useJob(kind: JobKind) {
  const [job, setJob] = useState<JobView | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/glossary-jobs?kind=${kind}`, { credentials: 'include' })
    if (!res.ok) return
    const data = await res.json().catch(() => null)
    setJob(data?.job ?? null)
  }, [kind])

  useEffect(() => {
    void load()
    const open = job?.status === 'pending' || job?.status === 'processing'
    if (!open) return
    const t = setInterval(() => { void load() }, 5000)
    return () => clearInterval(t)
  }, [load, job?.status])

  return { job, reload: load }
}
```

`useCallback` zum React-Import der Datei ergänzen.

- [ ] **Step 2: `runAllTerms` durch das Anlegen eines Jobs ersetzen**

Die gesamte Funktion (`:169–274`) ersetzen durch:

```typescript
  /**
   * Stoesst den Begriffslauf an. Fruehere Fassung trieb ihn hier in einer
   * for(;;)-Schleife, um maxDuration=300 zu umgehen — der Fortschritt hing
   * damit am aktiven Tab. Gemessen: der Server war bei "Provenienz" um 14:05:51
   * fertig, das UI zeigte den Begriff um 15:25:58.
   */
  async function startTermsJob() {
    setBusy('generate-all')
    setError(null)
    try {
      const res = await fetch('/api/admin/glossary-jobs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'generate' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `Fehlgeschlagen (HTTP ${res.status})`)
      await termsJob.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehlgeschlagen')
    } finally {
      setBusy(null)
    }
  }

  /** Abbruch; der naechste Cron-Tick wertet ihn aus. */
  async function stopJob(kind: JobKind) {
    await fetch('/api/admin/glossary-jobs', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind }),
    })
  }
```

- [ ] **Step 3: Illustrations- und Relink-Schleifen ersetzen**

Die `for (let round = 1; ; round++)`-Schleife bei `:111` (Illustrationen) und die
`for (;;)`-Schleife bei `:307` (Nachverlinkung) vollständig durch diese beiden
Funktionen ersetzen:

```typescript
  /** Stoesst den Illustrationslauf an. Vorher lief er in Runden im Browser. */
  async function startImagesJob() {
    setBusy('images')
    setError(null)
    try {
      const res = await fetch('/api/admin/glossary-jobs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'images' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `Fehlgeschlagen (HTTP ${res.status})`)
      await imagesJob.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehlgeschlagen')
    } finally {
      setBusy(null)
    }
  }

  /**
   * Stoesst die Nachverlinkung an. `relinkFrom` ist die UNTERE Datumsgrenze
   * ("verlinke Artikel AB diesem Tag") und wandert als params.since in den Job.
   */
  async function startRelinkJob() {
    setBusy('relink')
    setError(null)
    try {
      const res = await fetch('/api/admin/glossary-jobs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'relink', from: relinkFrom }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `Fehlgeschlagen (HTTP ${res.status})`)
      await relinkJob.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehlgeschlagen')
    } finally {
      setBusy(null)
    }
  }
```

Die drei Hooks am Anfang der Komponente anlegen und die Knöpfe umhängen:

```typescript
  const termsJob = useJob('generate')
  const imagesJob = useJob('images')
  const relinkJob = useJob('relink')
```

`onClick`-Handler: `runAllTerms` → `startTermsJob`, der Illustrations-Dauerlauf →
`startImagesJob`, der Relink-Dauerlauf → `startRelinkJob`. Die Stop-Knöpfe rufen
`stopJob('generate' | 'images' | 'relink')`.

- [ ] **Step 4: Anzeige auf `job` umstellen**

Protokoll und Fortschritt aus dem Job rendern statt aus dem lokalen `log`-State:

```tsx
{termsJob.job && (
  <div className="rounded border border-border p-3">
    <div className="mb-2 font-mono text-xs">
      {termsJob.job.status === 'processing' || termsJob.job.status === 'pending'
        ? `In Arbeit — ${termsJob.job.done_count}${termsJob.job.total !== null ? ` von ${termsJob.job.total}` : ''}`
        : termsJob.job.status === 'done'
          ? `Fertig — ${termsJob.job.done_count} Begriffe erzeugt.`
          : termsJob.job.status === 'cancelled'
            ? `Abgebrochen nach ${termsJob.job.done_count} Begriffen.`
            : termsJob.job.error_message}
    </div>
    <ul className="space-y-0.5 font-mono text-[11px]">
      {termsJob.job.log.map((l, i) => (
        <li key={i} className={l.ok ? '' : 'text-destructive'}>
          <span className="text-muted-foreground">{l.at}</span> {l.ok ? '✓' : '✗'} {l.text}
        </li>
      ))}
    </ul>
  </div>
)}
```

Der lokale `log`-State und `stopRequested` entfallen, sofern kein anderer Zweig sie nutzt. Prüfen mit:

Run: `grep -n "setLog\|stopRequested\|useState<.*log" components/admin/glossary-crawl-panel.tsx`

- [ ] **Step 5: Typecheck und Build**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc ohne Ausgabe, Build exit 0

Vor dem Build `.next` wegschieben, weil Dropbox Dateien hält und `rm -rf .next` mit `ENOTEMPTY` scheitert:

```bash
[ -d .next ] && mv .next "$TMPDIR/next-old-$$"
```

- [ ] **Step 6: Commit**

```bash
git add components/admin/glossary-crawl-panel.tsx
git commit -m "refactor(lexikon): Panel zeigt nur noch Fortschritt

Die drei for(;;)-Schleifen sind weg. Ein Klick legt einen Job an, das Panel
pollt dessen Status alle 5s. Tab schliessen ist folgenlos, und weil das
Protokoll in der DB steht, ist es nach einem Neuladen noch da."
```

---

### Task 7: Migration anwenden und auf Prod verifizieren

**Files:** keine

- [ ] **Step 1: Migration gegen Prod anwenden**

```bash
npx supabase db push
```

Erwartung: `glossary_jobs` angelegt. Prüfen, dass der partielle Index existiert:

```bash
npx supabase db push --dry-run   # vorher, zeigt was laufen wuerde
```

- [ ] **Step 2: Doppelstart-Schutz prüfen**

Zwei Inserts derselben Art gegen Prod; der zweite muss mit `23505` scheitern. Env vorher ziehen (`vercel env pull --environment=production <pfad>`), Keys danach löschen.

- [ ] **Step 3: Deployen und Cron-Registrierung prüfen**

```bash
git push origin main
```

Nach dem Deploy im Vercel-Dashboard prüfen, dass `/api/cron/glossary-jobs` als Cron mit `*/1 * * * *` geführt wird. **Inhaltlich** verifizieren, nicht über den `dpl`-Parameter — ein `dpl`-Wechsel kann von einem fremden Deploy stammen:

```bash
curl -s https://www.synthszr.com/de/glossary/transformer | grep -c "api/languages"
```

- [ ] **Step 4: Echten Lauf prüfen — der Kern der Sache**

Im Admin einen `generate`-Lauf anstoßen, **Tab schließen**, 10 Minuten warten. Dann die serverseitigen Zeitstempel prüfen:

```sql
select canonical_name, created_at
from glossary_terms
order by created_at desc
limit 10;
```

Erwartung: Abstände bei ~110 s, **ohne Lücken** — das ist die Gegenprobe zu den gemessenen 715 s / 4889 s / 670 s.

- [ ] **Step 5: Protokoll nach Neuladen prüfen**

Panel neu öffnen. Erwartung: der laufende Job erscheint mit vollem Protokoll, ohne dass jemand den Lauf angestoßen haben muss.

- [ ] **Step 6: Abbruch prüfen**

Stop drücken, einen Minutentick abwarten. Erwartung: `status = 'cancelled'`, keine weiteren Begriffe.
