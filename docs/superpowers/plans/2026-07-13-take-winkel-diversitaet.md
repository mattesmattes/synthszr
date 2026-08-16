# Take-Winkel-Diversität Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeder Synthszr Take eines Digests bekommt in `planArticle` einen eigenen Blickwinkel zugewiesen, sodass die Takes nicht mehr alle dieselbe Kern-These wiederholen.

**Architecture:** Diversität wird oben in `planArticle` (einziger Call mit Gesamtblick über alle Items) als neues Plan-Feld `takeAngles` erzeugt und über den Plan → `writeSectionsBatch` → `writeSection` durchgereicht — genau wie `headings` heute. Kein zusätzlicher LLM-Call. Zusätzlich wird die Mattes-Retrieval-Query um den Winkel angereichert, damit verschiedene Winkel verschiedene Code-Crash-Passagen ziehen.

**Tech Stack:** TypeScript, Next.js, Anthropic SDK (Sonnet 5 für Planning, Opus 4.8 für Sektionen), Vitest, Supabase.

## Global Constraints

- Alle LLM-Outputs auf DEUTSCH (Winkel-Sätze inklusive).
- 2026-Frontier-Modelle (Sonnet 5): `callModelNonStreaming` handhabt `thinking`/`temperature` selbst — NIE manuell `temperature` an Sonnet 5 senden. Mit `thinking: true` wird `temperature` ohnehin ignoriert.
- KEIN zusätzlicher LLM-Call. Concurrency 6 in `writeSectionsBatch` und das 300s-Function-Cap bleiben unangetastet.
- Non-breaking: fehlt `takeAngles` oder ein einzelner Winkel, verhält sich die Pipeline exakt wie heute.
- Prod-Env für echte Läufe: `set -a; source ~/.synthszr.env.prod; set +a`.
- Tests: `npx vitest run`. Typecheck: `npx tsc --noEmit` (Exit 0, 0 Zeilen).
- `takeAngles` folgt exakt dem Muster von `headings`: Typ `Record<string, string>` (erforderlich), von `normalizeArticlePlan` garantiert gesetzt.

---

### Task 1: Datenmodell + defensive Normalisierung von `takeAngles`

**Files:**
- Modify: `lib/claude/ghostwriter-pipeline.ts:54-62` (ArticlePlan interface)
- Modify: `lib/claude/normalize-plan.ts:19-63` (normalizeArticlePlan)
- Test: `tests/lib/normalize-plan.test.ts`

**Interfaces:**
- Produces: `ArticlePlan.takeAngles: Record<string, string>` — itemIdx (1-basiert, als String-Key) → Winkel-Satz. Nach `normalizeArticlePlan` immer ein plain Object (ggf. `{}`).

- [ ] **Step 1: Failing test für die `takeAngles`-Normalisierung schreiben**

In `tests/lib/normalize-plan.test.ts` am Ende des `describe`-Blocks ergänzen:

```ts
  it('übernimmt ein wohlgeformtes takeAngles-Objekt', () => {
    const plan = {
      ordering: [1, 2],
      headings: { '1': 'A', '2': 'B' },
      takeAngles: { '1': 'Zweitrundeneffekt', '2': 'Historische Parallele' },
    }
    const out = normalizeArticlePlan(plan as any, 2)
    expect(out.takeAngles).toEqual({ '1': 'Zweitrundeneffekt', '2': 'Historische Parallele' })
  })

  it('liefert leeres takeAngles, wenn das Feld fehlt', () => {
    const plan = { ordering: [1, 2], headings: { '1': 'A', '2': 'B' } }
    const out = normalizeArticlePlan(plan as any, 2)
    expect(out.takeAngles).toEqual({})
  })

  it('liefert leeres takeAngles, wenn das Feld gedriftet (Array) ist', () => {
    const plan = { ordering: [1], headings: { '1': 'A' }, takeAngles: ['x'] }
    const out = normalizeArticlePlan(plan as any, 1)
    expect(out.takeAngles).toEqual({})
  })
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag verifizieren**

Run: `npx vitest run tests/lib/normalize-plan.test.ts`
Expected: FAIL — `out.takeAngles` ist `undefined` (Feld wird noch nicht normalisiert).

- [ ] **Step 3: ArticlePlan-Interface erweitern**

In `lib/claude/ghostwriter-pipeline.ts`, im `ArticlePlan`-Interface direkt nach der `headings`-Zeile:

```ts
  headings: Record<string, string>  // item index → deutsche Überschrift
  takeAngles: Record<string, string>  // item index → Blickwinkel-Satz für den Take
```

- [ ] **Step 4: `takeAngles` in normalizeArticlePlan defensiv behandeln**

In `lib/claude/normalize-plan.ts`, direkt nach dem `headings`-Block (nach Z.27) einfügen:

```ts
  const takeAngles: Record<string, string> =
    plan?.takeAngles && typeof plan.takeAngles === 'object' && !Array.isArray(plan.takeAngles)
      ? { ...(plan.takeAngles as Record<string, string>) }
      : {}
```

Und die `return`-Zeile (Z.62) ändern zu:

```ts
  return { ...plan, ordering, headings, takeAngles }
```

- [ ] **Step 5: Tests laufen lassen, grün verifizieren**

Run: `npx vitest run tests/lib/normalize-plan.test.ts`
Expected: PASS (alle, inkl. der 3 neuen).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: Exit 0, 0 Fehlerzeilen. (Da `normalizeArticlePlan` das Feld immer setzt und die einzigen Plan-Konstruktoren durch normalize laufen, bleibt tsc grün. Falls ein ArticlePlan-Literal ohne `takeAngles` meckert: dort `takeAngles: {}` ergänzen.)

- [ ] **Step 7: Commit**

```bash
git add lib/claude/ghostwriter-pipeline.ts lib/claude/normalize-plan.ts tests/lib/normalize-plan.test.ts
git commit -m "feat(ghostwriter): takeAngles im ArticlePlan + defensive Normalisierung"
```

---

### Task 2: planArticle vergibt Blickwinkel (Prompt + JSON-Feld + thinking)

**Files:**
- Modify: `lib/claude/ghostwriter-pipeline.ts:228-287` (planPrompt), `:292` (Call)

**Interfaces:**
- Consumes: `ArticlePlan.takeAngles` (Task 1)
- Produces: `plan.takeAngles` mit einem Winkel-Satz pro Item, nach `normalizeArticlePlan`.

- [ ] **Step 1: Prompt-Abschnitt für Take-Winkel einfügen**

In `lib/claude/ghostwriter-pipeline.ts` im `planPrompt`, direkt nach dem Block „REGELN PRO FELD" (nach der `thesis`-Regelzeile, vor „Erstelle folgenden JSON-Plan:") einfügen:

```
TAKE-WINKEL (gegen Monotonie der Meinung — HÖCHSTE PRIORITÄT):
Jeder Synthszr Take braucht einen EIGENEN Blickwinkel. Bestimme pro Item einen "takeAngle": EIN kurzer Satz auf DEUTSCH, der vorgibt, aus welcher Perspektive der Take dieses Items argumentiert.
- HART: Höchstens 1–2 Takes im GANZEN Artikel dürfen die übergreifende thesis direkt tragen. Alle anderen beleuchten je einen ANDEREN Aspekt: der Zweitrundeneffekt, der konkrete Verlierer, eine historische Parallele, die konträre Sicht, die unterschätzte Zahl, die betroffene Gruppe, das operative Detail.
- Keine zwei Takes dürfen dieselbe Konklusion ziehen.
- Der Winkel ist spezifisch für DIESES Item aus DIESER News — kein generisches "sei anders", sondern ein konkreter Denk-Ansatz.
```

- [ ] **Step 2: JSON-Schema im Prompt um `takeAngles` erweitern**

Im selben `planPrompt`, im JSON-Beispiel (Z.279-287) nach der `headings`-Zeile einfügen:

```
  "takeAngles": {"1": "Ein Satz DEUTSCH — der eigene Blickwinkel für den Take dieses Items", "2": "..."},
```

- [ ] **Step 3: `thinking` für den planArticle-Call aktivieren**

Die Call-Zeile (Z.292) ändern von:

```ts
  const text = await callModelNonStreaming(planPrompt, planSystemPrompt, model, { temperature: 0.3, maxTokens: 16000 })
```

zu:

```ts
  // thinking:true — die Winkel-Zuweisung mit Anti-Redundanz über den ganzen
  // Digest ist anspruchsvoller als reine Sortierung. temperature entfällt: mit
  // thinking (und bei Sonnet 5 generell) wird es von callModelNonStreaming ohnehin ignoriert.
  const text = await callModelNonStreaming(planPrompt, planSystemPrompt, model, { thinking: true, maxTokens: 16000 })
```

- [ ] **Step 4: Echter planArticle-Lauf zur Verifikation**

Temporäres Script `scripts/_verify_plan_angles.ts`:

```ts
import { planArticle } from '@/lib/claude/ghostwriter-pipeline'
import { getModelForUseCase } from '@/lib/ai/model-config'

async function main() {
  const model = await getModelForUseCase('article_planning')
  const items = [
    { id: '1', title: 'Zhipu bringt GLM-5.2 zu einem Fünftel der Opus-Kosten', content: 'Open-weight Modell, fast auf Opus-4.8-Niveau, ein Fünftel der Betriebskosten.', source_display_name: 'X', source_url: null, source_identifier: 'x' },
    { id: '2', title: 'Cloudflare berechnet AI-Crawlern jeden Abruf', content: 'Pay per Crawl, HTTP 402 für Bots, die nicht zahlen.', source_display_name: 'Verge', source_url: null, source_identifier: 'verge' },
    { id: '3', title: 'Benedict Evans: Token-Marge von 40% hält nicht', content: 'Frontier-Modelle werden Commodity, Kampf verlagert sich auf Chips.', source_display_name: 'Evans', source_url: null, source_identifier: 'evans' },
    { id: '4', title: 'MIT-Studie: KI-Essayschreiber schneiden schlechter ab', content: 'Probanden mit generativer KI dachten über die Zeit schlechter.', source_display_name: 'BI', source_url: null, source_identifier: 'bi' },
    { id: '5', title: 'Widerstand gegen Rechenzentren wächst', content: 'Metas 27-Mrd-Bau, Anwohner blockieren Projekte.', source_display_name: 'Verge', source_url: null, source_identifier: 'verge' },
  ]
  const plan = await planArticle(items, model)
  console.log('thesis:', plan.thesis)
  console.log('\ntakeAngles:')
  for (const [k, v] of Object.entries(plan.takeAngles || {})) console.log(`  [${k}] ${v}`)
  const n = Object.keys(plan.takeAngles || {}).length
  console.log(`\n${n}/${items.length} Winkel vergeben (Erwartung: alle 5, sichtbar verschieden)`)
}
main().catch((e) => { console.error(e); process.exit(1) })
```

Run:
```bash
set -a; source ~/.synthszr.env.prod; set +a
npx tsx scripts/_verify_plan_angles.ts 2>&1 | grep -v "^\["
rm -f scripts/_verify_plan_angles.ts
```
Expected: 5 Winkel-Sätze, sichtbar verschieden; höchstens 1–2 sinngemäß auf der thesis („Commodity"), der Rest andere Aspekte.

- [ ] **Step 5: Commit**

```bash
git add lib/claude/ghostwriter-pipeline.ts
git commit -m "feat(ghostwriter): planArticle vergibt Take-Winkel (Anti-Monotonie) + thinking"
```

---

### Task 3: Winkel durchreichen + in writeSection nutzen

**Files:**
- Modify: `lib/claude/ghostwriter-pipeline.ts:342-346` (writeSection context), `:357` (retrievalQuery), `:391` (userPrompt), `:201` (SECTION_SYSTEM_PROMPT), `:704-715` (writeSectionsBatch)

**Interfaces:**
- Consumes: `plan.takeAngles` (Task 2), `ArticlePlan.takeAngles` (Task 1)
- Produces: `writeSection`-context-Feld `takeAngle?: string`.

- [ ] **Step 1: `takeAngle` in die writeSection-context-Signatur aufnehmen**

In `lib/claude/ghostwriter-pipeline.ts`, das `context`-Objekt der `writeSection`-Signatur (Z.342-346) erweitern:

```ts
  context: {
    relevantCompanies: { public: string[]; premarket: string[] }
    cacheableUserPrefix: string
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    takeAngle?: string
  },
```

- [ ] **Step 2: retrievalQuery um den Winkel anreichern**

Die `retrievalQuery`-Zeile (Z.357) ändern zu:

```ts
  const retrievalQuery = [heading, context.takeAngle, (item.content || '').slice(0, 4000)]
    .filter(Boolean)
    .join('\n\n')
```

- [ ] **Step 3: BLICKWINKEL-Block in den userPrompt einfügen**

Direkt vor der `const userPrompt =`-Zeile (Z.391) einfügen:

```ts
  const angleBlock = context.takeAngle
    ? `\n\nBLICKWINKEL FÜR DEN TAKE (nur den Take, nicht die Zusammenfassung): ${context.takeAngle}`
    : ''
```

Und im `userPrompt`-Template die erste Zeile (THEMEN-HINWEIS) um `${angleBlock}` ergänzen, sodass sie endet mit:

```ts
...schreibe deine EIGENE Überschrift nach den ÜBERSCHRIFT-Regeln, übernimm diesen Hinweis NICHT wörtlich): ${heading}${angleBlock}
```

- [ ] **Step 4: SECTION_SYSTEM_PROMPT — Take-Punkt um Winkel-Anweisung ergänzen**

Die Zeile „4. SYNTHSZR TAKE: …" (Z.201) ändern zu:

```
4. SYNTHSZR TAKE: "Synthszr Take:" + 5-7 Sätze freier Fluss mit klarer Haltung. Wenn im User-Prompt ein BLICKWINKEL vorgegeben ist, führe den Take aus GENAU dieser Perspektive und wiederhole nicht die offensichtliche, naheliegende Kern-These der News.
```

- [ ] **Step 5: Winkel in writeSectionsBatch durchreichen**

In `writeSectionsBatch`, direkt nach der `heading`-Zeile (Z.706) den Winkel lesen:

```ts
      const heading = (plan.headings ?? {})[String(itemIdx)] || item.title
      const takeAngle = (plan.takeAngles ?? {})[String(itemIdx)] || undefined
```

Und im `writeSection`-Aufruf (Z.711-715) das context-Objekt ergänzen:

```ts
        writeSection(item, heading, model, {
          relevantCompanies: itemCompanies,
          cacheableUserPrefix: ctx.cacheableUserPrefix,
          effort,
          takeAngle,
        }),
```

- [ ] **Step 6: Typecheck + bestehende Tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc Exit 0, alle Tests grün (die Verdrahtung ist rein typseitig; keine Logik-Tests betroffen).

- [ ] **Step 7: Commit**

```bash
git add lib/claude/ghostwriter-pipeline.ts
git commit -m "feat(ghostwriter): Take-Winkel in writeSection nutzen (Prompt + Retrieval-Anreicherung)"
```

---

### Task 4: End-to-End-Verifikation (kein Commit)

**Files:**
- Temp: `scripts/_verify_angles_e2e.ts` (nach Lauf löschen)

**Interfaces:**
- Consumes: `planArticle`, `writeSectionsBatch`, `buildSectionContext` (bestehend)

- [ ] **Step 1: E2E-Verifikationsscript schreiben**

`scripts/_verify_angles_e2e.ts`:

```ts
import { planArticle, writeSectionsBatch, buildSectionContext } from '@/lib/claude/ghostwriter-pipeline'
import { getModelForUseCase } from '@/lib/ai/model-config'

async function main() {
  const planModel = await getModelForUseCase('article_planning')
  const writeModel = await getModelForUseCase('ghostwriter')
  const items = [
    { id: '1', title: 'Zhipu bringt GLM-5.2 zu einem Fünftel der Opus-Kosten', content: 'Open-weight, fast auf Opus-4.8-Niveau, ein Fünftel der Kosten.', source_display_name: 'X', source_url: null, source_identifier: 'x' },
    { id: '2', title: 'Cloudflare berechnet AI-Crawlern jeden Abruf', content: 'Pay per Crawl, HTTP 402 für Bots ohne Zahlung.', source_display_name: 'Verge', source_url: null, source_identifier: 'verge' },
    { id: '3', title: 'Benedict Evans: Token-Marge von 40% hält nicht', content: 'Frontier-Modelle werden Commodity, Kampf verlagert sich auf Chips.', source_display_name: 'Evans', source_url: null, source_identifier: 'evans' },
    { id: '4', title: 'Widerstand gegen Rechenzentren wächst', content: 'Metas 27-Mrd-Bau, Anwohner blockieren Projekte.', source_display_name: 'Verge', source_url: null, source_identifier: 'verge' },
  ]
  const plan = await planArticle(items, planModel)
  const ordered = plan.ordering.map((idx) => items[idx - 1])
  const ctx = await buildSectionContext(ordered, plan, null)
  const { sections } = await writeSectionsBatch(ordered, plan, ctx, 0, writeModel, 'high', 240_000, Date.now())
  sections.forEach((s, i) => {
    const take = (s.split(/synthszr take:/i)[1] || '').trim()
    const sents = take.split(/(?<=[.!?])\s+/).filter((x) => x.length > 3)
    console.log(`\n[${i + 1}] SCHLUSS: ${sents[sents.length - 1]?.slice(0, 100)}`)
  })
  console.log('\nPrüfen: clustern die Schluss-Thesen NICHT mehr auf eine Aussage? Kommen verschiedene Mattes-Konzepte (Intent/Jevons/Compute-Disziplin) vor?')
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Lauf + manuelle Bewertung**

Run:
```bash
set -a; source ~/.synthszr.env.prod; set +a
npx tsx scripts/_verify_angles_e2e.ts 2>&1 | grep -v "^\["
rm -f scripts/_verify_angles_e2e.ts
```
Expected: Die Take-Schluss-Sätze ziehen sichtbar verschiedene Konklusionen (nicht 4× „Commodity/Wert wandert nach unten"). Bei Bedarf `buildSectionContext`-Signatur an den echten Aufruf in `article-jobs/service.ts` angleichen (dort ist das kanonische Aufrufmuster).

- [ ] **Step 3: Ergebnis dokumentieren**

Befund (vorher/nachher-Vergleich zur 13.07-Stichprobe) an den User berichten. Kein Commit — Task 4 ist reine Verifikation.

---

## Self-Review

**Spec coverage:**
- Spec §1 Datenmodell → Task 1. ✓
- Spec §2 planArticle-Prompt (HART: max 1–2) → Task 2 Step 1–2. ✓
- Spec §3 thinking an → Task 2 Step 3. ✓
- Spec §4 Durchreichung → Task 3 Step 5. ✓
- Spec §5 writeSection (retrievalQuery, userPrompt, SECTION_SYSTEM_PROMPT) → Task 3 Step 2–4. ✓
- Spec §6 Robustheit (normalizeArticlePlan) → Task 1 Step 4. ✓
- Spec §7 Retrieval-Synergie → Task 3 Step 2. ✓
- Spec §8 Verifikation → Task 2 Step 4 + Task 4. ✓

**Placeholder scan:** Keine TBD/TODO; alle Code-Schritte mit vollständigem Code. ✓

**Type consistency:** `takeAngles: Record<string, string>` durchgängig; context-Feld `takeAngle?: string` in Signatur (Task 3 Step 1), Durchreichung (Step 5) und Nutzung (Step 2–3) namensgleich. ✓
