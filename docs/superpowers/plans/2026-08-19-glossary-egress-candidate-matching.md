# Gezielte Begriffs-Kandidatensuche (Glossar-Egress) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den Egress-Beitrag der Begriffsseite (`app/[lang]/glossary/[slug]/page.tsx`) strukturell von der Katalog-Größe entkoppeln, indem das Text-Matching gegen den Erklärtext eines Begriffs nur noch die tatsächlich in Frage kommenden Kandidaten überträgt, statt bei jedem Rendern alle veröffentlichten Begriffe zu laden.

**Architecture:** Eine neue Postgres-RPC (`find_glossary_candidate_terms`) filtert serverseitig auf Begriffe, deren kanonischer Name oder Alias als Teilstring im übergebenen Text vorkommt — derselbe verlustfreie Vorfilter, den `lib/glossary/mentions.ts` (`matchNameInText`) ohnehin schon clientseitig anwendet, nur jetzt VOR der Übertragung. `lib/glossary/detail.ts` (`linkRelatedTerms`) ruft diese RPC über eine neue, schmale Funktion `findCandidateMatcherTerms` auf, statt `getMatcherTerms(lang)` (Voll-Katalog-Fetch) zu nutzen. Die exakte Matching-Logik (`findGlossaryMentions`) bleibt unverändert und entscheidet weiterhin endgültig, was als Treffer zählt — sie bekommt nur eine kleinere Kandidatenmenge zu prüfen.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres + PostgREST), Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-19-glossary-egress-candidate-matching-design.md`

## Global Constraints

- Migrationen werden NICHT über die Supabase-CLI angewendet (lokal/remote strukturell auseinander, service_role kann kein DDL) — die SQL-Datei muss von Hand im Supabase-Dashboard-SQL-Editor ausgeführt werden. Jede Migration muss deshalb VOLLSTÄNDIG ausführbar sein (CREATE + REVOKE/GRANT in einer Datei) und eine Verifikations-Query am Ende enthalten.
- Jede neue `public`-Funktion pinnt `search_path` (`set search_path = pg_catalog, public`) und nutzt `security invoker` — SEC-017-Konvention dieses Projekts, keine Ausnahme.
- Neue RPCs: `revoke all ... from public/anon/authenticated`, `grant execute ... to service_role` — gleiches Muster wie `match_glossary_related_terms`.
- Die RPC muss eine ECHTE OBERMENGE dessen liefern, was `findGlossaryMentions`/`matchNameInText` als Treffer akzeptieren würde. Lieber ein paar überflüssige Kandidaten als einen fälschlich ausgeschlossenen Begriff.
- Kein Trigram-/GIN-Index — das Zugriffsmuster (kurzer Name als Teilstring eines Textes) profitiert davon nicht (s. Spec, Abschnitt „Entscheidung").
- `getMatcherTerms`, `getPublishedTermList`, `getChartProductNames` (`lib/glossary/terms.ts`) bleiben unverändert bestehen — sie werden weiterhin von den Schreibpfaden (`confirm.ts`, `crawl.ts`, `translate.ts`, `jobs/advance.ts`, `article-jobs/service.ts`) genutzt, die nicht Teil dieses Plans sind.

---

## File Structure

- **Create:** `supabase/migrations/20260819140000_glossary_candidate_terms_rpc.sql` — neue RPC `find_glossary_candidate_terms`.
- **Create:** `lib/glossary/candidate-terms.ts` — `findCandidateMatcherTerms(bodyText, lang)`, ruft die RPC auf und bildet die Zeilen auf `GlossaryMatcherTerm` ab. Eigene Datei statt Ergänzung in `lib/glossary/terms.ts`: andere Verantwortung (EIN Text gegen den Katalog statt „der ganze Katalog"), anderer Aufrufer (nur `detail.ts`, nicht die Schreibpfade).
- **Create:** `tests/lib/glossary-candidate-terms.test.ts` — Unit-Tests für `findCandidateMatcherTerms` (RPC-Aufrufparameter, Zeilen-Mapping, Fehler-Degradierung).
- **Modify:** `lib/glossary/detail.ts:186-234` (`linkRelatedTerms`) — nutzt `findCandidateMatcherTerms` statt `getMatcherTerms`.
- **Modify:** `tests/lib/glossary-detail.test.ts` — die 7 Tests in `describe('getGlossaryTerm — verwandte Begriffe', ...)` (Zeilen ~175-249) auf die neue RPC umgestellt; `beforeEach` bekommt einen namens-dispatchenden `rpcMock`, weil `linkRelatedTerms` jetzt ZWEI verschiedene RPCs aufruft (`find_glossary_candidate_terms` und die bestehende `match_glossary_related_terms`). Alle anderen describe-Blöcke in dieser Datei sind unberührt (sie nutzen `getMatcherTerms` nie mit einer nicht-leeren Kandidatenliste).

---

## Task 1: Postgres-RPC `find_glossary_candidate_terms`

**Files:**
- Create: `supabase/migrations/20260819140000_glossary_candidate_terms_rpc.sql`

**Interfaces:**
- Produces: RPC `public.find_glossary_candidate_terms(body_text text, target_lang text default 'de', result_limit int default 300) returns table (slug text, canonical_name text, aliases text[])` — von Task 2 aus per `supabase.rpc('find_glossary_candidate_terms', { body_text, target_lang })` aufgerufen.

- [ ] **Step 1: Migration schreiben**

```sql
-- Begriffs-Kandidaten für EINEN Text statt des ganzen Katalogs.
-- KOMPLETTE DATEI ausführen (CREATE FUNCTION + REVOKE/GRANT), nicht nur die
-- abschließenden Verifikations-Queries — sonst zeigt die Verifikation
-- "false" statt eines funktionierenden Zustands (gleicher Hinweis wie bei
-- 20260804120000_glossary_related_terms_rpc.sql).
--
-- WARUM: lib/glossary/detail.ts (linkRelatedTerms) lud bisher über
-- getMatcherTerms() bei JEDEM Rendern einer Begriffsseite den kompletten
-- veröffentlichten Katalog (2171 Zeilen, Stand 2026-08-19), nur um ihn gegen
-- den Erklärtext EINES Begriffs zu matchen. Gemessen
-- (lib/glossary/mentions.ts, PROD-BEFUND 2026-08-12): von 2527 Begriffen mit
-- 16.398 Namen/Aliassen kommen im Schnitt 17 tatsächlich im Text vor. Diese
-- RPC verlagert den Vorfilter, den matchNameInText ohnehin schon anwendet
-- (text.includes(name)), nach Postgres — dort kostet der Vergleich nichts
-- (Egress zählt nur übertragene Zeilen), und nur die echten Kandidaten
-- verlassen die Datenbank.
--
-- SICHERHEITSEIGENSCHAFT: bewusst GROSSZÜGIGER als der exakte JS-Matcher
-- (keine Abkürzungs-Sonderregel, kein Kompositum-/Flexions-Check) — darf nie
-- einen Begriff ausschliessen, den findGlossaryMentions/matchNameInText
-- hinterher als Treffer werten würde. Ein paar zusätzliche, später
-- verworfene Kandidaten sind harmlos; ein fälschlich ausgeschlossener
-- Begriff wäre ein stiller Verlust.
--
-- KEIN INDEX: das Zugriffsmuster ist "ist dieser kurze Name Teilstring von
-- DIESEM Text", nicht die übliche Trigram-Situation ("ist dieser
-- Suchbegriff in der indizierten Spalte enthalten"). position() über ein
-- paar tausend Zeilen mit einem wenige KB grossen Text ist im
-- Millisekundenbereich.
create or replace function public.find_glossary_candidate_terms(
  body_text text,
  target_lang text default 'de',
  result_limit int default 300
)
returns table (
  slug text,
  canonical_name text,
  aliases text[]
)
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select
    gt.slug,
    coalesce(t9n.canonical_name, gt.canonical_name) as canonical_name,
    coalesce(t9n.aliases, gt.aliases, '{}'::text[]) as aliases
  from public.glossary_terms gt
  left join public.glossary_term_translations t9n
    on t9n.term_id = gt.id
   and t9n.language = target_lang
   and target_lang <> 'de'
  where gt.status = 'published'
    and (
      position(lower(coalesce(t9n.canonical_name, gt.canonical_name)) in lower(body_text)) > 0
      or exists (
        select 1
        from unnest(coalesce(t9n.aliases, gt.aliases, '{}'::text[])) as al
        where position(lower(al) in lower(body_text)) > 0
      )
    )
  limit result_limit;
$$;

revoke all on function public.find_glossary_candidate_terms(text, text, int) from public;
revoke all on function public.find_glossary_candidate_terms(text, text, int) from anon;
revoke all on function public.find_glossary_candidate_terms(text, text, int) from authenticated;
grant execute on function public.find_glossary_candidate_terms(text, text, int) to service_role;

-- Verifikation Teil 1 — ERWARTUNG: alle drei ersten Spalten true, treffer_leer = 0.
select
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'find_glossary_candidate_terms'
  ) as rpc_existiert,
  exists (
    select 1 from information_schema.routine_privileges
    where routine_name = 'find_glossary_candidate_terms' and grantee = 'service_role'
      and privilege_type = 'EXECUTE'
  ) as service_role_hat_execute,
  not exists (
    select 1 from information_schema.routine_privileges
    where routine_name = 'find_glossary_candidate_terms'
      and grantee in ('anon', 'authenticated', 'PUBLIC')
  ) as anon_hat_keinen_zugriff,
  (select count(*) from public.find_glossary_candidate_terms(
    'Ein Satz ganz ohne jeden Fachbegriff dieser Art.', 'de'
  )) as treffer_leer;

-- Verifikation Teil 2, separat ausführen — nimmt den ersten echten
-- veröffentlichten Begriff und prüft, ob die RPC ihn in einem Text mit
-- seinem eigenen Namen findet. ERWARTUNG: gefunden = true.
select
  gt.slug,
  gt.slug = any(
    select c.slug from public.find_glossary_candidate_terms(
      'Testsatz, der den Begriff „' || gt.canonical_name || '" wörtlich enthält.', 'de'
    ) c
  ) as gefunden
from public.glossary_terms gt
where gt.status = 'published'
limit 1;
```

Hinweis: Datumspräfix der Datei (`20260819140000`) an das tatsächliche Ausführungsdatum anpassen, falls dieser Plan an einem späteren Tag umgesetzt wird — Projektkonvention ist `YYYYMMDDHHMMSS_beschreibung.sql`.

- [ ] **Step 2: Datei committen**

```bash
git add supabase/migrations/20260819140000_glossary_candidate_terms_rpc.sql
git commit -m "feat(glossary): find_glossary_candidate_terms RPC für gezielte Kandidatensuche"
```

- [ ] **Step 3: Im Supabase-Dashboard-SQL-Editor einspielen**

Komplette Datei einfügen und ausführen (nicht nur die Verifikations-Queries). Verifikation Teil 1 und Teil 2 jeweils separat ausführen und die erwarteten Werte prüfen (s. oben). Dieser Schritt ist NICHT automatisierbar — den Nutzer bitten, ihn auszuführen, oder selbst mit Dashboard-Zugriff erledigen.

---

## Task 2: `findCandidateMatcherTerms` + Unit-Tests

**Files:**
- Create: `lib/glossary/candidate-terms.ts`
- Test: `tests/lib/glossary-candidate-terms.test.ts`

**Interfaces:**
- Consumes: RPC `find_glossary_candidate_terms` aus Task 1 (per `createAdminClient().rpc(...)`, gleiches Muster wie `lib/glossary/detail.ts:171` `fetchSemanticNeighbours`).
- Produces: `findCandidateMatcherTerms(bodyText: string, lang: string): Promise<GlossaryMatcherTerm[] | null>` — von Task 3 (`lib/glossary/detail.ts`) importiert und anstelle von `getMatcherTerms(lang)` aufgerufen. `GlossaryMatcherTerm` ist der bestehende Typ aus `lib/glossary/types.ts:18` (`{ slug, canonicalName, aliases }`).

- [ ] **Step 1: Failing Test schreiben**

`tests/lib/glossary-candidate-terms.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'

const rpcMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: rpcMock }),
}))

beforeEach(() => {
  rpcMock.mockReset()
})

describe('findCandidateMatcherTerms', () => {
  it('ruft find_glossary_candidate_terms mit Text und Sprache auf', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })
    const { findCandidateMatcherTerms } = await import('@/lib/glossary/candidate-terms')
    await findCandidateMatcherTerms('Ein Text über MoE.', 'de')
    expect(rpcMock).toHaveBeenCalledWith('find_glossary_candidate_terms', {
      body_text: 'Ein Text über MoE.',
      target_lang: 'de',
    })
  })

  it('bildet die RPC-Zeilen auf GlossaryMatcherTerm ab', async () => {
    rpcMock.mockResolvedValue({
      data: [{ slug: 'llm', canonical_name: 'Large Language Model', aliases: ['LLM'] }],
      error: null,
    })
    const { findCandidateMatcherTerms } = await import('@/lib/glossary/candidate-terms')
    const result = await findCandidateMatcherTerms('text', 'de')
    expect(result).toEqual([{ slug: 'llm', canonicalName: 'Large Language Model', aliases: ['LLM'] }])
  })

  it('setzt aliases auf ein leeres Array, wenn die RPC null liefert', async () => {
    rpcMock.mockResolvedValue({
      data: [{ slug: 'llm', canonical_name: 'Large Language Model', aliases: null }],
      error: null,
    })
    const { findCandidateMatcherTerms } = await import('@/lib/glossary/candidate-terms')
    const result = await findCandidateMatcherTerms('text', 'de')
    expect(result).toEqual([{ slug: 'llm', canonicalName: 'Large Language Model', aliases: [] }])
  })

  it('gibt null zurück und loggt bei einem RPC-Fehler, statt zu werfen', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { findCandidateMatcherTerms } = await import('@/lib/glossary/candidate-terms')
    const result = await findCandidateMatcherTerms('text', 'de')
    expect(result).toBeNull()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('gibt ein leeres Array zurück, wenn kein Begriff im Text vorkommt', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null })
    const { findCandidateMatcherTerms } = await import('@/lib/glossary/candidate-terms')
    const result = await findCandidateMatcherTerms('Text ohne Fachbegriffe.', 'de')
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npx vitest run tests/lib/glossary-candidate-terms.test.ts`
Expected: FAIL — `Cannot find module '@/lib/glossary/candidate-terms'`

- [ ] **Step 3: Implementierung schreiben**

`lib/glossary/candidate-terms.ts`:

```typescript
import { createAdminClient } from '@/lib/supabase/admin'
import type { GlossaryMatcherTerm } from '@/lib/glossary/types'

/**
 * Kandidaten-Begriffe für EINEN Text statt des ganzen Katalogs.
 *
 * Ersetzt getMatcherTerms(lang) im Lesepfad (lib/glossary/detail.ts,
 * linkRelatedTerms): dort lud jede Begriffsseite bei jedem Rendern/
 * Revalidate den KOMPLETTEN veröffentlichten Katalog (2171 Zeilen, Stand
 * 2026-08-19), obwohl laut gemessenem Befund in lib/glossary/mentions.ts
 * (PROD-BEFUND 2026-08-12) von 2527 Begriffen mit 16.398 Namen/Aliassen im
 * Schnitt nur 17 tatsächlich im Text vorkommen. Die RPC
 * find_glossary_candidate_terms verlagert genau den Vorfilter, den
 * matchNameInText ohnehin schon macht (text.includes(name)), nach Postgres:
 * sie vergleicht dort, wo es nichts kostet (Egress zählt nur die
 * ÜBERTRAGENEN Zeilen), und liefert nur die Handvoll echten Kandidaten.
 *
 * SICHERHEITSEIGENSCHAFT: die RPC filtert bewusst GRÖSSZÜGIGER als der
 * exakte JS-Matcher (case-insensitiv statt der Abkürzungs-Sonderregel aus
 * isAbbreviation) — sie darf nie einen Begriff ausschliessen, den
 * findGlossaryMentions/matchNameInText hinterher als echten Treffer werten
 * würde. Ein paar zusätzliche, später verworfene Kandidaten sind harmlos;
 * ein fälschlich ausgeschlossener Begriff wäre ein stiller Verlust.
 *
 * getMatcherTerms bleibt unverändert für die übrigen (Schreib-)Aufrufer
 * bestehen (confirm.ts, crawl.ts, translate.ts, jobs/advance.ts,
 * article-jobs/service.ts) — sie laufen im Cron-/Batch-Takt, nicht bei
 * jedem Seitenaufruf, und sind deshalb nicht Teil dieser Änderung.
 */
export async function findCandidateMatcherTerms(
  bodyText: string,
  lang: string,
): Promise<GlossaryMatcherTerm[] | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('find_glossary_candidate_terms', {
    body_text: bodyText,
    target_lang: lang,
  })
  if (error) {
    console.error('[Glossary] findCandidateMatcherTerms:', error.message)
    return null
  }
  return ((data ?? []) as Array<{ slug: string; canonical_name: string; aliases: string[] | null }>).map((r) => ({
    slug: r.slug,
    canonicalName: r.canonical_name,
    aliases: r.aliases ?? [],
  }))
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npx vitest run tests/lib/glossary-candidate-terms.test.ts`
Expected: PASS (5 Tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: keine neuen Fehler in `lib/glossary/candidate-terms.ts` oder dem Testfile.

- [ ] **Step 6: Commit**

```bash
git add lib/glossary/candidate-terms.ts tests/lib/glossary-candidate-terms.test.ts
git commit -m "feat(glossary): findCandidateMatcherTerms für gezielte Kandidatensuche"
```

---

## Task 3: `linkRelatedTerms` umstellen

**Files:**
- Modify: `lib/glossary/detail.ts:186-234` (`linkRelatedTerms`)
- Modify: `tests/lib/glossary-detail.test.ts` (Import, `beforeEach`, 7 Tests in `describe('getGlossaryTerm — verwandte Begriffe', ...)`)

**Interfaces:**
- Consumes: `findCandidateMatcherTerms(bodyText, lang)` aus Task 2.
- Produces: unverändertes Verhalten von `getGlossaryTerm`/`linkRelatedTerms` nach aussen (`relatedTerms`, injizierte `glossaryLink`-Marks im `body`) — nur die Datenquelle der Kandidaten ändert sich.

- [ ] **Step 1: `linkRelatedTerms` umstellen**

In `lib/glossary/detail.ts`, Import ergänzen:

```typescript
import { findCandidateMatcherTerms } from '@/lib/glossary/candidate-terms'
```

`getMatcherTerms`-Import entfernen, falls er nach diesem Umbau in der Datei sonst nirgends mehr gebraucht wird (prüfen: `lib/glossary/detail.ts` importiert `getMatcherTerms` aus `@/lib/glossary/terms` nur für `linkRelatedTerms` — nach dem Umbau kann der Import komplett raus).

`linkRelatedTerms` (aktuell Zeilen 186-234) ändern von:

```typescript
  // getMatcherTerms gibt null zurück, wenn die Übersetzungsabfrage
  // fehlgeschlagen ist (terms.ts) — Lesepfad, deshalb Fehler geloggt (bereits
  // in getMatcherTerms selbst) und auf leere Kandidatenliste degradiert,
  // statt die Detailseite abstürzen zu lassen.
  const candidates = ((await getMatcherTerms(lang)) ?? []).filter((t) => t.slug !== term.slug)
  const text = extractVisibleText(term.body)
  const mentions = candidates.length > 0 && text ? findGlossaryMentions(text, candidates) : []
```

(Die drei Kommentarzeilen über `const candidates` gehören zum Diff — sie beschreiben das ALTE `getMatcherTerms`-Verhalten und müssen mit ersetzt werden, sonst dokumentieren sie nach dem Umbau eine Funktion, die an dieser Stelle gar nicht mehr aufgerufen wird.)

zu:

```typescript
async function linkRelatedTerms(
  term: GlossaryTerm,
  lang: string,
): Promise<{ body: unknown; relatedTerms: GlossaryRelatedTerm[] }> {
  const text = extractVisibleText(term.body)
  // Gezielte Kandidatensuche statt Voll-Katalog-Fetch (s. candidate-terms.ts) —
  // ohne Text gibt es nichts zu matchen, die RPC bräuchte dafür nicht
  // aufgerufen zu werden.
  const candidates = text
    ? ((await findCandidateMatcherTerms(text, lang)) ?? []).filter((t) => t.slug !== term.slug)
    : []
  const mentions = candidates.length > 0 && text ? findGlossaryMentions(text, candidates) : []
```

Der restliche Funktionskörper (ab `const withGlossary = injectGlossaryMarks(...)`) bleibt UNVERÄNDERT — er kennt die Herkunft von `candidates` nicht und braucht keine Anpassung.

- [ ] **Step 2: Testdatei-Setup umstellen**

In `tests/lib/glossary-detail.test.ts`, `beforeEach` (aktuell):

```typescript
beforeEach(() => {
  state.queues = {}
  state.fallback = { data: null, error: null }
  state.chains = {}
  rpcMock.mockReset()
  rpcMock.mockResolvedValue({ data: [], error: null })
})
```

ändern zu (name-abhängiger Dispatch, weil `linkRelatedTerms` jetzt ZWEI verschiedene RPCs aufruft — `find_glossary_candidate_terms` und die bestehende `match_glossary_related_terms` für semantische Nachbarn):

```typescript
beforeEach(() => {
  state.queues = {}
  state.fallback = { data: null, error: null }
  state.chains = {}
  rpcMock.mockReset()
  rpcMock.mockImplementation((fnName: string) => {
    if (fnName === 'find_glossary_candidate_terms') return Promise.resolve({ data: [], error: null })
    return Promise.resolve({ data: [], error: null }) // match_glossary_related_terms Default
  })
})
```

Direkt danach (vor `describe('getGlossaryTerm — verwandte Begriffe', ...)`) einen Helfer ergänzen:

```typescript
/** Setzt die Antwort der find_glossary_candidate_terms-RPC für einen
 *  Testfall; match_glossary_related_terms (semantische Nachbarn) bleibt
 *  beim leeren Default aus beforeEach. */
function mockCandidateTerms(rows: Array<{ slug: string; canonical_name: string; aliases: string[] }>) {
  rpcMock.mockImplementation((fnName: string) => {
    if (fnName === 'find_glossary_candidate_terms') return Promise.resolve({ data: rows, error: null })
    return Promise.resolve({ data: [], error: null })
  })
}
```

- [ ] **Step 3: Die 7 Tests in `describe('getGlossaryTerm — verwandte Begriffe', ...)` umstellen**

Komplette Ersetzung des Blocks (die `CANDIDATE`/`TERM_WITH_MENTION`-Konstanten am Blockanfang bleiben, nur `CANDIDATE` verliert das `id`-Feld, das die neue RPC nicht liefert):

```typescript
describe('getGlossaryTerm — verwandte Begriffe', () => {
  const CANDIDATE = { slug: 'llm', canonical_name: 'Large Language Model', aliases: ['LLM'] }
  const TERM_WITH_MENTION = {
    ...TERM_ROW,
    body: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Ein MoE-Modell spart Rechenleistung gegenüber einem dichten LLM.' }],
        },
      ],
    },
  }

  it('findet einen Begriff, den der Erklärungstext erwähnt', async () => {
    queue('glossary_terms', { data: TERM_WITH_MENTION, error: null })
    mockCandidateTerms([CANDIDATE])
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'de')
    expect(term?.relatedTerms).toEqual([{ slug: 'llm', canonicalName: 'Large Language Model' }])
  })

  it('bleibt leer, wenn der Text keinen anderen Begriff erwähnt', async () => {
    queue('glossary_terms', { data: TERM_ROW, error: null })
    mockCandidateTerms([CANDIDATE])
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'de')
    expect(term?.relatedTerms).toEqual([])
  })

  it('bleibt leer, wenn es noch keine anderen veröffentlichten Begriffe gibt', async () => {
    queue('glossary_terms', { data: TERM_WITH_MENTION, error: null })
    mockCandidateTerms([])
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'de')
    expect(term?.relatedTerms).toEqual([])
  })

  it('verlinkt den erwähnten Begriff direkt im body — nicht nur als Block darunter', async () => {
    queue('glossary_terms', { data: TERM_WITH_MENTION, error: null })
    mockCandidateTerms([CANDIDATE])
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'de')
    expect(linked(term?.body)).toEqual([{ text: 'LLM', slug: 'llm' }])
  })

  it('lässt den body unverändert, wenn der Text nichts erwähnt', async () => {
    queue('glossary_terms', { data: TERM_ROW, error: null })
    mockCandidateTerms([CANDIDATE])
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'de')
    expect(linked(term?.body)).toEqual([])
    expect(term?.body).toEqual(TERM_ROW.body)
  })

  it('degradiert auf keine verwandten Begriffe, wenn find_glossary_candidate_terms fehlschlägt (vormals: Übersetzungs-Ladefehler in getMatcherTerms, Review-Fund Important 1, Fix-Runde 1)', async () => {
    // Die Kandidatensuche läuft jetzt komplett serverseitig in der RPC —
    // ein Übersetzungs-Ladefehler wie vor der Umstellung kann auf App-Seite
    // gar nicht mehr auftreten. Der äquivalente Fehlerfall ist jetzt ein
    // RPC-Fehler; linkRelatedTerms muss ihn weiterhin über `?? []` abfangen,
    // statt zu werfen.
    queue('glossary_terms', { data: TERM_WITH_MENTION, error: null })
    rpcMock.mockImplementation((fnName: string) => {
      if (fnName === 'find_glossary_candidate_terms') return Promise.resolve({ data: null, error: { message: 'boom' } })
      return Promise.resolve({ data: [], error: null })
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'en')
    expect(term?.relatedTerms).toEqual([])
    expect(linked(term?.body)).toEqual([])
    errSpy.mockRestore()
  })

  it('verlinkt den eigenen Begriff nicht, auch wenn der eigene Text ihn nennt', async () => {
    // TERM_WITH_MENTION erwähnt "MoE" — der Begriff selbst. Die
    // Kandidatenliste enthält hier absichtlich auch die eigene Zeile, um
    // den Selbstausschluss wirklich zu prüfen (nicht nur, dass er in der
    // Praxis nie auftaucht).
    const SELF_CANDIDATE = { slug: 'moe', canonical_name: 'Mixture-of-Experts', aliases: ['MoE'] }
    queue('glossary_terms', { data: TERM_WITH_MENTION, error: null })
    mockCandidateTerms([SELF_CANDIDATE, CANDIDATE])
    const { getGlossaryTerm } = await import('@/lib/glossary/detail')
    const term = await getGlossaryTerm('moe', 'de')
    expect(term?.relatedTerms).toEqual([{ slug: 'llm', canonicalName: 'Large Language Model' }])
    expect(term?.relatedTerms.some((t) => t.slug === 'moe')).toBe(false)
    expect(linked(term?.body).some((l) => l.slug === 'moe')).toBe(false)
  })
})
```

Alle anderen `describe`-Blöcke in dieser Datei (Basisabfrage, Übersetzungs-Fallback, Produkte, News) bleiben unverändert — sie riefen `getMatcherTerms` bisher nie mit einer nicht-leeren Kandidatenliste auf, ihr zweites geqeuetes `glossary_terms`-Ergebnis (die bisherige leere Matcher-Antwort) wird nach dem Umbau einfach nicht mehr konsumiert (harmlos, kein Test greift per Index `[1]` darauf zu).

- [ ] **Step 4: Tests ausführen**

Run: `npx vitest run tests/lib/glossary-detail.test.ts tests/lib/glossary-candidate-terms.test.ts`
Expected: PASS (alle Tests in beiden Dateien)

- [ ] **Step 5: Volle Suite + Typecheck**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: PASS, keine neuen Fehler. (Zum Vergleich: vor diesem Plan 176 Testdateien / 1527 Tests grün.)

- [ ] **Step 6: Commit**

```bash
git add lib/glossary/detail.ts tests/lib/glossary-detail.test.ts
git commit -m "perf(egress): Begriffsseite nutzt gezielte Kandidatensuche statt Voll-Katalog-Fetch"
```

---

## Task 4: Rollout-Verifikation

**Files:** keine Code-Änderungen — Beobachtung nach Deploy.

- [ ] **Step 1: Deployen**

```bash
git push origin main
```

- [ ] **Step 2: Stichprobe gegen Produktion**

Nach dem Deploy eine reale Begriffsseite abrufen (z.B. `curl -s https://www.synthszr.com/de/glossary/<ein-slug-mit-bekannten-verwandten-begriffen> | grep -o 'verwandte-begriffe[^<]*'` oder Browser-Check) und bestätigen: „Verwandte Begriffe" zeigt weiterhin dieselben Einträge wie vor dem Deploy für mindestens 2-3 Begriffsseiten, deren `relatedTerms` vorher bekannt waren.

- [ ] **Step 3: Egress-Chart beobachten**

Vercel/Supabase-Dashboard (Egress usage, „Current billing cycle") über 24-48h beobachten. Erwartung: der Tageswert bleibt mindestens auf dem durch die Notfixes (Cache-TTL 60min, revalidate 6h) erreichten Niveau oder sinkt weiter — die neue RPC sollte ihn NICHT wieder ansteigen lassen, da sie strukturell weniger überträgt als selbst der gecachte Voll-Katalog-Pfad.

- [ ] **Step 4: Memory aktualisieren**

Falls dieser Plan über eine Claude-Code-Session ausgeführt wird: Eintrag in `project_supabase_egress`-Memory ergänzen (Datum, Commit-Hashes, tatsächlich beobachteter Egress-Effekt) — nicht nur „geplant", sondern „umgesetzt am [Datum], Ergebnis: [X]".

---

## Self-Review

**1. Spec-Abdeckung:** Spec fordert (a) neue RPC mit Sicherheits-Konvention → Task 1. (b) App-seitige Funktion, die die RPC aufruft → Task 2. (c) Umstellung des Lesepfads `linkRelatedTerms` → Task 3. (d) Kein Index → explizit in Task 1 begründet, keine eigene Aufgabe nötig. (e) Schreibpfade/`getPublishedTermList` bleiben unangetastet → explizit als Nicht-Ziel benannt, keine Task berührt sie. Alle Spec-Punkte abgedeckt.

**2. Platzhalter-Scan:** Keine TBD/„ähnlich wie"/unvollständigen Codeblöcke — jede Aufgabe enthält vollständigen, einsetzbaren Code.

**3. Typkonsistenz:** `findCandidateMatcherTerms(bodyText: string, lang: string): Promise<GlossaryMatcherTerm[] | null>` (Task 2) — Rückgabetyp `GlossaryMatcherTerm[] | null` identisch zur bisherigen `getMatcherTerms`-Signatur, damit `?? []` in Task 3 unverändert funktioniert. RPC-Parameter `body_text`/`target_lang` (Task 1, SQL) exakt gleich benannt wie die Aufrufparameter in Task 2 (`supabase.rpc('find_glossary_candidate_terms', { body_text, target_lang })`). Rückgabespalten der RPC (`slug, canonical_name, aliases`) exakt gleich zu den in Task 2 erwarteten Zeilenfeldern.
