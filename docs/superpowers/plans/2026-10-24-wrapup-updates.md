# AI WEEK Wrap-Up: Synthszr Update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Wochenrückblick recherchiert je Thema per Web-Suche, ob sich die Story seit dem Tagesartikel weiterentwickelt hat, und ersetzt dort den gekürzten Take durch ein belegtes „Synthszr Update“.

**Architecture:** Neues Modul `lib/wrapup/research.ts` ruft je Thema parallel Anthropic mit dem Server-Tool `web_search_20250305` (Muster `lib/rankings/research.ts`) und liefert `TopicUpdate[]`. Der bestehende Compose-Aufruf (`generate.ts`) bekommt die Updates als Kontext und liefert je Thema `take` ODER `update` plus bei `major` die `keepParagraphs`. `assemble.ts` setzt Label, Quellen-Absatz und die Knoten-Auswahl; die Bericht-Knoten bleiben unverändert (nur Weglassen ganzer Knoten). Web- und E-Mail-Darstellung lernen den Marker „Synthszr Update:“.

**Tech Stack:** Next.js 16, TypeScript, `@anthropic-ai/sdk` 0.71 (Server-Tool web_search), zod, vitest + jsdom, Supabase (nur Lesen + `llm_usage`).

**Spec:** `docs/superpowers/specs/2026-10-24-wrapup-updates-spec.md`

## Global Constraints

- Bericht-Knoten (`topic.bodyNodes`) werden nie verändert; bei `major` dürfen nur ganze Knoten entfallen (Index 0 bleibt immer, mindestens zwei Knoten bleiben).
- Labels „Synthszr Take: “ / „Synthszr Update: “ setzt ausschließlich `assemble.ts`; ein vom Modell mitgeliefertes Präfix wird entfernt, nie verdoppelt.
- Wortbudgets im Prompt: Take 40 bis 60 Wörter (2-3 Sätze), Update minor 40 bis 60 Wörter, Update major bis 120 Wörter.
- Ein Update braucht mindestens eine Quelle mit `http(s)`-URL und Datum `YYYY-MM-DD`, das NACH `topic.date` und nicht nach dem Stichtag (`asOfDate`) liegt; sonst `updateLevel: 'none'`, `summary: ''`.
- Recherche: `max_uses: 4`, Timeout 90 s je Thema, parallel; jeder Fehler eines Themas ergibt `'none'`, der Wrap-Up entsteht trotzdem. Log-Prefix `[WeekWrapup]`.
- Use Case `wrapup_research`: Default `claude-sonnet-5`, `allowedProviders: ['anthropic']`; Usage-Logging über `withUsageLogging(client, 'wrapup_research')`.
- Route `maxDuration = 300` bleibt; `week.ts`, Slug-Bildung und Draft-Status bleiben unverändert.
- Keine `{Company}`- und `{lex:}`-Tags im Update (Prompt-Regel bleibt).
- Tests laufen mit leerem Service-Key: `SUPABASE_SERVICE_ROLE_KEY= pnpm test tests/lib/<datei>`.
- Commits deutsch im Repo-Stil (`feat(wrapup): …`), auf Branch `feat/wrapup-updates`, kein Push/Merge ohne Betreiber.

## Review Focus

1. Modell liefert `keepParagraphs` ohne Index 0 oder nur einen Index → `selectParagraphs` ergänzt Index 0 und füllt auf zwei Knoten auf (Task 3).
2. Quelle undatiert, auf/vor dem Artikeldatum oder nach dem Stichtag → wird verworfen; bleibt keine, fällt die Stufe auf `'none'` (Task 1).
3. Recherche wirft, läuft in den Timeout oder es gibt keinen `ANTHROPIC_API_KEY` → `'none'` je Thema, Wrap-Up wird trotzdem gebaut (Task 1, Task 4).
4. Modell schreibt ein `update` für ein Thema mit Stufe `'none'` → Zusammenbau nimmt den Text als Take mit Take-Label, kein Quellen-Absatz (Task 3).
5. Woche ohne Updates → Dokument wie bisher, kein „Update-Quellen“-Absatz; Intro-Teaser-Verbot steht im Prompt (Task 2, Task 3).

---

### Task 1: Use Case und Recherche-Modul

**Files:**
- Modify: `lib/ai/use-cases.ts` (Union + `USE_CASE_DEFINITIONS` nach `wrapup`)
- Modify: `app/admin/settings/page.tsx:106` (Gruppe um `'wrapup_research'` ergänzen)
- Modify: `lib/wrapup/collect.ts` (`textOf` exportieren)
- Create: `lib/wrapup/research.ts`
- Test: `tests/lib/wrapup-research.test.ts`

**Interfaces:**
- Consumes: `WrapupTopic` aus `lib/wrapup/collect.ts`; `getModelForUseCase` aus `lib/ai/model-config.ts`; `withUsageLogging` aus `lib/ai/usage-log.ts`; `getModelCapabilities` aus `lib/claude/model-capabilities.ts`.
- Produces (`lib/wrapup/research.ts`):
  ```ts
  export type UpdateLevel = 'none' | 'minor' | 'major'
  export interface UpdateSource { url: string; title: string; date: string } // date YYYY-MM-DD
  export interface TopicUpdate {
    weekday: string
    updateLevel: UpdateLevel
    /** Belegte Entwicklung seit dem Tagesartikel, 2-5 Sätze; '' bei none. */
    summary: string
    sources: UpdateSource[]
    /** usage.server_tool_use.web_search_requests der Antwort; 0 bei Fehler. */
    searches: number
  }
  export function noUpdate(weekday: string): TopicUpdate
  export function buildResearchPrompt(topic: WrapupTopic, asOfDate: string): string
  export function parseResearchResponse(raw: unknown, articleDate: string, asOfDate: string): Pick<TopicUpdate, 'updateLevel' | 'summary' | 'sources'>
  export interface ResearchClient { messages: { create(params: unknown, options?: unknown): Promise<unknown> } }
  export async function researchTopicUpdate(topic: WrapupTopic, opts: { model: string; asOfDate: string; client: ResearchClient; timeoutMs?: number }): Promise<TopicUpdate>
  export async function researchWeekUpdates(topics: WrapupTopic[], opts?: { asOfDate?: string; model?: string }): Promise<TopicUpdate[]>
  ```
  `textOf(node: unknown): string` wird aus `collect.ts` exportiert (bisher privat).

- [ ] **Step 1: Use Case eintragen**

In `lib/ai/use-cases.ts`: `| 'wrapup_research'` hinter `'wrapup'` in die Union; Eintrag hinter `wrapup`:
```ts
wrapup_research: {
  label: 'Wochenrückblick — Update-Recherche',
  description: 'Je Thema der Woche per Web-Suche pruefen, ob sich die Story seit dem Tagesartikel weiterentwickelt hat',
  defaultModel: 'claude-sonnet-5',
  allowedProviders: ['anthropic'],
},
```
In `app/admin/settings/page.tsx:106` `'wrapup_research'` hinter `'wrapup'` einfügen.

- [ ] **Step 2: Failing Tests schreiben** (`tests/lib/wrapup-research.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import { buildResearchPrompt, parseResearchResponse, researchTopicUpdate, noUpdate } from '@/lib/wrapup/research'
import type { WrapupTopic } from '@/lib/wrapup/collect'

const topic: WrapupTopic = { weekday: 'Dienstag', date: '2026-10-13', headline: 'OpenAI kauft Chips', body: 'Bericht.', takeText: 'Synthszr Take: Alt.', headingNode: null, bodyNodes: [], postSlug: 'di' }

describe('buildResearchPrompt', () => {
  const p = buildResearchPrompt(topic, '2026-10-25')
  it('nennt Headline, Artikeldatum und Stichtag', () => { expect(p).toContain('OpenAI kauft Chips'); expect(p).toContain('2026-10-13'); expect(p).toContain('2026-10-25') })
  it('verlangt Quellen NACH dem Artikeldatum und Datumsformat YYYY-MM-DD', () => { expect(p).toMatch(/NACH dem 2026-10-13/); expect(p).toContain('YYYY-MM-DD') })
  it('macht none zum Normalfall und verlangt das Tool report_update', () => { expect(p).toMatch(/Normalfall/); expect(p).toContain('report_update') })
  it('gibt Bericht und Original-Take als Kontext mit', () => { expect(p).toContain('Bericht.'); expect(p).toContain('Alt.') })
})

describe('parseResearchResponse', () => {
  const ok = { updateLevel: 'major', summary: 'Nvidia reagierte <cite>x</cite> am 15.10.', sources: [
    { url: 'https://reuters.com/a', title: 'Reuters', date: '2026-10-15' },
    { url: 'https://ft.com/b', title: 'FT', date: '2026-10-16' },
  ] }
  it('behält eine belegte Stufe mit datierten Quellen und entfernt cite-Markup', () => {
    const r = parseResearchResponse(ok, '2026-10-13', '2026-10-25')
    expect(r.updateLevel).toBe('major'); expect(r.sources).toHaveLength(2); expect(r.summary).toBe('Nvidia reagierte  am 15.10.'.replace('  ', ' '))
  })
  it('verwirft Quellen auf/vor dem Artikeldatum, nach dem Stichtag, ohne Datum oder ohne http-URL', () => {
    const r = parseResearchResponse({ ...ok, sources: [
      { url: 'https://a.de', title: 'a', date: '2026-10-13' },
      { url: 'https://b.de', title: 'b', date: '2026-10-26' },
      { url: 'https://c.de', title: 'c' },
      { url: 'ftp://d.de', title: 'd', date: '2026-10-14' },
      { url: 'https://e.de', title: 'e', date: '2026-10-14' },
    ] }, '2026-10-13', '2026-10-25')
    expect(r.sources.map((s) => s.title)).toEqual(['e'])
  })
  it('fällt auf none zurück, wenn keine gültige Quelle bleibt', () => {
    const r = parseResearchResponse({ ...ok, sources: [{ url: 'https://a.de', title: 'a', date: '2026-10-01' }] }, '2026-10-13', '2026-10-25')
    expect(r).toEqual({ updateLevel: 'none', summary: '', sources: [] })
  })
  it('liefert none bei unbrauchbarer Antwort und bei Stufe none mit Quellen', () => {
    expect(parseResearchResponse(null, '2026-10-13', '2026-10-25').updateLevel).toBe('none')
    expect(parseResearchResponse({ ...ok, updateLevel: 'none' }, '2026-10-13', '2026-10-25')).toEqual({ updateLevel: 'none', summary: '', sources: [] })
  })
})

describe('researchTopicUpdate', () => {
  it('ergibt none, wenn der Aufruf scheitert — der Wrap-Up darf daran nicht hängen', async () => {
    const client = { messages: { create: async () => { throw new Error('overloaded') } } }
    const r = await researchTopicUpdate(topic, { model: 'claude-sonnet-5', asOfDate: '2026-10-25', client })
    expect(r).toEqual(noUpdate('Dienstag'))
  })
  it('liest den report_update-Block und zählt die Web-Suchen', async () => {
    const client = { messages: { create: async () => ({
      content: [
        { type: 'server_tool_use', name: 'web_search', input: { query: 'x' } },
        { type: 'tool_use', name: 'report_update', input: { updateLevel: 'minor', summary: 'Neu.', sources: [{ url: 'https://r.de', title: 'R', date: '2026-10-14' }] } },
      ],
      usage: { input_tokens: 1, output_tokens: 1, server_tool_use: { web_search_requests: 3 } },
    }) } }
    const r = await researchTopicUpdate(topic, { model: 'claude-sonnet-5', asOfDate: '2026-10-25', client })
    expect(r.updateLevel).toBe('minor'); expect(r.searches).toBe(3); expect(r.weekday).toBe('Dienstag')
  })
})
```

- [ ] **Step 3: Test läuft rot**

Run: `SUPABASE_SERVICE_ROLE_KEY= pnpm test tests/lib/wrapup-research.test.ts`
Expected: FAIL (Modul `@/lib/wrapup/research` fehlt)

- [ ] **Step 4: `lib/wrapup/research.ts` implementieren**

Bauart wie `lib/rankings/research.ts`: zod-Schema (`updateLevel` enum, `summary` string, `sources` array), `stripCite` lokal, `REPORT_UPDATE_TOOL` (`name: 'report_update'`, Schema mit `updateLevel`, `summary`, `sources[{url,title,date}]`, alle required), Web-Search-Tool `{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }`, KEIN `tool_choice` (Server-Tools verlangen auto), `max_tokens: 3000`, `thinking: { type: 'disabled' }` nur bei `supportsDisabledThinking`, `AbortController` mit `timeoutMs` Default 90_000. Tool-Block: letzter `tool_use` mit `name === 'report_update'`. `researchWeekUpdates`: ohne `process.env.ANTHROPIC_API_KEY` sofort `topics.map(noUpdate)` (einmal `console.warn('[WeekWrapup] Recherche übersprungen: ANTHROPIC_API_KEY fehlt')`); sonst `withUsageLogging(new Anthropic(...), 'wrapup_research')`, Modell `opts.model ?? await getModelForUseCase('wrapup_research')`, `asOfDate` Default heutiges Berlin-Datum (`new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date())`), `Promise.all` über `researchTopicUpdate`. Prompt-Text (Pflichtteile): Headline, `topic.date`, Stichtag, Bericht, Original-Take; Regeln: nur Entwicklungen NACH dem Artikeldatum (Reaktion, Korrektur, Folgeentscheidung, neue Zahl, Dementi, Gegenangebot, Marktreaktion), dieselbe Nachricht in anderem Medium zählt nicht, `'none'` ist der Normalfall, `'major'` nur bei geänderter Einschätzung / neuem Hauptakteur / Entscheidung / Zahl anderer Größenordnung, Datumsformat `YYYY-MM-DD`, Antwort über `report_update`, summary auf Deutsch 2-5 Sätze mit Datum/Akteur im ersten Satz.

- [ ] **Step 5: Tests grün, Typecheck**

Run: `SUPABASE_SERVICE_ROLE_KEY= pnpm test tests/lib/wrapup-research.test.ts && pnpm typecheck`
Expected: PASS, keine Typfehler

- [ ] **Step 6: Commit**

```bash
git add lib/wrapup/research.ts lib/wrapup/collect.ts lib/ai/use-cases.ts app/admin/settings/page.tsx tests/lib/wrapup-research.test.ts
git commit -m "feat(wrapup): Update-Recherche je Thema per web_search (Use Case wrapup_research)"
```

---

### Task 2: Compose-Prompt und Tool-Schema

**Files:**
- Modify: `lib/wrapup/generate.ts`
- Test: `tests/lib/wrapup-prompt.test.ts`

**Interfaces:**
- Consumes: `TopicUpdate`, `UpdateLevel` aus Task 1; `textOf` aus `collect.ts`.
- Produces:
  ```ts
  export interface WrapupParts { intro; excerptBullets; sections: Array<{ weekday: string; take?: string; update?: string; keepParagraphs?: number[]; bridge?: string }> }
  export const WRAPUP_TOOL  // bisher privat, jetzt exportiert
  export function buildWrapupPrompt(topics: WrapupTopic[], weekLabel: string, updates?: TopicUpdate[]): string
  export async function generateWrapupParts(topics, weekLabel, model, updates?: TopicUpdate[]): Promise<{ title; parts }>
  ```
  `take` wird optional (bei Update-Themen liefert das Modell `update`).

- [ ] **Step 1: Failing Tests ergänzen** (in `tests/lib/wrapup-prompt.test.ts`)

```ts
import { WRAPUP_TOOL } from '@/lib/wrapup/generate'
const major = { weekday: 'Montag', updateLevel: 'major' as const, summary: 'Alibaba zog das Modell am 14.10. zurück.', sources: [{ url: 'https://reuters.com/q', title: 'Reuters', date: '2026-10-14' }], searches: 3 }
const topicsMitKnoten = topics.map((t) => t.weekday === 'Montag' ? { ...t, bodyNodes: [
  { type: 'paragraph', content: [{ type: 'text', text: 'Text Mo.' }] },
  { type: 'image', attrs: { src: 'x' } },
  { type: 'paragraph', content: [{ type: 'text', text: 'Zweiter Absatz Mo.' }] },
] } : t)

describe('buildWrapupPrompt mit Updates', () => {
  it('markiert Themen ohne Recherche-Ergebnis als "RECHERCHE-UPDATE: keines"', () => {
    expect(buildWrapupPrompt(topics, 'W')).toMatch(/RECHERCHE-UPDATE: keines/)
  })
  it('gibt Stufe, Zusammenfassung und Quellen eines Updates mit', () => {
    const p = buildWrapupPrompt(topicsMitKnoten, 'W', [major])
    expect(p).toContain('Stufe: major'); expect(p).toContain('zog das Modell am 14.10. zurück'); expect(p).toContain('https://reuters.com/q'); expect(p).toContain('(2026-10-14)')
  })
  it('nummeriert bei major die Bericht-Knoten nach bodyNodes-Index und überspringt textlose Knoten', () => {
    const p = buildWrapupPrompt(topicsMitKnoten, 'W', [major])
    expect(p).toContain('[0] Text Mo.'); expect(p).toContain('[2] Zweiter Absatz Mo.'); expect(p).not.toContain('[1]')
  })
  it('nummeriert bei minor nicht', () => {
    expect(buildWrapupPrompt(topicsMitKnoten, 'W', [{ ...major, updateLevel: 'minor' }])).not.toContain('[0]')
  })
})

describe('WRAPUP_SYSTEM_PROMPT — Updates', () => {
  it('kennt die drei Stufen mit Wortbudgets', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/40 bis 60 Wörter/); expect(WRAPUP_SYSTEM_PROMPT).toMatch(/bis 120 Wörter/); expect(WRAPUP_SYSTEM_PROMPT).toMatch(/minor/); expect(WRAPUP_SYSTEM_PROMPT).toMatch(/major/)
  })
  it('lässt das Update den Take ersetzen und verbietet dessen Vorsilbe', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/ersetzt den Take/); expect(WRAPUP_SYSTEM_PROMPT).toMatch(/Beginne NICHT mit "Synthszr Update:"/)
  })
  it('bindet Fakten des Updates an die Recherche und verlangt das Urteil über den Original-Take', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/RECHERCHE-UPDATE/); expect(WRAPUP_SYSTEM_PROMPT).toMatch(/gehalten hat/)
  })
  it('regelt keepParagraphs: nur major, Index 0 bleibt, etwa die Hälfte, mindestens zwei', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/keepParagraphs/); expect(WRAPUP_SYSTEM_PROMPT).toMatch(/NUR bei major/i); expect(WRAPUP_SYSTEM_PROMPT).toMatch(/\[0\]/); expect(WRAPUP_SYSTEM_PROMPT).toMatch(/Hälfte/); expect(WRAPUP_SYSTEM_PROMPT).toMatch(/mindestens zwei/)
  })
  it('lässt das Intro Updates anteasern, aber ohne Updates keinen Teaser', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/höchstens zwei Sätzen/); expect(WRAPUP_SYSTEM_PROMPT).toMatch(/kein Teaser/)
  })
})

describe('WRAPUP_TOOL', () => {
  it('kennt update und keepParagraphs je Abschnitt, take ist nicht mehr Pflicht', () => {
    const item = WRAPUP_TOOL.input_schema.properties.sections.items
    expect(Object.keys(item.properties)).toEqual(expect.arrayContaining(['take', 'update', 'keepParagraphs']))
    expect(item.required).toEqual(['weekday'])
  })
})
```

- [ ] **Step 2: Test läuft rot**

Run: `SUPABASE_SERVICE_ROLE_KEY= pnpm test tests/lib/wrapup-prompt.test.ts`
Expected: FAIL (`WRAPUP_TOOL` nicht exportiert, Prompt-Texte fehlen)

- [ ] **Step 3: `generate.ts` erweitern**

System-Prompt: Punkt 2 (take) um „NUR für Nachrichten ohne RECHERCHE-UPDATE … 40 bis 60 Wörter (2-3 Sätze)“ ergänzen (Phrase `2-3 Sätze` bleibt für den Alt-Test). Neue Punkte: „5. update“ (Stufen minor/major mit Budgets, erster Satz = was seit dem Tagesartikel passiert ist mit Datum oder Akteur, dann Urteil über den Original-Take „ob er gehalten hat“, „Das Update ersetzt den Take“, „Beginne NICHT mit "Synthszr Update:"“, jede Zahl/jeder Fakt aus dem RECHERCHE-UPDATE), „6. keepParagraphs“ („NUR bei major“, Indizes der Knoten aus der nummerierten Liste, `[0]` bleibt immer, etwa die Hälfte der Wörter, mindestens zwei), Intro-Regel („Gibt es Updates, benennt das Intro in höchstens zwei Sätzen, welche Storys sich bewegt haben und in welche Richtung. Keine Aufzählung, kein „mehr dazu unten“. Ohne Updates kein Teaser.“). Tool-Schema: `take` optional, `update` (string), `keepParagraphs` (array integer), `required: ['weekday']`. `buildWrapupPrompt`: je Thema Block `RECHERCHE-UPDATE: keines` bzw. `RECHERCHE-UPDATE (Stufe: <level>, Stand <asOf unbekannt → weglassen>):\n<summary>\nQuellen:\n- <title> (<date>) <url>`; bei `major` statt `BERICHT:\n${t.body}` die nummerierte Liste aus `t.bodyNodes` (`[i] ${textOf(node)}`, leere übersprungen). `generateWrapupParts` reicht `updates` an `buildWrapupPrompt` durch; Validierung bleibt (`intro`, `sections`).

- [ ] **Step 4: Tests grün**

Run: `SUPABASE_SERVICE_ROLE_KEY= pnpm test tests/lib/wrapup-prompt.test.ts && pnpm typecheck`
Expected: PASS (Typecheck meldet ggf. `section.take` possibly undefined in assemble.ts → in Task 3 behoben; falls hier schon rot, `section?.take?.trim()` ist bereits optional-chained, also grün)

- [ ] **Step 5: Commit**

```bash
git add lib/wrapup/generate.ts tests/lib/wrapup-prompt.test.ts
git commit -m "feat(wrapup): Compose-Prompt mit Update-Stufen, keepParagraphs und Intro-Teaser"
```

---

### Task 3: Zusammenbau mit Update, Quellen und Knoten-Auswahl

**Files:**
- Modify: `lib/wrapup/assemble.ts`
- Test: `tests/lib/wrapup-assemble.test.ts`

**Interfaces:**
- Consumes: `TopicUpdate`, `UpdateSource` (Task 1); `WrapupParts['sections']` mit `update`, `keepParagraphs` (Task 2).
- Produces:
  ```ts
  export const UPDATE_SOURCES_LABEL = 'Update-Quellen: '
  export function selectParagraphs(nodes: Node[], keep: number[] | undefined): Node[]
  export function sourcesParagraph(sources: UpdateSource[]): Node
  export function assembleWrapupDoc(topics, parts: Pick<WrapupParts, 'intro' | 'sections'>, updates?: TopicUpdate[]): Node
  ```
  Link-Mark der Quellen: `{ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow' } }` (wie TipTaps Link-Extension in `markdown-to-tiptap.ts`). Datum als `DD.MM.YYYY` hinter dem Titel, Quellen durch `, ` getrennt.

- [ ] **Step 1: Failing Tests ergänzen**

```ts
import { assembleWrapupDoc, buildHeading, selectParagraphs, sourcesParagraph, UPDATE_SOURCES_LABEL } from '@/lib/wrapup/assemble'
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const drei = [sourceParagraph, p('Zweiter.'), p('Dritter.')]
const upd = (level: 'none' | 'minor' | 'major') => ({ weekday: 'Montag', updateLevel: level, summary: 'S', sources: [{ url: 'https://reuters.com/u', title: 'Reuters', date: '2026-10-14' }], searches: 1 })

describe('selectParagraphs', () => {
  it('gibt alle Knoten zurück, wenn keine Auswahl vorliegt', () => { expect(selectParagraphs(drei, undefined)).toEqual(drei); expect(selectParagraphs(drei, [])).toEqual(drei) })
  it('behält Index 0 immer, sortiert, dedupliziert und ignoriert Indizes außerhalb', () => { expect(selectParagraphs(drei, [2, 2, 7])).toEqual([drei[0], drei[2]]) })
  it('füllt auf mindestens zwei Knoten auf', () => { expect(selectParagraphs(drei, [0])).toEqual([drei[0], drei[1]]) })
  it('lässt einen einzelnen Knoten einzeln', () => { expect(selectParagraphs([drei[0]], [0])).toEqual([drei[0]]) })
})

describe('assembleWrapupDoc mit Updates', () => {
  const sections = [{ weekday: 'Montag', update: 'Das hat gehalten.', keepParagraphs: [2] }]
  it('setzt bei major nur die gewählten Bericht-Knoten ein — unverändert, samt Marks', () => {
    const doc = assembleWrapupDoc([topic({ bodyNodes: drei })], { intro: 'X.', sections }, [upd('major')])
    const s = JSON.stringify(doc)
    expect(s).toContain('reuters.com/x'); expect(s).toContain('Dritter.'); expect(s).not.toContain('Zweiter.')
    expect((doc.content as Node[]).find((n) => JSON.stringify(n).includes('reuters.com/x'))).toEqual(sourceParagraph)
  })
  it('ignoriert keepParagraphs bei minor', () => {
    expect(JSON.stringify(assembleWrapupDoc([topic({ bodyNodes: drei })], { intro: 'X.', sections }, [upd('minor')]))).toContain('Zweiter.')
  })
  it('setzt das Update-Label statt des Take-Labels und verdoppelt es nicht', () => {
    const s = JSON.stringify(assembleWrapupDoc([topic()], { intro: 'X.', sections: [{ weekday: 'Montag', update: 'Synthszr Update: Neu.' }] }, [upd('minor')]))
    expect(s).toContain('Synthszr Update: Neu.'); expect(s).not.toContain('Synthszr Update: Synthszr Update:'); expect(s).not.toContain('Synthszr Take:')
  })
  it('hängt den Quellen-Absatz mit link-Mark und Datum direkt hinter das Update', () => {
    const doc = assembleWrapupDoc([topic()], { intro: 'X.', sections: [{ weekday: 'Montag', update: 'Neu.' }] }, [upd('minor')])
    const texts = (doc.content as Node[]).map((n) => JSON.stringify(n))
    const u = texts.findIndex((t) => t.includes('Synthszr Update: Neu.'))
    expect(texts[u + 1]).toContain(UPDATE_SOURCES_LABEL); expect(texts[u + 1]).toContain('"href":"https://reuters.com/u"'); expect(texts[u + 1]).toContain('14.10.2026')
  })
  it('nimmt bei Stufe none ein mitgeliefertes update als Take mit Take-Label, ohne Quellen', () => {
    const s = JSON.stringify(assembleWrapupDoc([topic()], { intro: 'X.', sections: [{ weekday: 'Montag', update: 'Doch.' }] }, [upd('none')]))
    expect(s).toContain('Synthszr Take: Doch.'); expect(s).not.toContain(UPDATE_SOURCES_LABEL)
  })
  it('bleibt ohne Updates beim bisherigen Dokument', () => {
    const ohne = assembleWrapupDoc([topic()], parts)
    expect(assembleWrapupDoc([topic()], parts, [])).toEqual(ohne); expect(JSON.stringify(ohne)).not.toContain(UPDATE_SOURCES_LABEL)
  })
  it('ordnet Bezug VOR dem Update ein', () => {
    const texts = (assembleWrapupDoc([topic()], { intro: 'X.', sections: [{ weekday: 'Montag', update: 'Neu.', bridge: 'Bezug.' }] }, [upd('minor')]).content as Node[]).map((n) => JSON.stringify(n))
    expect(texts.findIndex((t) => t.includes('Bezug.'))).toBeLessThan(texts.findIndex((t) => t.includes('Synthszr Update')))
  })
})

describe('sourcesParagraph', () => {
  it('verlinkt jeden Titel und trennt Quellen mit Komma', () => {
    const node = sourcesParagraph([{ url: 'https://a.de', title: 'A', date: '2026-10-14' }, { url: 'https://b.de', title: 'B', date: '2026-10-15' }])
    const texts = (node.content as Array<{ text: string; marks?: unknown[] }>).map((c) => c.text)
    expect(texts.join('')).toBe('Update-Quellen: A (14.10.2026), B (15.10.2026)')
    expect((node.content as Array<{ marks?: Array<{ attrs: { href: string } }> }>).filter((c) => c.marks?.length).map((c) => c.marks![0].attrs.href)).toEqual(['https://a.de', 'https://b.de'])
  })
})
```

- [ ] **Step 2: Test läuft rot**

Run: `SUPABASE_SERVICE_ROLE_KEY= pnpm test tests/lib/wrapup-assemble.test.ts`
Expected: FAIL (Exports fehlen)

- [ ] **Step 3: `assemble.ts` erweitern**

`selectParagraphs`: ohne `keep`/leer → `nodes`; sonst Set aus gültigen Indizes `0 ≤ i < nodes.length` plus 0, aufsteigend; solange Länge `< Math.min(2, nodes.length)`, kleinsten fehlenden Index ergänzen. `assembleWrapupDoc`: `byWeekday` für Updates wie für Sections; je Thema `level = update?.updateLevel ?? 'none'`; Knoten = `level === 'major' ? selectParagraphs(bodyNodes, section?.keepParagraphs) : bodyNodes`; Bezug; dann wenn `level !== 'none' && section?.update?.trim()` → Absatz `Synthszr Update: ` + Text ohne Präfix (`/^Synthszr (Take|Update):\s*/i`) und `sourcesParagraph(update.sources)` falls Quellen; sonst Take-Text = `section?.take ?? section?.update`, Label Take wie bisher.

- [ ] **Step 4: Tests grün**

Run: `SUPABASE_SERVICE_ROLE_KEY= pnpm test tests/lib/wrapup-assemble.test.ts tests/lib/wrapup-prompt.test.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/wrapup/assemble.ts tests/lib/wrapup-assemble.test.ts
git commit -m "feat(wrapup): Synthszr Update mit Quellen-Absatz und Knoten-Auswahl im Zusammenbau"
```

---

### Task 4: Verdrahtung in build.ts, Route-Test und Admin-Seite

**Files:**
- Modify: `lib/wrapup/build.ts`
- Modify: `tests/api/week-wrapup-route.test.ts`
- Modify: `app/admin/week-wrapup/page.tsx`

**Interfaces:**
- Consumes: `researchWeekUpdates` (Task 1), `generateWrapupParts(…, updates)` (Task 2), `assembleWrapupDoc(…, updates)` (Task 3).
- Produces: `WrapupResult.updates: Array<{ weekday: string; updateLevel: UpdateLevel; searches: number }>` (immer gesetzt bei `status: 'created'`); `buildWeekWrapup(supabase, opts: { model?; skipIfExists?; research?: boolean })`, `research` Default `true`.

- [ ] **Step 1: Route-Test anpassen (rot)**

Mock ergänzen: `researchWeekUpdates: vi.fn()` in `mocks`, `vi.mock('@/lib/wrapup/research', () => ({ researchWeekUpdates: mocks.researchWeekUpdates }))`, in `beforeEach` `mocks.researchWeekUpdates.mockResolvedValue([])`. Neue Tests:
```ts
it('reicht die Recherche-Ergebnisse an den Compose-Aufruf und in die Antwort durch', async () => {
  const upd = { weekday: 'Montag', updateLevel: 'major', summary: 'S', sources: [{ url: 'https://r.de', title: 'R', date: '2026-08-05' }], searches: 2 }
  mocks.researchWeekUpdates.mockResolvedValue([upd])
  const { POST } = await import('@/app/api/admin/week-wrapup/route')
  const body = await (await POST(req())).json()
  expect(mocks.generateWrapupParts).toHaveBeenCalledWith(expect.anything(), expect.any(String), 'claude-opus-5', [upd])
  expect(body.updates).toEqual([{ weekday: 'Montag', updateLevel: 'major', searches: 2 }])
})
it('baut den Entwurf auch dann, wenn die Recherche scheitert', async () => {
  mocks.researchWeekUpdates.mockRejectedValue(new Error('timeout'))
  const { POST } = await import('@/app/api/admin/week-wrapup/route')
  const res = await POST(req())
  expect(res.status).toBe(200); expect((await res.json()).updates).toEqual([])
})
```

Run: `SUPABASE_SERVICE_ROLE_KEY= pnpm test tests/api/week-wrapup-route.test.ts` → Expected: FAIL (updates fehlt in Antwort, 4. Argument fehlt)

- [ ] **Step 2: `build.ts` verdrahten**

Nach `collectWeekTopics`: `const updates = opts.research === false ? [] : await researchWeekUpdates(topics).catch((err) => { console.error('[WeekWrapup] Recherche fehlgeschlagen:', err); return [] as TopicUpdate[] })`. `generateWrapupParts(topics, week.label, model, updates)`, `assembleWrapupDoc(topics, parts, updates)`. Ergebnis `updates: updates.filter((u) => u.updateLevel !== 'none').map(({ weekday, updateLevel, searches }) => ({ weekday, updateLevel, searches }))`.

- [ ] **Step 3: Admin-Seite**

`result`-Typ um `updates?: Array<{ weekday: string; updateLevel: 'minor' | 'major'; searches: number }>` ergänzen; unter der Themen-Zeile: `Updates: Dienstag (major), Freitag (minor)` bzw. `Keine Entwicklungen seit den Tagesartikeln gefunden.`. CardDescription: „Je Thema wird per Web-Suche geprüft, ob sich die Story seit dem Tagesartikel weiterentwickelt hat; wo ja, ersetzt ein Synthszr Update den gekürzten Take. Die Berichte werden unverändert übernommen.“ Wartehinweis: „Das dauert zwei bis drei Minuten.“

- [ ] **Step 4: Tests grün**

Run: `SUPABASE_SERVICE_ROLE_KEY= pnpm test tests/api/week-wrapup-route.test.ts tests/lib/wrapup-*.test.ts && pnpm typecheck && pnpm lint --quiet lib/wrapup app/admin/week-wrapup`
Expected: PASS, keine Lint-Fehler

- [ ] **Step 5: Commit**

```bash
git add lib/wrapup/build.ts tests/api/week-wrapup-route.test.ts app/admin/week-wrapup/page.tsx
git commit -m "feat(wrapup): Recherche in den Bau verdrahtet, Updates im Admin-Ergebnis"
```

---

### Task 5: Marker „Synthszr Update“ in Web und E-Mail

**Files:**
- Modify: `lib/tiptap/dom-processors/utils.ts:6-7,33-34`, `take-barometer.ts:23`, `tip-promo-slot.ts:21`, `product-links.ts:177`, `rating-links.ts:115-116,173-174`
- Modify: `lib/email/tiptap-to-html.ts:688,974,1084,1248,1289,1376,1470,1484`
- Test: `tests/lib/update-marker-dom-processor.test.ts`, `tests/lib/email-update-label.test.ts`

**Interfaces:**
- Consumes: bestehende Exporte `insertTakeBarometers`, `insertTipPromoSlot`, `isSyntheseText`, `convertTiptapToHtml`, `generateEmailContentWithVotes`.
- Produces: keine neuen Exporte; jede Take|Contra-Erkennung akzeptiert zusätzlich `update`.

- [ ] **Step 1: Failing Tests schreiben**

`tests/lib/update-marker-dom-processor.test.ts` (JSDOM-Setup wie `company-tags-dom-processor.test.ts`, `document` und `NodeFilter` global setzen):
```ts
const html = '<h2 data-queue-item-id="q1">Montag — X</h2><p>Bericht.</p><p>Synthszr Update: Neu.</p>'
it('isSyntheseText erkennt den Update-Marker', () => expect(isSyntheseText('Synthszr Update: x')).toBe(true))
it('insertTakeBarometers setzt ein Barometer unter das Update', () => { const r = insertTakeBarometers(container(html)); expect(r.barometers).toHaveLength(1); expect(r.barometers[0].anchor).toBe('q1') })
it('insertTipPromoSlot findet das Update als ersten Take', () => expect(insertTipPromoSlot(container(html))).not.toBeNull())
```
`tests/lib/email-update-label.test.ts`:
```ts
const doc = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 2, queueItemId: 'q1' }, content: [{ type: 'text', text: 'Montag — X' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Bericht.' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Synthszr Update: Neu und belegt.' }] },
] }
it('stylt das Update-Label gelb wie den Take', () => expect(convertTiptapToHtml(doc)).toMatch(/<strong style="background-color: #FFFF00[^"]*">Synthszr Update:<\/strong>/))
it('hängt die Vote-Links an das Update', async () => expect(await generateEmailContentWithVotes({ content: doc, slug: 's' }, 'https://www.synthszr.com')).toContain('/api/newsletter-vote?v=agree'))
```

Run: `SUPABASE_SERVICE_ROLE_KEY= pnpm test tests/lib/update-marker-dom-processor.test.ts tests/lib/email-update-label.test.ts` → Expected: FAIL

- [ ] **Step 2: Regexe erweitern**

Web: `utils.ts` `/synthszr update:?/gi` in `SYNTHESE_PATTERNS` und `lower.includes('synthszr update')` in `isSyntheseText`; `take-barometer.ts` `TAKE_RE = /^\s*(Synthszr Take|Synthszr Update|Mattes Synthese)\s*:/i`; `tip-promo-slot.ts` `|| text.startsWith('synthszr update')`; `product-links.ts:177` `/synthszr take|synthszr update|synthszr contra|mattes synthese/i`; `rating-links.ts` beide Stellen `text.includes('synthszr update')`. E-Mail: `(take|contra)` → `(take|contra|update)` an 688, 1084, 1248, 1376; `(?:Take|Contra)` → `(?:Take|Contra|Update)` an 1289, 1470; `(take|contra)` an 1484; `firstTakeRe` an 974 `synthszr\s*(?:take|update)`.

- [ ] **Step 3: Tests grün, Bestand grün**

Run: `SUPABASE_SERVICE_ROLE_KEY= pnpm test tests/lib/update-marker-dom-processor.test.ts tests/lib/email-update-label.test.ts tests/lib/email-barometer-links.test.ts tests/lib/company-tags-dom-processor.test.ts tests/lib/bundle-label-email-render.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/tiptap/dom-processors lib/email/tiptap-to-html.ts tests/lib/update-marker-dom-processor.test.ts tests/lib/email-update-label.test.ts
git commit -m "feat(wrapup): Marker 'Synthszr Update' in Web-Renderer und Newsletter-HTML"
```

---

### Task 6: Trockenlauf-Script und Doku

**Files:**
- Create: `scripts/wrapup-research-dry.ts`
- Modify: `package.json` (Script `wrapup:research-dry`)
- Modify: `CLAUDE.md` (Abschnitt „AI WEEK Wrap-Up — Synthszr Update (2026-10-24)“)

**Interfaces:**
- Consumes: `lastCompleteWeek`, `collectWeekTopics`, `researchWeekUpdates`, `flushUsageLog`, `createAdminClient`.
- Produces: Konsolenausgabe je Thema (`weekday`, `updateLevel`, `searches`, `summary`, Quellen) und Kostenzeile aus `llm_usage` (`use_case = 'wrapup_research'`, `created_at >= start`) plus `searches × 0,01 USD` (Web-Suchen werden in `llm_usage` nicht bepreist).

- [ ] **Step 1: Script schreiben**

Env wie `scripts/measure-takes.ts` (`~/.synthszr.env.prod` vor `.env.local`), Flag `--asof YYYY-MM-DD` optional. Ablauf: Woche → Themen → `researchWeekUpdates(topics, { asOfDate })` → Ausgabe → `await flushUsageLog()` → Summe `cost_usd` aus `llm_usage` seit Start. Kein Schreiben außer `llm_usage` durch das Logging. Exit 0; bei `no topics` Hinweis und Exit 0.

- [ ] **Step 2: package.json**

`"wrapup:research-dry": "tsx scripts/wrapup-research-dry.ts"` hinter `takes:measure`.

- [ ] **Step 3: Trockenlauf ausführen** (ein echter Recherche-Lauf, Größenordnung unter 1 USD)

Run: `pnpm wrapup:research-dry`
Expected: je Thema eine Stufe; Quellen datiert nach dem Tagesartikel; Kostenzeile; kein Fehler. Ergebnis im Abschlussbericht festhalten (Stufen je Wochentag, Kosten).

- [ ] **Step 4: CLAUDE.md**

Abschnitt mit: Ablauf (Recherche je Thema → Compose → Zusammenbau), Stufen und Budgets, Knoten-Auswahl statt Umschreiben, Label-Erkennung, Use Case, Trockenlauf-Befehl, Admin-Prüfung (Schritt 3 der Spec liegt beim Betreiber).

- [ ] **Step 5: Gesamttest und Commit**

Run: `SUPABASE_SERVICE_ROLE_KEY= pnpm test && pnpm typecheck`
Expected: PASS

```bash
git add scripts/wrapup-research-dry.ts package.json CLAUDE.md docs/superpowers/specs/2026-10-24-wrapup-updates-spec.md docs/superpowers/plans/2026-10-24-wrapup-updates.md
git commit -m "feat(wrapup): Trockenlauf fuer die Update-Recherche, Spec, Plan und Doku"
```
