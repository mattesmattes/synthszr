# AI-Week Wrap-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Admin-Funktion, die die „Thema des Tages"-Abschnitte der letzten abgeschlossenen Woche (Mo–Sa) in EINEM Modellaufruf zu einem Wochenrückblick verbindet und als Entwurf ablegt.

**Architecture:** Drei Schichten mit klaren Grenzen — `lib/wrapup/collect.ts` sammelt und wählt (pure Logik plus eine DB-Abfrage), `lib/wrapup/generate.ts` baut Prompt und ruft das Modell, `app/api/admin/week-wrapup/route.ts` verdrahtet beides und legt den Entwurf an. Die UI ist eine schlanke Seite ohne Queue-Auswahl.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase, Anthropic SDK, Vitest.

## Global Constraints

- Alle Kommentare und UI-Texte auf Deutsch; technische Bezeichner englisch.
- Zeitzone für jede Datumsrechnung: `Europe/Berlin`. Serverzeit auf Vercel ist UTC — eine Wochengrenze ohne explizite Zone verschiebt sich um zwei Stunden.
- Anthropic-Aufrufe folgen dem Muster aus `lib/glossary/generate.ts`: `{ model, max_tokens, tools, tool_choice }`, KEIN `temperature`, KEIN `thinking` — außer über `getModelCapabilities`.
- PostgREST: jede Abfrage, die mehr als 1000 Zeilen liefern kann, paginiert mit `range()`. `.in()` nie mit mehr als 200 IDs.
- Take-Länge im Wrap-up: 2–3 Sätze (Hälfte der 5–7 aus `SECTION_SYSTEM_PROMPT`).
- Zeitraum: letzte abgeschlossene Woche, Montag bis Sonnabend. Sonntag nie enthalten.

---

### Task 1: Wochenfenster berechnen

**Files:**
- Create: `lib/wrapup/week.ts`
- Test: `tests/lib/wrapup-week.test.ts`

**Interfaces:**
- Produces: `lastCompleteWeek(now: Date): { mondayIso: string; saturdayEndIso: string; label: string }` — `mondayIso` ist der Montag 00:00 Berliner Zeit als ISO-String, `saturdayEndIso` der Sonntag 00:00 (exklusive obere Grenze), `label` z. B. `"3.–8. August 2026"`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/wrapup-week.test.ts
/**
 * Wochenfenster des Wrap-ups: die letzte ABGESCHLOSSENE Woche, Montag bis
 * Sonnabend.
 *
 * Die Zeitzone ist hier kein Detail: Vercel läuft auf UTC, der Betreiber und
 * die Artikel-Zeitstempel auf Europe/Berlin. Eine Wochengrenze ohne explizite
 * Zone verschiebt sich um zwei Stunden — ein Artikel von Montag 00:30 Berliner
 * Zeit fiele dann in die Vorwoche.
 */
import { describe, expect, it } from 'vitest'
import { lastCompleteWeek } from '@/lib/wrapup/week'

describe('lastCompleteWeek', () => {
  it('liefert von Sonntag aus die gerade vergangene Woche', () => {
    // Sonntag, 9. August 2026, 12:00 Berliner Zeit
    const w = lastCompleteWeek(new Date('2026-08-09T10:00:00Z'))
    expect(w.mondayIso.slice(0, 10)).toBe('2026-08-03')
    expect(w.saturdayEndIso.slice(0, 10)).toBe('2026-08-09')
  })

  it('liefert von Montag aus dieselbe Woche wie von Sonntag', () => {
    // Der Betreiber drückt Montag früh — er erwartet die Woche davor, nicht
    // die eine leere Zeile lange laufende neue.
    const w = lastCompleteWeek(new Date('2026-08-10T06:00:00Z'))
    expect(w.mondayIso.slice(0, 10)).toBe('2026-08-03')
  })

  it('liefert mitten in der Woche weiterhin die letzte abgeschlossene', () => {
    // Mittwoch, 12. August
    const w = lastCompleteWeek(new Date('2026-08-12T09:00:00Z'))
    expect(w.mondayIso.slice(0, 10)).toBe('2026-08-03')
  })

  it('schliesst den Sonntag aus: obere Grenze ist Sonntag 00:00', () => {
    const w = lastCompleteWeek(new Date('2026-08-09T10:00:00Z'))
    // Ein Artikel von Sonntag 08.? Nein — Samstag ist der 8., die Grenze der 9.
    expect(w.saturdayEndIso.slice(0, 10)).toBe('2026-08-09')
  })

  it('bildet ein lesbares Label', () => {
    const w = lastCompleteWeek(new Date('2026-08-09T10:00:00Z'))
    expect(w.label).toBe('3.–8. August 2026')
  })

  it('verkraftet einen Monatswechsel im Label', () => {
    // Woche vom 29. Juni bis 4. Juli 2026
    const w = lastCompleteWeek(new Date('2026-07-05T10:00:00Z'))
    expect(w.label).toBe('29. Juni – 4. Juli 2026')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/wrapup-week.test.ts`
Expected: FAIL mit `lastCompleteWeek is not a function`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/wrapup/week.ts
/**
 * Wochenfenster des Wrap-ups.
 *
 * IMMER die letzte ABGESCHLOSSENE Woche (Montag bis Sonnabend) — unabhängig
 * davon, wann der Knopf gedrückt wird. Betreiber-Entscheidung 2026-08-09: das
 * Ergebnis soll nicht am Klickzeitpunkt hängen.
 *
 * Sonntag ist bewusst nicht enthalten (Vorgabe „Montags bis Sonnabend"), die
 * obere Grenze ist deshalb Sonntag 00:00 und exklusiv zu lesen.
 */
const TZ = 'Europe/Berlin'

/** "YYYY-MM-DD" in Berliner Zeit — dasselbe Muster wie toBerlinDateStr in
 *  app/api/admin/analytics/stats/route.ts. */
function berlinDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
}

/** Wochentag (0=So … 6=Sa) in Berliner Zeit. Über den Mittag gerechnet, damit
 *  die Sommerzeit-Umstellung das Ergebnis nicht kippt. */
function berlinWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay()
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return berlinDateStr(new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0)))
}

/** ISO-Zeitpunkt für 00:00 Berliner Zeit an diesem Tag. Über den bekannten
 *  Offset-Trick: Mitternacht lokal, dann in UTC ausgedrückt. */
function berlinMidnightIso(dateStr: string): string {
  // Der Offset kann +01:00 oder +02:00 sein. Statt ihn zu berechnen, wird die
  // lokale Mitternacht über zwei Kandidaten bestimmt und die passende gewählt.
  const [y, m, d] = dateStr.split('-').map(Number)
  for (const offsetHours of [0, 1, 2, 3]) {
    const candidate = new Date(Date.UTC(y, m - 1, d, offsetHours, 0, 0))
    if (berlinDateStr(candidate) === dateStr) {
      const local = new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ, hour: '2-digit', hour12: false,
      }).format(candidate)
      if (local === '00') return candidate.toISOString()
    }
  }
  // Fallback: UTC-Mitternacht. Verschiebt das Fenster um höchstens zwei
  // Stunden und ist damit immer noch brauchbar.
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0)).toISOString()
}

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

function formatLabel(mondayStr: string, saturdayStr: string): string {
  const [my, mm, md] = mondayStr.split('-').map(Number)
  const [sy, sm, sd] = saturdayStr.split('-').map(Number)
  if (mm === sm && my === sy) return `${md}.–${sd}. ${MONTHS[sm - 1]} ${sy}`
  return `${md}. ${MONTHS[mm - 1]} – ${sd}. ${MONTHS[sm - 1]} ${sy}`
}

export function lastCompleteWeek(now: Date): {
  mondayIso: string
  saturdayEndIso: string
  label: string
} {
  const today = berlinDateStr(now)
  const dow = berlinWeekday(today) // 0=So, 1=Mo … 6=Sa
  // Zurück zum Montag DIESER Woche, dann eine Woche weiter zurück.
  // Sonntag (0) gehört zur ablaufenden Woche, zählt also wie Tag 7.
  const daysSinceMonday = dow === 0 ? 6 : dow - 1
  const thisMonday = addDays(today, -daysSinceMonday)
  const monday = addDays(thisMonday, -7)
  const saturday = addDays(monday, 5)
  const sunday = addDays(monday, 6)
  return {
    mondayIso: berlinMidnightIso(monday),
    saturdayEndIso: berlinMidnightIso(sunday),
    label: formatLabel(monday, saturday),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/wrapup-week.test.ts`
Expected: PASS, 6 Tests

- [ ] **Step 5: Commit**

```bash
git add lib/wrapup/week.ts tests/lib/wrapup-week.test.ts
git commit -m "feat(wrapup): Wochenfenster der letzten abgeschlossenen Woche"
```

---

### Task 2: Themen der Woche auswählen

**Files:**
- Create: `lib/wrapup/collect.ts`
- Test: `tests/lib/wrapup-collect.test.ts`

**Interfaces:**
- Consumes: nichts aus Task 1 (die Route verbindet beide).
- Produces:
  - `type WrapupTopic = { weekday: string; date: string; headline: string; body: string; postSlug: string }`
  - `pickTopicFromPost(content: unknown): { headline: string; body: string } | null` — wählt aus einem Artikel-Content den `topic`-Abschnitt oder ersatzweise den ersten.
  - `collectWeekTopics(supabase, mondayIso, saturdayEndIso): Promise<WrapupTopic[]>`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/wrapup-collect.test.ts
/**
 * Themenauswahl je Wochentag.
 *
 * Regel (Betreiber 2026-08-09): der Abschnitt mit bundleType 'topic'; fehlt er,
 * der ERSTE Abschnitt des Tages. Der Fallback ist kein Randfall — an Prod
 * gemessen hatte Dienstag der 04.08.2026 keinen topic-Abschnitt, in der ersten
 * geprüften Woche überhaupt.
 */
import { describe, expect, it } from 'vitest'
import { pickTopicFromPost } from '@/lib/wrapup/collect'

function heading(text: string, bundleType?: string) {
  return {
    type: 'heading',
    attrs: { level: 2, ...(bundleType ? { bundleType } : {}) },
    content: [{ type: 'text', text }],
  }
}
function para(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

describe('pickTopicFromPost', () => {
  it('nimmt den topic-Abschnitt, auch wenn er nicht der erste ist', () => {
    const doc = { type: 'doc', content: [
      heading('Erste News'), para('Text A.'),
      heading('Thema des Tages', 'topic'), para('Text B.'), para('Text C.'),
      heading('Dritte News'), para('Text D.'),
    ] }
    const r = pickTopicFromPost(doc)
    expect(r?.headline).toBe('Thema des Tages')
    expect(r?.body).toContain('Text B.')
    expect(r?.body).toContain('Text C.')
  })

  it('sammelt den Abschnitt bis zur naechsten Ueberschrift, nicht weiter', () => {
    const doc = { type: 'doc', content: [
      heading('Thema', 'topic'), para('Gehoert dazu.'),
      heading('Naechste'), para('Gehoert NICHT dazu.'),
    ] }
    const r = pickTopicFromPost(doc)
    expect(r?.body).toContain('Gehoert dazu.')
    expect(r?.body).not.toContain('NICHT')
  })

  it('faellt auf den ERSTEN Abschnitt zurueck, wenn kein topic markiert ist', () => {
    const doc = { type: 'doc', content: [
      heading('Erste News'), para('Text A.'),
      heading('Zweite News'), para('Text B.'),
    ] }
    const r = pickTopicFromPost(doc)
    expect(r?.headline).toBe('Erste News')
    expect(r?.body).toContain('Text A.')
  })

  it('ignoriert einen recap-Abschnitt bei der Suche nach topic', () => {
    const doc = { type: 'doc', content: [
      heading('Nachlese', 'recap'), para('Text R.'),
      heading('Thema', 'topic'), para('Text T.'),
    ] }
    expect(pickTopicFromPost(doc)?.headline).toBe('Thema')
  })

  it('liefert null bei einem Artikel ohne Ueberschriften', () => {
    expect(pickTopicFromPost({ type: 'doc', content: [para('Nur Text.')] })).toBeNull()
  })

  it('verkraftet null und kaputten Content', () => {
    expect(pickTopicFromPost(null)).toBeNull()
    expect(pickTopicFromPost({})).toBeNull()
    expect(pickTopicFromPost('kein json')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/wrapup-collect.test.ts`
Expected: FAIL mit `pickTopicFromPost is not a function`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/wrapup/collect.ts
/**
 * Sammelt die Themen der Woche für den Wrap-up.
 *
 * Quelle sind die FERTIGEN Artikel-Abschnitte, nicht die Roh-Items der
 * news_queue (Betreiber-Entscheidung 2026-08-09): sie sind redigiert,
 * freigegeben und tragen die Original-Headline. Das Modell formuliert um,
 * statt neu zu schreiben — ein Wrap-up, der inhaltlich vom veröffentlichten
 * Artikel abweicht, wäre schlimmer als keiner.
 */
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export interface WrapupTopic {
  /** "Montag" … "Sonnabend" */
  weekday: string
  /** "YYYY-MM-DD" */
  date: string
  headline: string
  body: string
  postSlug: string
}

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Sonnabend']

function textOf(node: unknown): string {
  const n = node as { type?: string; text?: string; content?: unknown[] }
  if (!n) return ''
  if (n.type === 'text') return n.text ?? ''
  return (n.content ?? []).map(textOf).join('')
}

/**
 * Wählt aus einem Artikel-Content den Abschnitt für den Wrap-up.
 *
 * Reihenfolge: `bundleType === 'topic'`, sonst der ERSTE Abschnitt. Der
 * Fallback ist kein Randfall — an Prod hatte Dienstag der 04.08.2026 keinen
 * topic-Abschnitt, in der ersten geprüften Woche.
 *
 * Der Abschnitt endet an der nächsten Überschrift. Ohne diese Grenze zöge der
 * Wrap-up den halben Artikel mit.
 */
export function pickTopicFromPost(content: unknown): { headline: string; body: string } | null {
  const parsed = typeof content === 'string'
    ? (() => { try { return JSON.parse(content) } catch { return null } })()
    : content
  const nodes = (parsed as { content?: unknown[] } | null)?.content
  if (!Array.isArray(nodes)) return null

  const headingIdx = nodes
    .map((n, i) => ({ n: n as Record<string, unknown>, i }))
    .filter((x) => x.n.type === 'heading')
  if (headingIdx.length === 0) return null

  const topic = headingIdx.find(
    (x) => ((x.n.attrs ?? {}) as Record<string, unknown>).bundleType === 'topic',
  )
  const chosen = topic ?? headingIdx[0]

  const nextHeadingPos = headingIdx.find((x) => x.i > chosen.i)?.i ?? nodes.length
  const body = nodes
    .slice(chosen.i + 1, nextHeadingPos)
    .map(textOf)
    .filter((t) => t.trim().length > 0)
    .join('\n\n')

  return { headline: textOf(chosen.n).trim(), body }
}

/**
 * Die Themen der Woche, chronologisch Montag → Sonnabend.
 *
 * Ein Tag ohne veröffentlichten Artikel entfällt ersatzlos — deshalb „bis zu
 * sechs" und nicht „genau sechs".
 */
export async function collectWeekTopics(
  supabase: AdminClient,
  mondayIso: string,
  saturdayEndIso: string,
): Promise<WrapupTopic[]> {
  const { data, error } = await supabase
    .from('generated_posts')
    .select('slug, created_at, content')
    .eq('status', 'published')
    .gte('created_at', mondayIso)
    .lt('created_at', saturdayEndIso)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Artikel der Woche nicht ladbar: ${error.message}`)

  const out: WrapupTopic[] = []
  const seenDays = new Set<string>()
  for (const row of (data ?? []) as Array<{ slug: string; created_at: string; content: unknown }>) {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' })
      .format(new Date(row.created_at))
    // Ein Tag, ein Thema. Erscheinen an einem Tag zwei Artikel, zählt der
    // frühere — die Sortierung oben ist aufsteigend.
    if (seenDays.has(date)) continue
    const picked = pickTopicFromPost(row.content)
    if (!picked) continue
    seenDays.add(date)
    const [y, m, d] = date.split('-').map(Number)
    const dow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay()
    out.push({
      weekday: WEEKDAYS[dow],
      date,
      headline: picked.headline,
      body: picked.body,
      postSlug: row.slug,
    })
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/wrapup-collect.test.ts`
Expected: PASS, 6 Tests

- [ ] **Step 5: Commit**

```bash
git add lib/wrapup/collect.ts tests/lib/wrapup-collect.test.ts
git commit -m "feat(wrapup): Themenauswahl je Wochentag mit Fallback auf die erste News"
```

---

### Task 3: Prompt und Modellaufruf

**Files:**
- Create: `lib/wrapup/generate.ts`
- Test: `tests/lib/wrapup-prompt.test.ts`

**Interfaces:**
- Consumes: `WrapupTopic` aus Task 2.
- Produces:
  - `buildWrapupPrompt(topics: WrapupTopic[], weekLabel: string): string`
  - `WRAPUP_SYSTEM_PROMPT: string`
  - `generateWrapup(topics: WrapupTopic[], weekLabel: string, model: string): Promise<{ title: string; markdown: string }>`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/wrapup-prompt.test.ts
/**
 * Der Wrap-up-Prompt.
 *
 * Getestet wird der PROMPT-TEXT, nicht das Modellverhalten — gleiche Bauart und
 * gleiche Grenze wie tests/lib/ghostwriter-lex-tags.test.ts. Ob sich das Modell
 * an die Vorgaben hält, ist nur an echten Läufen zu beobachten.
 */
import { describe, expect, it } from 'vitest'
import { buildWrapupPrompt, WRAPUP_SYSTEM_PROMPT } from '@/lib/wrapup/generate'
import type { WrapupTopic } from '@/lib/wrapup/collect'

const topics: WrapupTopic[] = [
  { weekday: 'Montag', date: '2026-08-03', headline: 'Alibaba stellt Qwen vor', body: 'Text Mo.', postSlug: 'a' },
  { weekday: 'Mittwoch', date: '2026-08-05', headline: 'Weisses Haus setzt auf Geheimhaltung', body: 'Text Mi.', postSlug: 'b' },
]
const prompt = buildWrapupPrompt(topics, '3.–8. August 2026')

describe('buildWrapupPrompt', () => {
  it('enthaelt jeden Wochentag mit seiner Original-Headline', () => {
    expect(prompt).toContain('Montag')
    expect(prompt).toContain('Alibaba stellt Qwen vor')
    expect(prompt).toContain('Mittwoch')
    expect(prompt).toContain('Weisses Haus setzt auf Geheimhaltung')
  })

  it('enthaelt die Volltexte der Abschnitte', () => {
    expect(prompt).toContain('Text Mo.')
    expect(prompt).toContain('Text Mi.')
  })

  it('nennt den Wochen-Zeitraum', () => {
    expect(prompt).toContain('3.–8. August 2026')
  })

  it('fordert die Ueberschriftenform "Wochentag — Original-Headline"', () => {
    expect(prompt).toMatch(/## Montag — Alibaba stellt Qwen vor/)
  })
})

describe('WRAPUP_SYSTEM_PROMPT', () => {
  it('deckelt den Take auf 2-3 Saetze — die Haelfte der 5-7 im Tagesartikel', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/2-3 Sätze/)
  })

  it('verlangt den Vorlauftext von 3-4 Zeilen VOR den Abschnitten', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/3-4 Zeilen/)
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/große Linie|grosse Linie/i)
  })

  it('verlangt Querbezuege zwischen den Themen', () => {
    // Der eigentliche Zweck des Ein-Aufruf-Designs: ohne diese Anweisung
    // entstuenden sechs unverbundene Zusammenfassungen.
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/aufeinander|Querbez|Zusammenhang/i)
  })

  it('verlangt eine reflektiertere Fassung, nicht eine Kopie', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toMatch(/neu formulier|reflektiert/i)
  })

  it('behaelt die Synthszr-Take-Markierung bei', () => {
    expect(WRAPUP_SYSTEM_PROMPT).toContain('Synthszr Take:')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/wrapup-prompt.test.ts`
Expected: FAIL mit `buildWrapupPrompt is not a function`

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/wrapup/generate.ts
/**
 * Erzeugt den Wochenrückblick aus den Themen der Woche.
 *
 * EIN Modellaufruf über alle Themen, nicht einer je Thema. Das ist die zentrale
 * Entscheidung des Designs und folgt direkt aus der Anforderung, dass sich die
 * Themen aufeinander beziehen sollen: Querbezüge entstehen nur, wenn das Modell
 * alle gleichzeitig sieht. Sechs getrennte Aufrufe könnten das strukturell
 * nicht — und wären dazu teurer.
 */
import Anthropic from '@anthropic-ai/sdk'
import { getModelCapabilities } from '@/lib/claude/model-capabilities'
import { assertNonEmptyModelOutput } from '@/lib/claude/ghostwriter-pipeline'
import type { WrapupTopic } from '@/lib/wrapup/collect'

export const WRAPUP_SYSTEM_PROMPT = `Du schreibst den Wochenrückblick des KI-Newsletters Synthszr auf DEUTSCH.

Du bekommst die wichtigsten Nachrichten einer Woche, je eine pro Wochentag, im Volltext. Sie sind bereits erschienen. Deine Aufgabe ist NICHT, sie zu wiederholen, sondern sie aus dem Abstand einer Woche neu zu erzählen und miteinander zu verbinden.

AUFBAU — genau in dieser Reihenfolge:

1. VORLAUF: 3-4 Zeilen ohne Überschrift. Sie benennen die große Linie der Woche — was sich in der Summe verschoben hat. Keine Aufzählung der Themen, keine Ankündigung ("In dieser Woche lesen Sie…"), sondern eine These.

2. Danach je Nachricht ein Abschnitt in der vorgegebenen Reihenfolge:
   - Überschrift als "## Wochentag — Original-Headline", beides unverändert übernommen.
   - 4-6 Sätze Bericht. NEU FORMULIERT und REFLEKTIERTER als das Original: Was am Tag selbst als Meldung stand, ist eine Woche später eine Entwicklung. Stelle QUERBEZÜGE zu den anderen Tagen her, wo es sie gibt — genau dafür siehst du alle Nachrichten gleichzeitig. Erfinde keine Bezüge, wo keine sind.
   - "Synthszr Take:" + 2-3 Sätze. SEHR kurz, sehr pointiert, eine klare Haltung. Kein Referat des Berichts darüber.

REGELN:
- Keine Zwischenüberschriften außer den vorgegebenen. Keine Bullet Points.
- Keine Zahlen, Namen oder Fakten erfinden. Alles steht in den Quelltexten.
- Der Take ist der einzige Ort für Wertung. Der Bericht bleibt Bericht.
- {Company}-Tags und {lex:}-Tags NICHT setzen — der Wrap-up verlinkt über die Originalartikel.`

export function buildWrapupPrompt(topics: WrapupTopic[], weekLabel: string): string {
  const blocks = topics.map((t) => `### ${t.weekday} — ${t.headline}\n\n${t.body}`).join('\n\n---\n\n')
  const outline = topics.map((t) => `## ${t.weekday} — ${t.headline}`).join('\n')
  return `WOCHENRÜCKBLICK für den Zeitraum ${weekLabel}.

Diese ${topics.length} Nachrichten sind in dieser Woche erschienen, in dieser Reihenfolge:

<nachrichten>
${blocks}
</nachrichten>

Schreibe den Rückblick. Die Überschriften lauten EXAKT so, in dieser Reihenfolge:

${outline}

Beginne mit dem Vorlauf (3-4 Zeilen, keine Überschrift), dann die Abschnitte.`
}

/**
 * Ruft das Modell und liefert Titel und Markdown.
 *
 * Der Titel entsteht aus dem Zeitraum, nicht aus dem Modell: er ist bei einem
 * Wochenrückblick vorhersagbar, und ein Modellaufruf dafür wäre verschwendet.
 */
export async function generateWrapup(
  topics: WrapupTopic[],
  weekLabel: string,
  model: string,
): Promise<{ title: string; markdown: string }> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const { adaptiveThinking, supportsDisabledThinking } = getModelCapabilities(model)

  const params: Record<string, unknown> = {
    model,
    max_tokens: 16000,
    system: [{ type: 'text', text: WRAPUP_SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: buildWrapupPrompt(topics, weekLabel) }],
  }
  // Thinking bewusst AUS: die Aufgabe ist Umformulieren mit Querbezügen, kein
  // Reasoning-Problem — und max_tokens deckt bei adaptivem Thinking Denken UND
  // Text gemeinsam ab. Nur setzen, wo das Modell es verträgt (Fable 5 lehnt
  // 'disabled' mit HTTP 400 ab, s. model-capabilities.ts).
  if (adaptiveThinking && supportsDisabledThinking) params.thinking = { type: 'disabled' }

  let text = ''
  let stopReason: string | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = anthropic.messages.stream(params as any)
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
    } else if (event.type === 'message_delta') {
      stopReason = event.delta.stop_reason ?? stopReason
    }
  }
  // Ein Wrap-up hängt an EINEM Aufruf — ohne diese Prüfung landete eine
  // Verweigerung als leerer Entwurf in der Datenbank.
  assertNonEmptyModelOutput(text, `Wochenrückblick (${model})`, stopReason)

  return { title: `AI-Week Wrap-up: ${weekLabel}`, markdown: text.trim() }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/wrapup-prompt.test.ts`
Expected: PASS, 9 Tests

- [ ] **Step 5: Commit**

```bash
git add lib/wrapup/generate.ts tests/lib/wrapup-prompt.test.ts
git commit -m "feat(wrapup): Prompt und Modellaufruf in einem Zug ueber alle Themen"
```

---

### Task 4: API-Route

**Files:**
- Create: `app/api/admin/week-wrapup/route.ts`
- Test: `tests/api/week-wrapup-route.test.ts`

**Interfaces:**
- Consumes: `lastCompleteWeek` (Task 1), `collectWeekTopics` (Task 2), `generateWrapup` (Task 3).
- Produces: `POST /api/admin/week-wrapup` → `{ postId, slug, title, topicCount, weekLabel }` oder `{ error }`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/week-wrapup-route.test.ts
/**
 * Route des Wochenrückblicks.
 *
 * Geprüft werden die drei Wege, die schiefgehen können und für die der
 * Betreiber eine klare Meldung braucht: keine Anmeldung, leere Woche,
 * Verweigerung des Modells. Der Erfolgsfall ist der einfachste.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  collectWeekTopics: vi.fn(),
  generateWrapup: vi.fn(),
  insert: vi.fn(),
  getModelForUseCase: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/wrapup/collect', () => ({ collectWeekTopics: mocks.collectWeekTopics }))
vi.mock('@/lib/wrapup/generate', () => ({ generateWrapup: mocks.generateWrapup }))
vi.mock('@/lib/ai/model-config', () => ({ getModelForUseCase: mocks.getModelForUseCase }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      insert: () => ({ select: () => ({ single: mocks.insert }) }),
    }),
  }),
}))

function req() {
  return new NextRequest('https://x/api/admin/week-wrapup', { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ isAdmin: true })
  mocks.getModelForUseCase.mockResolvedValue('claude-opus-5')
  mocks.collectWeekTopics.mockResolvedValue([
    { weekday: 'Montag', date: '2026-08-03', headline: 'H1', body: 'B1', postSlug: 'a' },
  ])
  mocks.generateWrapup.mockResolvedValue({ title: 'AI-Week Wrap-up: 3.–8. August 2026', markdown: '## Montag — H1\n\nText.' })
  mocks.insert.mockResolvedValue({ data: { id: 'post-1' }, error: null })
})

describe('POST /api/admin/week-wrapup', () => {
  it('lehnt ohne Anmeldung mit 401 ab, ohne das Modell zu rufen', async () => {
    mocks.getSession.mockResolvedValue(null)
    const { POST } = await import('@/app/api/admin/week-wrapup/route')
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(mocks.generateWrapup).not.toHaveBeenCalled()
  })

  it('meldet eine leere Woche klar, statt einen leeren Entwurf anzulegen', async () => {
    mocks.collectWeekTopics.mockResolvedValue([])
    const { POST } = await import('@/app/api/admin/week-wrapup/route')
    const res = await POST(req())
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/keine|leer/i)
    expect(mocks.generateWrapup).not.toHaveBeenCalled()
  })

  it('legt den Entwurf an und meldet die Zahl der Themen', async () => {
    const { POST } = await import('@/app/api/admin/week-wrapup/route')
    const res = await POST(req())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.postId).toBe('post-1')
    expect(body.topicCount).toBe(1)
  })

  it('reicht eine Verweigerung als Fehlermeldung durch', async () => {
    // Ein Wrap-up haengt an EINEM Aufruf — eine Verweigerung kostet den ganzen
    // Post. Der Betreiber muss den Grund sehen (s. reference_modell_verweigerung).
    mocks.generateWrapup.mockRejectedValue(new Error('Modell hat die Antwort verweigert (stop_reason: refusal)'))
    const { POST } = await import('@/app/api/admin/week-wrapup/route')
    const res = await POST(req())
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error).toMatch(/verweigert/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/week-wrapup-route.test.ts`
Expected: FAIL mit `Cannot find package '@/app/api/admin/week-wrapup/route'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/admin/week-wrapup/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { getModelForUseCase } from '@/lib/ai/model-config'
import { lastCompleteWeek } from '@/lib/wrapup/week'
import { collectWeekTopics } from '@/lib/wrapup/collect'
import { generateWrapup } from '@/lib/wrapup/generate'
import { markdownToTiptap } from '@/lib/utils/markdown-to-tiptap'
import { buildUniqueSlug } from '@/lib/article-jobs/unique-slug'

/**
 * Erzeugt den Wochenrückblick der letzten abgeschlossenen Woche als Entwurf.
 *
 * Kein article_jobs-Eintrag: der Job-Mechanismus existiert, weil 40 Sektionen
 * à 45-90s das 300s-Limit sprengen. Hier ist es EIN Aufruf über sechs
 * vorhandene Texte (~60-90s) — die Job-Infrastruktur wäre Aufwand ohne
 * Gegenwert. maxDuration deckt den Fall mit Reserve.
 */
export const maxDuration = 300

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const supabase = createAdminClient()
  const week = lastCompleteWeek(new Date())

  try {
    const topics = await collectWeekTopics(supabase, week.mondayIso, week.saturdayEndIso)
    if (topics.length === 0) {
      // Klare Meldung statt eines leeren Entwurfs: ein Wrap-up ohne Themen
      // wäre in der Liste nicht von einem misslungenen zu unterscheiden.
      return NextResponse.json(
        { error: `Keine veröffentlichten Artikel im Zeitraum ${week.label} gefunden.` },
        { status: 400 },
      )
    }

    const model = (body.model as string) || (await getModelForUseCase('ghostwriter'))
    const { title, markdown } = await generateWrapup(topics, week.label, model)

    const tiptap = markdownToTiptap(markdown)
    const slug = await buildUniqueSlug(
      slugify(`ai-week-wrap-up-${week.label}`),
      async (s) => {
        const { data } = await supabase.from('generated_posts').select('id').eq('slug', s).maybeSingle()
        return !!data
      },
    )

    const { data: post, error } = await supabase
      .from('generated_posts')
      .insert({
        title,
        slug,
        excerpt: `Der Rückblick auf die Woche vom ${week.label}.`,
        category: 'AI & Tech',
        content: JSON.stringify(tiptap),
        word_count: markdown.split(/\s+/).length,
        status: 'draft',
        ai_model: model,
      })
      .select('id')
      .single()
    if (error) throw new Error(`Entwurf nicht speicherbar: ${error.message}`)

    return NextResponse.json({
      postId: (post as { id: string }).id,
      slug,
      title,
      topicCount: topics.length,
      weekLabel: week.label,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler'
    console.error('[WeekWrapup]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/week-wrapup-route.test.ts`
Expected: PASS, 4 Tests

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/week-wrapup/route.ts tests/api/week-wrapup-route.test.ts
git commit -m "feat(wrapup): Route erzeugt den Wochenrueckblick als Entwurf"
```

---

### Task 5: Admin-Seite

**Files:**
- Create: `app/admin/week-wrapup/page.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/week-wrapup` aus Task 4.
- Produces: nichts für spätere Tasks.

- [ ] **Step 1: Seite anlegen**

```tsx
// app/admin/week-wrapup/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, CalendarRange, AlertCircle } from 'lucide-react'

/**
 * AI-Week Wrap-up: fasst die „Thema des Tages"-Nachrichten der letzten
 * abgeschlossenen Woche zu einem Post zusammen.
 *
 * Bewusst KEINE Kopie von create-article/page.tsx (1.000+ Zeilen): die gesamte
 * Queue-Auswahl entfällt, weil die Themen durch den Zeitraum feststehen. Es
 * bleibt ein Knopf.
 */
export default function WeekWrapupPage() {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ postId: string; title: string; topicCount: number; weekLabel: string } | null>(null)

  async function generate() {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/admin/week-wrapup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `Fehlgeschlagen (HTTP ${res.status})`)
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehlgeschlagen')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <CalendarRange className="h-6 w-6" />
          AI-Week Wrap-up
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fasst die „Thema des Tages"-Nachrichten der letzten abgeschlossenen Woche
          (Montag bis Sonnabend) zu einem Rückblick zusammen.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rückblick erzeugen</CardTitle>
          <CardDescription className="text-xs">
            Ein Modell-Aufruf über alle Themen der Woche — die Abschnitte werden neu
            formuliert und aufeinander bezogen. Das Ergebnis ist ein Entwurf, den du
            vor dem Veröffentlichen prüfst.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={generate} disabled={running}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarRange className="mr-2 h-4 w-4" />}
            {running ? 'Erzeuge Rückblick…' : 'Wrap-up erzeugen'}
          </Button>

          {running && (
            <p className="text-xs text-muted-foreground">
              Das dauert etwa eine Minute. Das Fenster muss offen bleiben.
            </p>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {result && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{result.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {result.topicCount} Themen aus der Woche {result.weekLabel} zusammengefasst.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => router.push(`/admin/generated-articles/edit/${result.postId}`)}
              >
                Im Editor öffnen
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: keine Ausgabe

- [ ] **Step 3: Volle Suite**

Run: `npx vitest run`
Expected: alle Tests grün

- [ ] **Step 4: Commit**

```bash
git add app/admin/week-wrapup/page.tsx
git commit -m "feat(wrapup): Admin-Seite mit einem Knopf"
```

---

### Task 6: Verlinkung im Admin-Menü

**Files:**
- Modify: `components/admin/admin-nav.tsx:63-68`

**Interfaces:**
- Consumes: die Seite aus Task 5 unter `/admin/week-wrapup`.

- [ ] **Step 1: Link ergaenzen**

Direkt hinter dem Eintrag „AI Artikel erstellen" einfügen. `CalendarRange` zum
`lucide-react`-Import der Datei hinzufügen:

```tsx
      {
        label: 'AI Artikel erstellen',
        href: '/admin/create-article',
        icon: Wand2,
        highlight: true
      },
      {
        label: 'AI-Week Wrap-up',
        href: '/admin/week-wrapup',
        icon: CalendarRange,
      },
```

`highlight` bleibt beim Tagesartikel: er ist die tägliche Handlung, das Wrap-up
die wöchentliche.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: keine Ausgabe

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(wrapup): Link im Admin-Menue"
```

---

### Task 7: Prod-Verifikation

- [ ] **Step 1: Deploy abwarten**

Run: `vercel ls --yes | sed -n '6,8p'`
Expected: oberster Eintrag `● Ready`

- [ ] **Step 2: Wochenfenster gegen echte Daten pruefen**

Ein Wegwerf-Skript unter `scripts/_wrapup_check.ts` anlegen, das `lastCompleteWeek(new Date())` und `collectWeekTopics` gegen die Prod-DB laufen lässt und die gefundenen Themen ausgibt. Erwartung: bis zu sechs Zeilen, chronologisch Montag → Sonnabend, jede mit Wochentag und Headline. Danach das Skript löschen.

- [ ] **Step 3: Ergebnis dem Betreiber vorlegen**

Die gefundenen Themen nennen und fragen, ob der Rückblick erzeugt werden soll — der Aufruf kostet Geld, und die Auswahl ist die Grundlage des Ergebnisses.
