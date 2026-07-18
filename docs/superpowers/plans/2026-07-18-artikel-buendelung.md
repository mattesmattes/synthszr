# Artikel-Bündelung „Thema des Tages" & „Nachlese" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selektierte News-Queue-Artikel lassen sich als „Thema des Tages" oder „Nachlese" taggen; alle gleich-getaggten Quellen werden zu je einem gebündelten Leitartikel zusammengefasst, der oben im Post erscheint, ein sprachabhängiges Label trägt und dessen Länge an den übrigen Artikeln kompensiert wird.

**Architecture:** Ein neues `bundle_type`-Feld fließt von der news-queue-UI durch den Job-Payload in die Ghostwriter-Pipeline. `planArticle` gruppiert nach Tag und erzwingt die Reihenfolge; eine neue `writeBundleSection` führt N Quellen redundanzfrei zu einem Abschnitt zusammen; ein deterministisches `bundle-length`-Modul erzwingt den 18-Satz-Cap (nur Zusammenfassung) und die Ein-Satz-Kürzung normaler Artikel (inkl. Take). Die Bündel-Abschnitte tragen ein strukturelles `data-bundle-type`-Attribut, das beide Renderer sprachabhängig labeln.

**Tech Stack:** Next.js 16, TypeScript, Supabase (Postgres), Vitest, TipTap-JSON, Anthropic SDK (Opus 4.8 / Sonnet 5).

## Global Constraints

- Bundle-Typen: exakt `'topic'` (Thema des Tages) | `'recap'` (Nachlese) | `null`. Exklusiv pro Artikel.
- Reihenfolge im Draft: `topic` zuerst, dann `recap`, dann normale Artikel.
- Zusammenfassung eines Bündel-Artikels: **hart ≤ 18 Sätze, OHNE Take**. Take zusätzlich, normale Take-Länge (steigt nicht durch Bündelung).
- Beide Bündel-Typen sind ausführliche Leitartikel — kein Ton-/Formatunterschied, nur Label + Position.
- Kompensation: existiert ≥1 Bündel-Artikel, wird jeder normale Artikel um genau einen Satz gekürzt — **inklusive Take**.
- Quellen: Haupt-Quelle = größter übernommener Inhaltsanteil (primärer Link); weitere als Nebenquellen.
- Labels sprachabhängig aus i18n-Dictionary; Bündel-Content entsteht im DE-Pfad und wird vom bestehenden Translation-Flow mitübersetzt.
- Der Text der Pipeline-Prompts ist auf DEUTSCH (bestehende Konvention in `ghostwriter-pipeline.ts`).
- Alle Anthropic-Aufrufe respektieren die 2026-Frontier-Guards (kein temperature/budget_tokens auf Sonnet 5 / Opus 4.8) — bestehende `callModelNonStreaming`-Wrapper nutzen, nicht neu bauen.

---

### Task 1: Datenmodell — `bundle_type` durch DB + Job-Payload

**Files:**
- Migration (Supabase CLI): `supabase/migrations/<ts>_news_queue_bundle_type.sql`
- Modify: `lib/claude/ghostwriter-pipeline.ts` (`PipelineItem`-Interface, ~Zeile 48)
- Modify: `lib/article-jobs/service.ts` (`createArticleJob` + `createManualArticleJob`: NewsQueueItem→PipelineItem-Konvertierung, ~Zeile 118 + 163)
- Modify: `lib/news-queue/service.ts` (Typ `NewsQueueItem` falls dort definiert; sonst wo definiert)
- Test: `tests/lib/bundle-type-payload.test.ts`

**Interfaces:**
- Produces: `PipelineItem.bundle_type?: 'topic' | 'recap' | null` — von Task 4/5 gelesen.
- Produces: DB-Spalte `news_queue.bundle_type text` mit `CHECK (bundle_type IN ('topic','recap'))` NULL-able, default NULL.

- [ ] **Step 1: Migration schreiben**

```sql
-- supabase/migrations/<ts>_news_queue_bundle_type.sql
ALTER TABLE news_queue
  ADD COLUMN bundle_type text
  CHECK (bundle_type IN ('topic','recap'));
COMMENT ON COLUMN news_queue.bundle_type IS
  'Manuelle Bündel-Zuordnung: topic=Thema des Tages, recap=Nachlese, NULL=normal';
```

- [ ] **Step 2: Migration anwenden** (Supabase-CLI, Projekt-Ref `zadrjbyszvsusukajsbp`)

Run: `supabase db push` (oder via SQL-Editor, MCP hat dieses Projekt nicht — vgl. bestehende Migrationen)
Expected: Spalte existiert, `select bundle_type from news_queue limit 1` liefert NULL.

- [ ] **Step 3: `PipelineItem` um `bundle_type` erweitern**

In `lib/claude/ghostwriter-pipeline.ts`, `interface PipelineItem` ergänzen:
```typescript
  bundle_type?: 'topic' | 'recap' | null
```

- [ ] **Step 4: Failing test — bundle_type wird in selected_items durchgereicht**

```typescript
// tests/lib/bundle-type-payload.test.ts
import { describe, expect, it } from 'vitest'
import { toPipelineItem } from '@/lib/article-jobs/service'  // ggf. Konvertierungs-Helper extrahieren

describe('NewsQueueItem → PipelineItem', () => {
  it('überträgt bundle_type', () => {
    const nq = { id: '1', title: 'T', content: 'C', source_url: null, source_identifier: 's', source_display_name: null, bundle_type: 'topic' } as any
    expect(toPipelineItem(nq).bundle_type).toBe('topic')
  })
  it('normal → null/undefined', () => {
    const nq = { id: '1', title: 'T', content: 'C', source_url: null, source_identifier: 's', source_display_name: null, bundle_type: null } as any
    expect(toPipelineItem(nq).bundle_type ?? null).toBeNull()
  })
})
```

- [ ] **Step 5: Konvertierung anpassen** — in `createArticleJob` + `createManualArticleJob` die NewsQueueItem→PipelineItem-Map so ergänzen, dass `bundle_type` mitkopiert wird. Falls kein benannter Helper existiert, `toPipelineItem(nq)` extrahieren und an beiden Stellen nutzen (DRY).

- [ ] **Step 6: Tests grün + tsc**

Run: `npx vitest run tests/lib/bundle-type-payload.test.ts && npx tsc --noEmit`
Expected: PASS, 0 TS-Fehler.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations lib/claude/ghostwriter-pipeline.ts lib/article-jobs/service.ts tests/lib/bundle-type-payload.test.ts
git commit -m "feat(bundling): bundle_type-Feld durch DB + Job-Payload"
```

---

### Task 2: News-Queue-UI — klickbare Bündel-Tags + API

**Files:**
- Create: `app/api/admin/news-queue/bundle-type/route.ts`
- Modify: `app/admin/news-queue/page.tsx` (Tab „selected": Tag-Buttons pro Artikel)
- Test: `tests/api/bundle-type-route.test.ts` (falls API-Tests etabliert; sonst manuelle Verifikation dokumentieren)

**Interfaces:**
- Consumes: DB-Spalte `news_queue.bundle_type` (Task 1).
- Produces: `PATCH /api/admin/news-queue/bundle-type` Body `{ id: string, bundle_type: 'topic'|'recap'|null }` → `{ ok: true }`.

- [ ] **Step 1: API-Route schreiben** (Admin-Auth wie bestehende news-queue-Routen, `createAdminClient`)

```typescript
// app/api/admin/news-queue/bundle-type/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session?.isAdmin) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  const { id, bundle_type } = await request.json()
  if (!id || (bundle_type !== null && bundle_type !== 'topic' && bundle_type !== 'recap')) {
    return NextResponse.json({ error: 'Ungültige Parameter' }, { status: 400 })
  }
  const { error } = await createAdminClient().from('news_queue').update({ bundle_type }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: UI — Tag-Buttons im „selected"-Tab**

In `app/admin/news-queue/page.tsx`, im Listeneintrag jedes selektierten Artikels zwei Toggle-Buttons „Thema des Tages" / „Nachlese". Aktiver Tag hervorgehoben. Klick → optimistisches State-Update + `PATCH`; exklusiv (Klick auf aktiven Tag → `null`, Klick auf anderen → wechselt). Bestehende Fetch-/State-Muster der Seite nutzen.

- [ ] **Step 3: Manuelle Verifikation** (dokumentieren)

Run: dev-Server, `/admin/news-queue` → Tab „selected" → Tag klicken → DB prüfen (`select id,bundle_type from news_queue where status='selected'`).
Expected: bundle_type persistiert, exklusiv, Toggle funktioniert.

- [ ] **Step 4: tsc + Commit**

```bash
npx tsc --noEmit
git add app/api/admin/news-queue/bundle-type app/admin/news-queue/page.tsx
git commit -m "feat(bundling): Bündel-Tags im news-queue selected-Tab + API"
```

---

### Task 3: `bundle-length` — deterministischer Satz-Cap + Kürzung

**Files:**
- Create: `lib/claude/bundle-length.ts`
- Test: `tests/lib/bundle-length.test.ts`

**Interfaces:**
- Produces: `splitSummaryAndTake(section: string): { summary: string; take: string }` — trennt am „Synthszr Take:"-Marker (analog `splitAtTake` in `take-ending.ts` — dort nachlesen und wiederverwenden statt duplizieren).
- Produces: `capSummarySentences(section: string, maxSentences: number): string` — kürzt NUR die Zusammenfassung auf ≤ maxSentences Sätze, lässt den Take unberührt.
- Produces: `shortenByOneSentence(section: string): string` — entfernt je einen Satz aus Zusammenfassung UND Take.
- Consumes: Satz-Splitting-Utility aus `take-ending.ts` (`splitSentences`) — wiederverwenden.

- [ ] **Step 1: Failing tests**

```typescript
// tests/lib/bundle-length.test.ts
import { describe, expect, it } from 'vitest'
import { capSummarySentences, shortenByOneSentence } from '@/lib/claude/bundle-length'

const S = (summary: string, take: string) => `## H\n\n${summary}\n\nSynthszr Take: ${take}`

describe('capSummarySentences', () => {
  it('kürzt Zusammenfassung >18 Sätze auf 18, Take unberührt', () => {
    const summary = Array.from({ length: 22 }, (_, i) => `Satz ${i + 1}.`).join(' ')
    const out = capSummarySentences(S(summary, 'Take-Satz eins. Take-Satz zwei.'), 18)
    expect(out).toContain('Satz 18.')
    expect(out).not.toContain('Satz 19.')
    expect(out).toContain('Take-Satz zwei.') // Take bleibt vollständig
  })
  it('lässt ≤18 Sätze unverändert', () => {
    const summary = 'Ein Satz. Zwei Sätze.'
    expect(capSummarySentences(S(summary, 'T.'), 18)).toContain('Zwei Sätze.')
  })
})

describe('shortenByOneSentence', () => {
  it('entfernt je einen Satz aus Zusammenfassung UND Take', () => {
    const out = shortenByOneSentence(S('A. B. C.', 'X. Y.'))
    expect(out).toContain('A. B.'); expect(out).not.toMatch(/\bC\.\B/)
    expect(out).toContain('X.'); expect(out).not.toContain('Y.')
  })
})
```

- [ ] **Step 2: Verify FAIL** — `npx vitest run tests/lib/bundle-length.test.ts` → FAIL (Modul fehlt).

- [ ] **Step 3: Implementieren** — `lib/claude/bundle-length.ts`. `splitSummaryAndTake` per Marker-Regex (Marker aus `take-ending.ts` übernehmen). `capSummarySentences`: Zusammenfassung in Sätze splitten (`splitSentences`), auf max kürzen, mit Take rekombinieren. `shortenByOneSentence`: je letzten Satz aus Summary + Take entfernen. Satzenden-Erkennung robust (Abkürzungen wie „z. B." nicht als Satzende — `splitSentences` aus take-ending prüfen, ob das schon gelöst ist; sonst dort mit-fixen).

- [ ] **Step 4: Verify PASS** — `npx vitest run tests/lib/bundle-length.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/claude/bundle-length.ts tests/lib/bundle-length.test.ts
git commit -m "feat(bundling): deterministischer 18-Satz-Cap + Ein-Satz-Kürzung"
```

---

### Task 4: `planArticle` — Gruppierung nach bundle_type + Ordering

**Files:**
- Modify: `lib/claude/ghostwriter-pipeline.ts` (`planArticle`, ~Zeile 227; `ArticlePlan`, ~Zeile 55)
- Test: `tests/lib/plan-bundle-grouping.test.ts`

**Interfaces:**
- Consumes: `PipelineItem.bundle_type` (Task 1).
- Produces: `ArticlePlan.bundleGroups?: { topic: number[]; recap: number[] }` — 1-basierte Item-Indizes je Gruppe; von Task 5 (writeBundleSection-Dispatch) + Assembly gelesen.
- Produces: garantiertes Ordering — `topic`-Gruppe zuerst, dann `recap`, dann normale Items. `normalizeArticlePlan` (`lib/claude/normalize-plan.ts`) muss `bundleGroups` defensiv normalisieren.

- [ ] **Step 1: Failing test — Gruppierung + Ordering**

```typescript
// tests/lib/plan-bundle-grouping.test.ts
import { describe, expect, it } from 'vitest'
import { computeBundleGroups, enforceBundleOrdering } from '@/lib/claude/ghostwriter-pipeline'

const items = (types: (string|null)[]) => types.map((t, i) => ({ id: `${i+1}`, title: `T${i+1}`, content: 'c', source_identifier: 's', source_url: null, source_display_name: null, bundle_type: t })) as any

describe('computeBundleGroups', () => {
  it('gruppiert topic/recap nach 1-basiertem Index', () => {
    const g = computeBundleGroups(items(['topic', null, 'recap', 'topic']))
    expect(g.topic).toEqual([1, 4]); expect(g.recap).toEqual([3])
  })
})
describe('enforceBundleOrdering', () => {
  it('setzt topic-Gruppe vor recap vor normale', () => {
    const g = { topic: [4], recap: [1] }
    // normale Reihenfolge [2,3] soll erhalten bleiben, aber nach den Bündeln
    expect(enforceBundleOrdering([2, 3, 1, 4], g)).toEqual([4, 1, 2, 3])
  })
})
```

- [ ] **Step 2: Verify FAIL.**

- [ ] **Step 3: Implementieren** — `computeBundleGroups(items)` + `enforceBundleOrdering(ordering, groups)` als exportierte Helfer. In `planArticle`: nach dem Modell-Ordering `enforceBundleOrdering` anwenden, `bundleGroups` in den Plan schreiben. Im planArticle-Prompt einen Hinweis ergänzen, dass getaggte Items zu einem Bündel gehören (damit Heading/Take-Winkel je Gruppe sinnvoll geplant werden) — Prompt-Text DE, iterativ kalibrierbar.

- [ ] **Step 4: `normalizeArticlePlan` erweitern** — `bundleGroups` defensiv (fehlend → `{topic:[],recap:[]}`). Test in bestehender normalize-plan-Testdatei ergänzen.

- [ ] **Step 5: Verify PASS + tsc.**

- [ ] **Step 6: Commit**

```bash
git add lib/claude/ghostwriter-pipeline.ts lib/claude/normalize-plan.ts tests/lib/plan-bundle-grouping.test.ts
git commit -m "feat(bundling): planArticle gruppiert nach bundle_type + erzwingt Ordering"
```

---

### Task 5: `writeBundleSection` — N Quellen → 1 Abschnitt

**Files:**
- Modify: `lib/claude/ghostwriter-pipeline.ts` (neue `writeBundleSection`; Dispatch in `writeSectionsBatch` ~Zeile 746 + `runGhostwriterPipeline`)
- Test: `tests/lib/write-bundle-section.test.ts` (Struktur/Cap-Test ohne echten Modell-Call; Modell-Call in Integration)

**Interfaces:**
- Consumes: `ArticlePlan.bundleGroups` (Task 4), `capSummarySentences` (Task 3), `PipelineItem[]` einer Gruppe.
- Produces: `writeBundleSection(items: PipelineItem[], bundleType: 'topic'|'recap', heading: string, model: AIModel, opts: {...gleiche opts wie writeSection...}): Promise<string>` — liefert einen Abschnitt (H2 mit `data-bundle-type`-Markierung im Heading-Text-Kanal bzw. als separates Feld für den Assembly), Zusammenfassung ≤18 Sätze (via `capSummarySentences` deterministisch erzwungen), Take normale Länge, Haupt-Quelle + Nebenquellen im Quellen-Block.

- [ ] **Step 1: Failing test — Cap wird angewandt**

```typescript
// tests/lib/write-bundle-section.test.ts — Test der deterministischen Nachbearbeitung,
// indem writeBundleSection mit gemocktem Modell-Output (>18 Sätze) den Cap erzwingt.
// (Falls Mocking des Modell-Calls zu invasiv: diesen Test auf capSummarySentences in Task 3
//  beschränken und hier nur die Quellen-Auswahl testen.)
import { describe, expect, it } from 'vitest'
import { pickPrimaryAndSecondarySources } from '@/lib/claude/ghostwriter-pipeline'

describe('pickPrimaryAndSecondarySources', () => {
  it('Haupt-Quelle = größter Inhaltsanteil, Rest Nebenquellen', () => {
    const items = [
      { id: '1', source_display_name: 'A', source_url: 'a', content: 'x'.repeat(100) },
      { id: '2', source_display_name: 'B', source_url: 'b', content: 'x'.repeat(500) },
    ] as any
    const r = pickPrimaryAndSecondarySources(items)
    expect(r.primary.source_url).toBe('b')
    expect(r.secondary.map((s: any) => s.source_url)).toEqual(['a'])
  })
})
```

- [ ] **Step 2: Verify FAIL.**

- [ ] **Step 3: Implementieren** — `writeBundleSection`: baut einen zusammenführenden User-Prompt (alle Quellen-`content`s, mit `stripLoneSurrogates` + Slice wie in `writeSection` — den bestehenden Surrogate-Schutz nicht vergessen), System-Prompt-Zusatz „führe die Quellen redundanzfrei zusammen, decke alle unterschiedlichen Aspekte ab, ausführlicher Leitartikel". Nach der Generierung `capSummarySentences(section, 18)` deterministisch anwenden. `pickPrimaryAndSecondarySources` bestimmt Quellen-Block. `data-bundle-type` als strukturelle Markierung für den Assembly zurückgeben.

- [ ] **Step 4: Dispatch** — in `writeSectionsBatch` UND `runGhostwriterPipeline`: für die `bundleGroups.topic`/`.recap`-Indizes `writeBundleSection` statt `writeSection` aufrufen, an den Ordering-Positionen 1 (topic) und 2 (recap). Normale Items unverändert via `writeSection`.

- [ ] **Step 5: Verify PASS + tsc.**

- [ ] **Step 6: Commit**

```bash
git add lib/claude/ghostwriter-pipeline.ts tests/lib/write-bundle-section.test.ts
git commit -m "feat(bundling): writeBundleSection führt Quellen redundanzfrei zusammen (18-Satz-Cap, Haupt+Nebenquellen)"
```

---

### Task 6: Kompensation — normale Artikel je 1 Satz kürzer (inkl. Take)

**Files:**
- Modify: `lib/claude/ghostwriter-pipeline.ts` (`writeSection`-Aufruf in beiden Pfaden + Anwendung von `shortenByOneSentence`)
- Test: `tests/lib/compensation.test.ts`

**Interfaces:**
- Consumes: `shortenByOneSentence` (Task 3), `ArticlePlan.bundleGroups` (Task 4).
- Produces: Verhalten — wenn `bundleGroups.topic.length + bundleGroups.recap.length > 0`, wird jeder NORMALE Abschnitt nach der Generierung durch `shortenByOneSentence` gekürzt.

- [ ] **Step 1: Failing test**

```typescript
// tests/lib/compensation.test.ts
import { describe, expect, it } from 'vitest'
import { hasBundles } from '@/lib/claude/ghostwriter-pipeline'

describe('hasBundles', () => {
  it('true wenn topic oder recap Items', () => {
    expect(hasBundles({ topic: [1], recap: [] } as any)).toBe(true)
    expect(hasBundles({ topic: [], recap: [] } as any)).toBe(false)
  })
})
```

- [ ] **Step 2: Verify FAIL.**

- [ ] **Step 3: Implementieren** — `hasBundles(groups)` Helper. In beiden writeSection-Pfaden: wenn `hasBundles`, normale Section nach der Generierung (nach proofread) durch `shortenByOneSentence` schicken. Bündel-Abschnitte NICHT kürzen.

- [ ] **Step 4: Verify PASS + tsc.**

- [ ] **Step 5: Commit**

```bash
git add lib/claude/ghostwriter-pipeline.ts tests/lib/compensation.test.ts
git commit -m "feat(bundling): normale Artikel je 1 Satz kürzer bei aktiven Bündeln (inkl. Take)"
```

---

### Task 7: Renderer-Labels — `data-bundle-type` in Web + E-Mail + i18n

**Files:**
- Modify: `components/tiptap-renderer.tsx`
- Modify: `lib/email/tiptap-to-html.ts`
- Modify/Create: i18n-Dictionary für die Labels (bestehende i18n-Struktur unter `lib/i18n/` prüfen und dort ergänzen)
- Test: `tests/lib/bundle-label-i18n.test.ts`

**Interfaces:**
- Consumes: das `data-bundle-type`-Attribut, das der Assembly aus `writeBundleSection` (Task 5) an das Abschnitts-Heading schreibt.
- Produces: `bundleLabel(type: 'topic'|'recap', locale: string): string` — z. B. `('topic','de') → 'Thema des Tages'`, `('topic','en') → 'Topic of the Day'`, `('recap','de') → 'Nachlese'`, `('recap','en') → 'Recap'`. Vollständige Übersetzungen für alle Ziel-Locales (de/en + weitere aus dem bestehenden i18n-Set — dort nachsehen, welche Locales aktiv sind).

- [ ] **Step 1: Failing test — Label-Mapping**

```typescript
// tests/lib/bundle-label-i18n.test.ts
import { describe, expect, it } from 'vitest'
import { bundleLabel } from '@/lib/i18n/bundle-labels' // Pfad an bestehende i18n-Struktur anpassen

describe('bundleLabel', () => {
  it('de', () => { expect(bundleLabel('topic','de')).toBe('Thema des Tages'); expect(bundleLabel('recap','de')).toBe('Nachlese') })
  it('en', () => { expect(bundleLabel('topic','en')).toBe('Topic of the Day'); expect(bundleLabel('recap','en')).toBe('Recap') })
  it('fällt auf en zurück bei unbekannter locale', () => { expect(bundleLabel('topic','xx')).toBe('Topic of the Day') })
})
```

- [ ] **Step 2: Verify FAIL.**

- [ ] **Step 3: `bundleLabel` implementieren** (Dictionary für alle aktiven Locales; Fallback en).

- [ ] **Step 4: Renderer anpassen** — beide Renderer erkennen `data-bundle-type` am Abschnitts-Heading und rendern darüber ein Label-Badge via `bundleLabel(type, locale)`. Die Locale bezieht jeder Renderer aus seinem bestehenden Kontext (Web: Route-Locale; E-Mail: Newsletter-Locale). Quellen-Block: Haupt-Quelle prominent, Nebenquellen als „auch: …".

- [ ] **Step 5: Verify PASS + tsc.**

- [ ] **Step 6: Commit**

```bash
git add components/tiptap-renderer.tsx lib/email/tiptap-to-html.ts lib/i18n tests/lib/bundle-label-i18n.test.ts
git commit -m "feat(bundling): sprachabhängige Bündel-Labels in Web + E-Mail"
```

---

### Task 8: Übersetzungs-Flow — `data-bundle-type` übersteht Übersetzung

**Files:**
- Read/verify: `app/api/admin/translations/route.ts` + `process-queue/route.ts`
- Modify (nur falls nötig): der Node-Serialisierungs-/Übersetzungs-Pfad
- Test: `tests/lib/translation-attr-preservation.test.ts`

**Interfaces:**
- Consumes: TipTap-JSON mit `data-bundle-type`-Attribut (Task 5/7).
- Produces: Garantie, dass nach Übersetzung eines Posts das `data-bundle-type`-Attribut am Knoten erhalten bleibt.

- [ ] **Step 1: Failing/characterization test** — TipTap-JSON mit einem `data-bundle-type='topic'`-Heading durch die Übersetzungs-Transformation schicken (die reine JSON-Transformation, ohne echten Modell-Call — falls der Flow nur Text übersetzt und die Struktur behält, prüfen ob Attribute mitkopiert werden).

```typescript
// tests/lib/translation-attr-preservation.test.ts
import { describe, expect, it } from 'vitest'
import { translateDocPreservingStructure } from '@/lib/i18n/translate-doc' // an tatsächlichen Flow anpassen
it('behält data-bundle-type nach Struktur-Übersetzung', async () => {
  const doc = { type: 'doc', content: [{ type: 'heading', attrs: { level: 2, 'data-bundle-type': 'topic' }, content: [{ type: 'text', text: 'X' }] }] }
  const out = await translateDocPreservingStructure(doc, 'en', /* fake translator */ (t: string) => t)
  expect(out.content[0].attrs['data-bundle-type']).toBe('topic')
})
```

- [ ] **Step 2: Verify** — läuft der Test grün (Attribut bleibt), ist nichts zu tun außer den Test als Regressionsschutz zu behalten. Läuft er rot, im Übersetzungs-Pfad die `attrs` beim Rekonstruieren der Knoten mitkopieren.

- [ ] **Step 3: Commit**

```bash
git add tests/lib/translation-attr-preservation.test.ts app/api/admin/translations
git commit -m "test(bundling): data-bundle-type übersteht Übersetzung (+ Fix falls nötig)"
```

---

## Self-Review

**Spec coverage:**
- UI-Tags → Task 2 ✓ · DB/Payload → Task 1 ✓ · Gruppierung/Ordering → Task 4 ✓ · redundanzfreie Bündelung + 18-Satz-Cap + Haupt/Nebenquellen → Task 5 (+ Cap-Logik Task 3) ✓ · Take fix → Task 3/5 (Cap zählt nur Summary) ✓ · Kompensation inkl. Take → Task 6 (+ Task 3) ✓ · Reihenfolge topic→recap→normal → Task 4 ✓ · Labels Web+E-Mail sprachabhängig → Task 7 ✓ · i18n/Übersetzung → Task 7 + 8 ✓
- Keine Lücke.

**Ambiguity:** Der 18-Satz-Cap zählt ausschließlich die Zusammenfassung (Task 3 `capSummarySentences` lässt den Take unberührt) — deckt die Spec-Korrektur.

**Type consistency:** `bundle_type` (Werte `'topic'|'recap'|null`) einheitlich in Task 1/2/4; `bundleGroups: {topic:number[]; recap:number[]}` einheitlich Task 4/5/6; `bundleLabel(type, locale)` einheitlich Task 7.

**Offene Umsetzungs-Notiz (kein Blocker):** Prompt-Text (planArticle-Bündelhinweis, writeBundleSection-System-Prompt) ist iterativ kalibrierbar und wird im Integrationslauf gegen echte News feinjustiert — der deterministische Cap/Kürzung (Task 3) ist die harte Garantie, nicht der Prompt.
