# Abo-Kosten (kostenpflichtige Newsletter) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-Seite, die kostenpflichtige Newsletter-Abos aus Gmail erkennt, mit monatlichen Kosten auflistet und pro Abo einen Kündigungs-Workflow bietet.

**Architecture:** Wiederverwendung der bestehenden `GmailClient`-Integration (`gmail_tokens`) für einen Hybrid-Scan (Gmail-Query filtert Kandidaten → LLM klassifiziert). Ergebnisse in Supabase-Tabelle `paid_subscriptions`. Client-Seite (Supabase-Browser-Client für Reads/Status) + API-Routes für Scan und Kündigung. Kündigung: One-Click-Unsubscribe serverseitig (HTTP), sonst Link im Browser des Nutzers. Keine serverseitige Browser-Automation.

**Tech Stack:** Next.js (App Router), TypeScript, Supabase (Postgres), `@anthropic-ai/sdk` (Haiku-Klasse via `getModelForUseCase`), `googleapis` (Gmail), shadcn/ui, vitest.

## Global Constraints

- Sprache aller UI-Texte, Kommentare, Commit-Messages: **Deutsch** (technische Begriffe englisch).
- Migrationen: neue Datei `supabase/migrations/<UTC-timestamp>_<name>.sql`, idempotent (`IF NOT EXISTS`), aufgespielt via `supabase db push` (CLI, NICHT MCP — Projekt ist nicht im Supabase-MCP).
- `visibility`/Status-Werte über CHECK-Constraints absichern.
- LLM-Modell ausschließlich über `getModelForUseCase(...)`, kein hartkodiertes Modell.
- Admin-API-Routes: Auth-Gate via `getSession()` aus `@/lib/auth/session` (401 wenn keine Session), Muster wie `app/api/generate-article-thumbnails/route.ts`.
- Kündigung ist irreversibel/kostenwirksam: **nie** ohne explizite Bestätigung pro Abo; jeder Versuch wird in `cancel_log` protokolliert; keine Zahlungsdaten anfassen; kein Auto-Login.
- Commit-Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Tests laufen mit `npx vitest run <pfad>`.

---

## File Structure

- `supabase/migrations/<utc>_paid_subscriptions.sql` — Tabelle `paid_subscriptions` (Task 1)
- `lib/gmail/client.ts` — MODIFY: `EmailMessage` um Unsubscribe-Header erweitern + `searchEmails(query, maxResults)` (Task 2)
- `lib/ai/model-config.ts` — MODIFY: UseCase `subscription_detect` (Task 3)
- `lib/subscriptions/types.ts` — gemeinsame Typen (Task 4)
- `lib/subscriptions/detector.ts` — pure Helpers + LLM-Klassifikation + Scan-Orchestrierung (Task 4, 5)
- `lib/subscriptions/cancel.ts` — One-Click-Ausführung (Task 8)
- `app/api/admin/scan-subscriptions/route.ts` — Scan-Endpoint (Task 6)
- `app/api/admin/subscriptions/cancel/route.ts` — Kündigungs-Endpoint (Task 9)
- `components/admin/admin-nav.tsx` — MODIFY: Nav-Eintrag (Task 7)
- `app/admin/subscriptions/page.tsx` — UI (Task 7, 10)
- `tests/lib/subscriptions-detector.test.ts` — Unit-Tests pure Helpers (Task 4)
- `tests/lib/subscriptions-cancel.test.ts` — Unit-Tests Kündigung (Task 8)

---

## Task 1: Migration `paid_subscriptions`

**Files:**
- Create: `supabase/migrations/20260801120000_paid_subscriptions.sql`

**Interfaces:**
- Produces: Tabelle `paid_subscriptions` mit Spalten laut Spec §4; Dedup-Anker `provider_key` (unique).

- [ ] **Step 1: Migration schreiben**

```sql
-- Kostenpflichtige Newsletter-/E-Mail-Abos, erkannt aus der Gmail-Inbox.
-- Ein Eintrag pro Anbieter (Dedup über provider_key = normalisierter provider_name).
CREATE TABLE IF NOT EXISTS paid_subscriptions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name        TEXT NOT NULL,
  provider_key         TEXT NOT NULL,                    -- lowercase(getrimmt(provider_name)) — Dedup-Anker
  sender_domain        TEXT,                             -- nur Info, NICHT Dedup
  sender_email         TEXT,
  amount               NUMERIC(10,2),
  currency             TEXT,
  interval             TEXT DEFAULT 'unknown'
                         CHECK (interval IN ('monthly','yearly','quarterly','weekly','one_time','unknown')),
  amount_monthly       NUMERIC(10,2),
  last_payment_at      TIMESTAMPTZ,
  evidence_message_ids JSONB DEFAULT '[]'::jsonb,        -- [{id,subject,date,gmailLink}]
  unsubscribe_type     TEXT DEFAULT 'unknown'
                         CHECK (unsubscribe_type IN ('oneclick','http','mailto','login_portal','unknown')),
  unsubscribe_target   TEXT,
  is_content_source    BOOLEAN DEFAULT false,
  status               TEXT DEFAULT 'active'
                         CHECK (status IN ('active','cancelling','cancelled','ignored')),
  manually_added       BOOLEAN DEFAULT false,
  cancel_log           JSONB DEFAULT '[]'::jsonb,        -- [{ts,type,result,detail}]
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_paid_subscriptions_provider_key
  ON paid_subscriptions(provider_key);
CREATE INDEX IF NOT EXISTS idx_paid_subscriptions_status
  ON paid_subscriptions(status);
```

- [ ] **Step 2: Migration aufspielen**

Run: `supabase db push`
Expected: Migration wird angewendet, `paid_subscriptions` existiert (keine Fehler). Falls `supabase db push` interaktiv nach Bestätigung fragt, bestätigen.

- [ ] **Step 3: Verifizieren**

Run (Ad-hoc-Script, gegen Prod-DB mit `.env.production.local`):
```bash
npx tsx --env-file=.env.production.local -e "import('@supabase/supabase-js').then(async ({createClient})=>{const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);const {error}=await sb.from('paid_subscriptions').select('id').limit(1);console.log(error?('FEHLER: '+error.message):'OK Tabelle erreichbar')})"
```
Expected: `OK Tabelle erreichbar`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260801120000_paid_subscriptions.sql
git commit -m "feat(abo-kosten): Migration paid_subscriptions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `GmailClient` um Unsubscribe-Header + `searchEmails` erweitern

**Files:**
- Modify: `lib/gmail/client.ts` (Interface `EmailMessage` ~Zeile 4-13, `parseMessage` ~Zeile 224-252; neue Methode am Klassenende)

**Interfaces:**
- Consumes: bestehende `GmailClient`-Konstruktion `new GmailClient(refreshToken)`.
- Produces: `EmailMessage.listUnsubscribe: string | null`, `EmailMessage.listUnsubscribePost: string | null`; Methode `searchEmails(query: string, maxResults?: number): Promise<EmailMessage[]>`.

- [ ] **Step 1: `EmailMessage`-Interface erweitern**

In `lib/gmail/client.ts`, das Interface (Zeile 4-13) um zwei Felder ergänzen:

```ts
export interface EmailMessage {
  id: string
  threadId: string
  from: string
  subject: string
  date: Date
  snippet: string
  htmlBody: string | null
  textBody: string | null
  listUnsubscribe: string | null      // Header "List-Unsubscribe"
  listUnsubscribePost: string | null  // Header "List-Unsubscribe-Post" (RFC 8058 One-Click)
}
```

- [ ] **Step 2: `parseMessage` die Header mitlesen lassen**

Im `return`-Objekt von `parseMessage` (Zeile 242-251) die beiden Felder ergänzen (getHeader existiert dort bereits):

```ts
    return {
      id: message.id,
      threadId: message.threadId,
      from,
      subject,
      date: dateStr ? new Date(dateStr) : new Date(),
      snippet: message.snippet || '',
      htmlBody,
      textBody,
      listUnsubscribe: getHeader('List-Unsubscribe') || null,
      listUnsubscribePost: getHeader('List-Unsubscribe-Post') || null,
    }
```

- [ ] **Step 3: `searchEmails`-Methode hinzufügen**

Ans Ende der Klasse `GmailClient` (vor der schließenden `}` bei Zeile 644):

```ts
  /**
   * Führt eine beliebige Gmail-Suchquery aus und liefert vollständige EmailMessages
   * (inkl. List-Unsubscribe-Header). Genutzt vom Abo-Scan.
   */
  async searchEmails(query: string, maxResults: number = 300): Promise<EmailMessage[]> {
    const listResponse = await this.gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
      includeSpamTrash: false,
    })
    const messages = listResponse.data.messages || []
    const emails: EmailMessage[] = []
    for (const msg of messages) {
      if (!msg.id) continue
      try {
        const full = await this.gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full',
        })
        const email = this.parseMessage(full.data)
        if (email) emails.push(email)
      } catch (error) {
        console.error('[Gmail] searchEmails: error fetching', msg.id, error)
      }
    }
    return emails
  }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: keine neuen Fehler in `lib/gmail/client.ts`. (Bestehende Aufrufer von `parseMessage` erhalten die neuen Felder automatisch — kein Aufrufer bricht, da nur additiv.)

- [ ] **Step 5: Commit**

```bash
git add lib/gmail/client.ts
git commit -m "feat(abo-kosten): GmailClient.searchEmails + List-Unsubscribe-Header

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: UseCase `subscription_detect` in Modell-Config

**Files:**
- Modify: `lib/ai/model-config.ts` (Union `UseCase` ~Zeile 10-22, `USE_CASE_DEFINITIONS` ~Zeile 31-104)

**Interfaces:**
- Produces: `getModelForUseCase('subscription_detect')` → günstiges Klassifikationsmodell.

- [ ] **Step 1: UseCase ergänzen**

Union `UseCase` (Zeile 10-22) um `| 'subscription_detect'` erweitern und in `USE_CASE_DEFINITIONS` (vor der schließenden `}` bei Zeile 104) einfügen:

```ts
  subscription_detect: {
    label: 'Abo-Erkennung',
    description: 'Kostenpflichtige Newsletter-Abos aus Gmail-Mails klassifizieren',
    defaultModel: 'claude-haiku-4-5-20251001',
    allowedProviders: ['anthropic'],
  },
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: keine Fehler (Record ist vollständig, da neuer Key ergänzt).

- [ ] **Step 3: Commit**

```bash
git add lib/ai/model-config.ts
git commit -m "feat(abo-kosten): UseCase subscription_detect (Haiku)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `lib/subscriptions/detector.ts` — pure Helpers (+ Typen)

**Files:**
- Create: `lib/subscriptions/types.ts`
- Create: `lib/subscriptions/detector.ts`
- Test: `tests/lib/subscriptions-detector.test.ts`

**Interfaces:**
- Produces:
  - `type Interval = 'monthly'|'yearly'|'quarterly'|'weekly'|'one_time'|'unknown'`
  - `type UnsubscribeType = 'oneclick'|'http'|'mailto'|'login_portal'|'unknown'`
  - `deriveProviderKey(providerName: string): string`
  - `normalizeMonthly(amount: number, interval: Interval): number`
  - `classifyUnsubscribe(listUnsubscribe: string|null, listUnsubscribePost: string|null, senderDomain: string): { type: UnsubscribeType; target: string|null }`

- [ ] **Step 1: Typen anlegen**

`lib/subscriptions/types.ts`:

```ts
export type Interval = 'monthly' | 'yearly' | 'quarterly' | 'weekly' | 'one_time' | 'unknown'
export type UnsubscribeType = 'oneclick' | 'http' | 'mailto' | 'login_portal' | 'unknown'

export interface EvidenceMessage {
  id: string
  subject: string
  date: string // ISO
  gmailLink: string
}

/** Ergebnis der LLM-Klassifikation einer einzelnen Mail. */
export interface DetectionResult {
  isPaid: boolean
  providerName: string
  amount: number | null
  currency: string | null
  interval: Interval
  confidence: number
}

/** Ein zusammengeführtes Abo (vor dem Upsert in paid_subscriptions). */
export interface DetectedSubscription {
  providerName: string
  providerKey: string
  senderDomain: string
  senderEmail: string
  amount: number | null
  currency: string | null
  interval: Interval
  amountMonthly: number | null
  lastPaymentAt: string // ISO
  evidenceMessageIds: EvidenceMessage[]
  unsubscribeType: UnsubscribeType
  unsubscribeTarget: string | null
}
```

- [ ] **Step 2: Failing Tests schreiben**

`tests/lib/subscriptions-detector.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveProviderKey, normalizeMonthly, classifyUnsubscribe } from '@/lib/subscriptions/detector'

describe('deriveProviderKey', () => {
  it('normalisiert auf lowercase + trim', () => {
    expect(deriveProviderKey('  Stratechery ')).toBe('stratechery')
    expect(deriveProviderKey('The Information')).toBe('the information')
  })
})

describe('normalizeMonthly', () => {
  it('rechnet Intervalle auf Monat', () => {
    expect(normalizeMonthly(120, 'yearly')).toBeCloseTo(10)
    expect(normalizeMonthly(30, 'quarterly')).toBeCloseTo(10)
    expect(normalizeMonthly(5, 'weekly')).toBeCloseTo(21.67, 1)
    expect(normalizeMonthly(9, 'monthly')).toBe(9)
  })
  it('one_time/unknown → 0 (kein laufender Monatsbeitrag)', () => {
    expect(normalizeMonthly(50, 'one_time')).toBe(0)
    expect(normalizeMonthly(50, 'unknown')).toBe(0)
  })
})

describe('classifyUnsubscribe', () => {
  it('One-Click, wenn List-Unsubscribe-Post gesetzt + https-URL', () => {
    const r = classifyUnsubscribe('<https://x.com/u?abc>', 'List-Unsubscribe=One-Click', 'x.com')
    expect(r.type).toBe('oneclick')
    expect(r.target).toBe('https://x.com/u?abc')
  })
  it('http, wenn nur https-List-Unsubscribe ohne One-Click', () => {
    const r = classifyUnsubscribe('<https://x.com/u?abc>', null, 'x.com')
    expect(r.type).toBe('http')
    expect(r.target).toBe('https://x.com/u?abc')
  })
  it('mailto, wenn List-Unsubscribe mailto ist', () => {
    const r = classifyUnsubscribe('<mailto:unsub@x.com?subject=stop>', null, 'x.com')
    expect(r.type).toBe('mailto')
    expect(r.target).toBe('mailto:unsub@x.com?subject=stop')
  })
  it('login_portal für bekannte Billing-Domains ohne Header', () => {
    const r = classifyUnsubscribe(null, null, 'stripe.com')
    expect(r.type).toBe('login_portal')
  })
  it('unknown, wenn kein Header und keine bekannte Portal-Domain', () => {
    const r = classifyUnsubscribe(null, null, 'randomblog.example')
    expect(r.type).toBe('unknown')
    expect(r.target).toBeNull()
  })
})
```

- [ ] **Step 3: Tests laufen (müssen fehlschlagen)**

Run: `npx vitest run tests/lib/subscriptions-detector.test.ts`
Expected: FAIL — `detector.ts` existiert noch nicht / Funktionen undefiniert.

- [ ] **Step 4: `detector.ts` pure Helpers implementieren**

`lib/subscriptions/detector.ts`:

```ts
import type { Interval, UnsubscribeType } from '@/lib/subscriptions/types'

const BILLING_PORTAL_DOMAINS = [
  'stripe.com', 'paypal.com', 'apple.com', 'itunes.com',
  'play.google.com', 'google.com', 'chargebee.com', 'paddle.com',
]

/** Dedup-Schlüssel: lowercase + getrimmt. */
export function deriveProviderKey(providerName: string): string {
  return providerName.trim().toLowerCase()
}

/** Betrag auf Monat normalisieren. one_time/unknown zählen NICHT als laufender Beitrag. */
export function normalizeMonthly(amount: number, interval: Interval): number {
  switch (interval) {
    case 'monthly': return amount
    case 'yearly': return amount / 12
    case 'quarterly': return amount / 3
    case 'weekly': return amount * 52 / 12
    case 'one_time':
    case 'unknown':
    default: return 0
  }
}

/** Extrahiert die erste URL/mailto aus einem List-Unsubscribe-Header-Wert (Format: <url>, <url>). */
function firstBracketed(value: string, scheme: 'https' | 'mailto'): string | null {
  const matches = value.match(/<([^>]+)>/g) || []
  for (const m of matches) {
    const inner = m.slice(1, -1)
    if (scheme === 'https' && inner.startsWith('https:')) return inner
    if (scheme === 'mailto' && inner.startsWith('mailto:')) return inner
  }
  return null
}

/**
 * Klassifiziert den Kündigungsweg deterministisch aus den Mail-Headern.
 * Priorität: One-Click (RFC 8058) > https-Link > mailto > Portal-Domain > unknown.
 */
export function classifyUnsubscribe(
  listUnsubscribe: string | null,
  listUnsubscribePost: string | null,
  senderDomain: string,
): { type: UnsubscribeType; target: string | null } {
  const https = listUnsubscribe ? firstBracketed(listUnsubscribe, 'https') : null
  const mailto = listUnsubscribe ? firstBracketed(listUnsubscribe, 'mailto') : null

  if (https && listUnsubscribePost && /one-click/i.test(listUnsubscribePost)) {
    return { type: 'oneclick', target: https }
  }
  if (https) return { type: 'http', target: https }
  if (mailto) return { type: 'mailto', target: mailto }

  const domainLower = (senderDomain || '').toLowerCase()
  if (BILLING_PORTAL_DOMAINS.some((d) => domainLower.endsWith(d))) {
    return { type: 'login_portal', target: null }
  }
  return { type: 'unknown', target: null }
}
```

- [ ] **Step 5: Tests laufen (müssen bestehen)**

Run: `npx vitest run tests/lib/subscriptions-detector.test.ts`
Expected: PASS (alle 3 describe-Blöcke).

- [ ] **Step 6: Commit**

```bash
git add lib/subscriptions/types.ts lib/subscriptions/detector.ts tests/lib/subscriptions-detector.test.ts
git commit -m "feat(abo-kosten): detector pure helpers (providerKey, normalizeMonthly, classifyUnsubscribe)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: LLM-Klassifikation + Scan-Orchestrierung in `detector.ts`

**Files:**
- Modify: `lib/subscriptions/detector.ts` (LLM- + Scan-Funktionen anhängen)
- Test: `tests/lib/subscriptions-detector.test.ts` (Prompt-/Parse-Tests ergänzen)

**Interfaces:**
- Consumes: `deriveProviderKey`, `normalizeMonthly`, `classifyUnsubscribe` (Task 4); `getModelForUseCase('subscription_detect')`; `GmailClient.searchEmails` + `EmailMessage` (Task 2, 3).
- Produces:
  - `buildDetectPrompt(emails: {from:string;subject:string;snippet:string}[]): string`
  - `parseDetectResponse(raw: unknown, count: number): Map<number, DetectionResult>`
  - `scanSubscriptions(refreshToken: string, contentSourceDomains: Set<string>): Promise<DetectedSubscription[]>`

- [ ] **Step 1: Failing Tests für Prompt/Parse ergänzen**

Ans Ende von `tests/lib/subscriptions-detector.test.ts`:

```ts
import { buildDetectPrompt, parseDetectResponse } from '@/lib/subscriptions/detector'

describe('buildDetectPrompt', () => {
  it('nummeriert die Mails und nennt Absender + Betreff', () => {
    const prompt = buildDetectPrompt([{ from: 'Stratechery <a@stratechery.com>', subject: 'Receipt', snippet: '$12' }])
    expect(prompt).toContain('0.')
    expect(prompt).toContain('stratechery.com')
    expect(prompt).toContain('Receipt')
  })
})

describe('parseDetectResponse', () => {
  it('nimmt nur gültige Indizes mit isPaid=true', () => {
    const raw = { results: [
      { index: 0, is_paid: true, provider_name: 'Stratechery', amount: 12, currency: 'USD', interval: 'monthly', confidence: 0.9 },
      { index: 5, is_paid: true, provider_name: 'X', amount: 1, currency: 'USD', interval: 'monthly', confidence: 0.9 }, // out of range
    ] }
    const m = parseDetectResponse(raw, 1)
    expect(m.size).toBe(1)
    expect(m.get(0)?.providerName).toBe('Stratechery')
  })
  it('ignoriert ungültige interval-Werte → unknown', () => {
    const raw = { results: [{ index: 0, is_paid: true, provider_name: 'X', amount: 5, currency: 'EUR', interval: 'bogus', confidence: 0.5 }] }
    const m = parseDetectResponse(raw, 1)
    expect(m.get(0)?.interval).toBe('unknown')
  })
})
```

- [ ] **Step 2: Tests laufen (müssen fehlschlagen)**

Run: `npx vitest run tests/lib/subscriptions-detector.test.ts`
Expected: FAIL — `buildDetectPrompt`/`parseDetectResponse` undefiniert.

- [ ] **Step 3: LLM- + Scan-Code implementieren (an `detector.ts` anhängen)**

```ts
import { z } from 'zod'
import type { DetectionResult, DetectedSubscription, EvidenceMessage } from '@/lib/subscriptions/types'
import type { EmailMessage } from '@/lib/gmail/client'

const VALID_INTERVALS: Interval[] = ['monthly', 'yearly', 'quarterly', 'weekly', 'one_time', 'unknown']
const LLM_TIMEOUT_MS = 50_000
const LLM_BATCH_SIZE = 12
const MAX_CANDIDATES = 300

const ResponseSchema = z.object({ results: z.array(z.unknown()) })
const ResultSchema = z.object({
  index: z.number().int(),
  is_paid: z.boolean(),
  provider_name: z.string(),
  amount: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  interval: z.string(),
  confidence: z.number(),
})

/** Pure: baut den Klassifikations-Prompt für einen Batch Mails. */
export function buildDetectPrompt(emails: { from: string; subject: string; snippet: string }[]): string {
  const items = emails.map((e, i) => `${i}. Absender: ${e.from}\n   Betreff: ${e.subject}\n   Auszug: ${e.snippet}`).join('\n')
  return `Du klassifizierst E-Mails daraufhin, ob sie zu einem KOSTENPFLICHTIGEN Abonnement gehören (bezahlter Newsletter/Dienst).

REGELN:
- is_paid=true NUR bei echten Zahlungen/Rechnungen/aktiven kostenpflichtigen Abos (Quittung, "receipt", "invoice", "your subscription", Betrag sichtbar).
- Kostenlose Newsletter, Werbung, Terminmails, Login-Codes → is_paid=false.
- provider_name = der Dienst/Newsletter (z. B. "Stratechery"), NICHT der Zahlungsabwickler.
- interval = eines von: monthly, yearly, quarterly, weekly, one_time, unknown.
- amount = Zahl (ohne Währungssymbol) falls erkennbar, sonst null. currency = ISO (EUR/USD/…), sonst null.
- confidence = 0..1.
- Antworte für JEDE Mail mit ihrem Index.

MAILS:
${items}`
}

/** Pure: validiert die LLM-Antwort, liefert nur bezahlte, index-gültige Treffer. */
export function parseDetectResponse(raw: unknown, count: number): Map<number, DetectionResult> {
  const out = new Map<number, DetectionResult>()
  const outer = ResponseSchema.safeParse(raw)
  if (!outer.success) return out
  for (const r of outer.data.results) {
    const parsed = ResultSchema.safeParse(r)
    if (!parsed.success) continue
    const d = parsed.data
    if (d.index < 0 || d.index >= count) continue
    if (!d.is_paid) continue
    const interval = (VALID_INTERVALS as string[]).includes(d.interval) ? (d.interval as Interval) : 'unknown'
    out.set(d.index, {
      isPaid: true,
      providerName: d.provider_name,
      amount: d.amount ?? null,
      currency: d.currency ?? null,
      interval,
      confidence: d.confidence,
    })
  }
  return out
}

/** LLM-Klassifikation eines Batches. Fehler ⇒ leere Map (retrybar). */
async function classifyBatch(emails: { from: string; subject: string; snippet: string }[]): Promise<Map<number, DetectionResult>> {
  if (emails.length === 0) return new Map()
  if (!process.env.ANTHROPIC_API_KEY) return new Map()
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const { getModelForUseCase } = await import('@/lib/ai/model-config')
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const tool = {
    name: 'classify_subscriptions',
    description: 'Klassifiziere jede Mail als bezahltes Abo (mit Betrag/Intervall) oder nicht',
    input_schema: {
      type: 'object' as const,
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              index: { type: 'integer' }, is_paid: { type: 'boolean' },
              provider_name: { type: 'string' }, amount: { type: ['number', 'null'] },
              currency: { type: ['string', 'null'] }, interval: { type: 'string' },
              confidence: { type: 'number' },
            },
            required: ['index', 'is_paid', 'provider_name', 'interval', 'confidence'],
          },
        },
      },
      required: ['results'],
    },
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  try {
    const model = await getModelForUseCase('subscription_detect')
    const resp = await client.messages.create({
      model, max_tokens: 2048, tools: [tool],
      tool_choice: { type: 'tool', name: 'classify_subscriptions' },
      messages: [{ role: 'user', content: buildDetectPrompt(emails) }],
    }, { signal: controller.signal })
    const block = resp.content.find((b) => b.type === 'tool_use')
    return parseDetectResponse(block && 'input' in block ? block.input : null, emails.length)
  } catch {
    return new Map()
  } finally {
    clearTimeout(timer)
  }
}

function extractEmailAddress(from: string): string {
  const m = from.match(/<([^>]+)>/)
  return (m ? m[1] : from).trim().toLowerCase()
}

function domainOf(email: string): string {
  const at = email.lastIndexOf('@')
  return at >= 0 ? email.slice(at + 1) : ''
}

/**
 * Hybrid-Scan: Gmail-Query holt Kandidaten (letzte 12 Monate), LLM klassifiziert
 * batchweise, Ergebnisse werden pro Anbieter (providerKey) zusammengeführt.
 */
export async function scanSubscriptions(
  refreshToken: string,
  contentSourceDomains: Set<string>,
): Promise<DetectedSubscription[]> {
  const { GmailClient } = await import('@/lib/gmail/client')
  const gmail = new GmailClient(refreshToken)

  const query = 'newer_than:1y (receipt OR invoice OR "Ihre Rechnung" OR "payment" OR ' +
    '"subscription" OR "Zahlungsbestätigung" OR "renewed" OR from:stripe.com OR from:paypal.com)'
  const candidates: EmailMessage[] = await gmail.searchEmails(query, MAX_CANDIDATES)

  // Batchweise klassifizieren
  const byProvider = new Map<string, DetectedSubscription>()
  for (let i = 0; i < candidates.length; i += LLM_BATCH_SIZE) {
    const batch = candidates.slice(i, i + LLM_BATCH_SIZE)
    const forLlm = batch.map((e) => ({ from: e.from, subject: e.subject, snippet: e.snippet }))
    const results = await classifyBatch(forLlm)
    for (const [idx, det] of results) {
      const email = batch[idx]
      const senderEmail = extractEmailAddress(email.from)
      const senderDomain = domainOf(senderEmail)
      const providerKey = deriveProviderKey(det.providerName)
      const { type, target } = classifyUnsubscribe(email.listUnsubscribe, email.listUnsubscribePost, senderDomain)
      const evidence: EvidenceMessage = {
        id: email.id, subject: email.subject, date: email.date.toISOString(),
        gmailLink: `https://mail.google.com/mail/u/0/#all/${email.id}`,
      }
      const existing = byProvider.get(providerKey)
      if (!existing) {
        byProvider.set(providerKey, {
          providerName: det.providerName, providerKey, senderDomain, senderEmail,
          amount: det.amount, currency: det.currency, interval: det.interval,
          amountMonthly: det.amount != null ? Math.round(normalizeMonthly(det.amount, det.interval) * 100) / 100 : null,
          lastPaymentAt: email.date.toISOString(),
          evidenceMessageIds: [evidence],
          unsubscribeType: type, unsubscribeTarget: target,
        })
      } else {
        existing.evidenceMessageIds.push(evidence)
        // jüngste Zahlung gewinnt für Betrag/Intervall
        if (email.date.toISOString() > existing.lastPaymentAt) {
          existing.lastPaymentAt = email.date.toISOString()
          existing.amount = det.amount
          existing.currency = det.currency
          existing.interval = det.interval
          existing.amountMonthly = det.amount != null ? Math.round(normalizeMonthly(det.amount, det.interval) * 100) / 100 : null
          existing.senderEmail = senderEmail
          existing.senderDomain = senderDomain
          if (type !== 'unknown') { existing.unsubscribeType = type; existing.unsubscribeTarget = target }
        }
      }
    }
  }

  // Content-Quellen markieren erfolgt beim Upsert (Route), da is_content_source dort gesetzt wird.
  void contentSourceDomains
  return Array.from(byProvider.values())
}
```

- [ ] **Step 4: Tests laufen (müssen bestehen)**

Run: `npx vitest run tests/lib/subscriptions-detector.test.ts`
Expected: PASS (alle describe-Blöcke inkl. neue Prompt/Parse-Tests).

- [ ] **Step 5: Commit**

```bash
git add lib/subscriptions/detector.ts tests/lib/subscriptions-detector.test.ts
git commit -m "feat(abo-kosten): LLM-Klassifikation + Hybrid-Scan (scanSubscriptions)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Scan-API-Route `/api/admin/scan-subscriptions`

**Files:**
- Create: `app/api/admin/scan-subscriptions/route.ts`

**Interfaces:**
- Consumes: `scanSubscriptions` (Task 5); `getSession`; Supabase-Server-Client; Tabelle `gmail_tokens`, `newsletter_sources`, `paid_subscriptions`.
- Produces: `POST /api/admin/scan-subscriptions` → `{ scanned, upserted, total }`.

- [ ] **Step 1: Route schreiben**

`app/api/admin/scan-subscriptions/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { scanSubscriptions } from '@/lib/subscriptions/detector'

export const maxDuration = 300

export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  try {
    const supabase = await createClient()

    const { data: tokenData } = await supabase.from('gmail_tokens').select('refresh_token').single()
    if (!tokenData?.refresh_token) {
      return NextResponse.json({ error: 'Gmail nicht verbunden.' }, { status: 400 })
    }

    // Content-Quellen-Domains für is_content_source-Markierung
    const { data: sources } = await supabase.from('newsletter_sources').select('email')
    const contentDomains = new Set(
      (sources || []).map((s) => {
        const e = (s.email as string).toLowerCase()
        const at = e.lastIndexOf('@')
        return at >= 0 ? e.slice(at + 1) : e
      }),
    )

    const detected = await scanSubscriptions(tokenData.refresh_token, contentDomains)

    // Bestehende Overrides bewahren: ignored / manually_added / cancelled NICHT überschreiben.
    const { data: existing } = await supabase
      .from('paid_subscriptions')
      .select('provider_key, status, manually_added')
    const locked = new Set(
      (existing || [])
        .filter((r) => r.manually_added || r.status === 'ignored' || r.status === 'cancelled')
        .map((r) => r.provider_key as string),
    )

    let upserted = 0
    for (const d of detected) {
      if (locked.has(d.providerKey)) continue
      const { error } = await supabase.from('paid_subscriptions').upsert({
        provider_name: d.providerName,
        provider_key: d.providerKey,
        sender_domain: d.senderDomain,
        sender_email: d.senderEmail,
        amount: d.amount,
        currency: d.currency,
        interval: d.interval,
        amount_monthly: d.amountMonthly,
        last_payment_at: d.lastPaymentAt,
        evidence_message_ids: d.evidenceMessageIds,
        unsubscribe_type: d.unsubscribeType,
        unsubscribe_target: d.unsubscribeTarget,
        is_content_source: contentDomains.has(d.senderDomain),
        status: 'active',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'provider_key' })
      if (!error) upserted++
      else console.error('[scan-subscriptions] upsert error:', error.message)
    }

    return NextResponse.json({ scanned: detected.length, upserted, total: detected.length })
  } catch (error) {
    console.error('[scan-subscriptions] error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Scan fehlgeschlagen' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: keine Fehler in der neuen Route.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/scan-subscriptions/route.ts
git commit -m "feat(abo-kosten): Scan-API /api/admin/scan-subscriptions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Nav-Eintrag + Übersichts-Seite (Anzeige + Scan)

**Files:**
- Modify: `components/admin/admin-nav.tsx` (Icon-Import Zeile 6-29; Gruppe „Repo" Zeile 164-183)
- Create: `app/admin/subscriptions/page.tsx`

**Interfaces:**
- Consumes: Tabelle `paid_subscriptions` (Read via Supabase-Browser-Client); `POST /api/admin/scan-subscriptions` (Task 6).

- [ ] **Step 1: Nav-Eintrag ergänzen**

In `components/admin/admin-nav.tsx` den Icon-Import erweitern (z. B. `Wallet` zur bestehenden lucide-Importliste hinzufügen) und in Gruppe „Repo" nach „Newsletter-Quellen" (Zeile 173-176) einfügen:

```tsx
      {
        label: 'Abo-Kosten',
        href: '/admin/subscriptions',
        icon: Wallet
      },
```

- [ ] **Step 2: Seite schreiben**

`app/admin/subscriptions/page.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Wallet, Loader2, RefreshCw, EyeOff, Ban, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'

interface Subscription {
  id: string
  provider_name: string
  amount: number | null
  currency: string | null
  interval: string
  amount_monthly: number | null
  last_payment_at: string | null
  evidence_message_ids: { id: string; subject: string; date: string; gmailLink: string }[]
  unsubscribe_type: string
  unsubscribe_target: string | null
  is_content_source: boolean
  status: string
}

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => { fetchSubs() }, [])

  async function fetchSubs() {
    setLoading(true)
    const { data, error } = await supabase
      .from('paid_subscriptions')
      .select('*')
      .neq('status', 'ignored')
      .order('amount_monthly', { ascending: false })
    if (error) console.error('Error fetching subscriptions:', error)
    else setSubs(data || [])
    setLoading(false)
  }

  async function rescan() {
    setScanning(true)
    setScanMsg(null)
    try {
      const res = await fetch('/api/admin/scan-subscriptions', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scan fehlgeschlagen')
      setScanMsg(`${data.scanned} gefunden, ${data.upserted} aktualisiert`)
      await fetchSubs()
    } catch (e) {
      setScanMsg(e instanceof Error ? e.message : 'Fehler beim Scannen')
    } finally {
      setScanning(false)
    }
  }

  async function setStatus(id: string, status: string) {
    const { error } = await supabase
      .from('paid_subscriptions')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) alert('Fehler: ' + error.message)
    else fetchSubs()
  }

  const totalMonthly = subs
    .filter((s) => s.status !== 'cancelled')
    .reduce((sum, s) => sum + (s.amount_monthly || 0), 0)

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter">Abo-Kosten</h1>
          <p className="mt-1 text-muted-foreground">
            Monatlich gesamt: <span className="font-semibold text-foreground">{totalMonthly.toFixed(2)} €</span>
            {scanMsg && <span className="ml-3 text-xs">· {scanMsg}</span>}
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={rescan} disabled={scanning}>
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Neu scannen
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5" /> Kostenpflichtige Abos</CardTitle>
          <CardDescription>Aus der Gmail-Inbox erkannt. „Neu scannen" aktualisiert die Liste.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : subs.length === 0 ? (
            <div className="py-8 text-center">
              <Wallet className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-sm text-muted-foreground">Noch keine Abos erkannt. Klicke „Neu scannen".</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Anbieter</TableHead>
                  <TableHead>Monatlich</TableHead>
                  <TableHead>Intervall</TableHead>
                  <TableHead>Letzte Zahlung</TableHead>
                  <TableHead>Belege</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subs.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      {s.provider_name}
                      {s.is_content_source && <Badge variant="secondary" className="ml-2 text-xs">Content-Quelle</Badge>}
                    </TableCell>
                    <TableCell>
                      {s.amount_monthly != null ? `${s.amount_monthly.toFixed(2)} ${s.currency || '€'}` : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.interval}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.last_payment_at ? new Date(s.last_payment_at).toLocaleDateString('de-DE') : '—'}
                    </TableCell>
                    <TableCell>
                      {s.evidence_message_ids?.[0] ? (
                        <a href={s.evidence_message_ids[0].gmailLink} target="_blank" rel="noopener noreferrer"
                           className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          {s.evidence_message_ids.length}× <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.status === 'cancelled' ? 'secondary' : 'default'}>{s.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Kündigen"
                          onClick={() => alert('Kündigung folgt in Task 10')}>
                          <Ban className="h-4 w-4 text-red-600" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Ausblenden / Kein Abo"
                          onClick={() => setStatus(s.id, 'ignored')}>
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Verifizieren (Dev-Server oder Prod nach Deploy)**

Run: `npm run build`
Expected: Build erfolgreich, keine Typfehler. Danach Seite `/admin/subscriptions` öffnen: Nav-Eintrag „Abo-Kosten" sichtbar, Seite lädt (leer, bis gescannt), „Neu scannen" startet den Scan und füllt die Tabelle.

- [ ] **Step 4: Commit**

```bash
git add components/admin/admin-nav.tsx app/admin/subscriptions/page.tsx
git commit -m "feat(abo-kosten): Nav-Eintrag + Übersichts-Seite mit Scan

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `lib/subscriptions/cancel.ts` — One-Click-Ausführung

**Files:**
- Create: `lib/subscriptions/cancel.ts`
- Test: `tests/lib/subscriptions-cancel.test.ts`

**Interfaces:**
- Produces: `executeAutoUnsubscribe(type: UnsubscribeType, target: string, fetchFn?: typeof fetch): Promise<{ ok: boolean; detail: string }>`

- [ ] **Step 1: Failing Tests schreiben**

`tests/lib/subscriptions-cancel.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { executeAutoUnsubscribe } from '@/lib/subscriptions/cancel'

describe('executeAutoUnsubscribe', () => {
  it('oneclick → POST auf target, ok bei 2xx', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const r = await executeAutoUnsubscribe('oneclick', 'https://x.com/u', fetchFn as unknown as typeof fetch)
    expect(fetchFn).toHaveBeenCalledWith('https://x.com/u', expect.objectContaining({ method: 'POST' }))
    expect(r.ok).toBe(true)
  })
  it('http → GET auf target', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const r = await executeAutoUnsubscribe('http', 'https://x.com/u', fetchFn as unknown as typeof fetch)
    expect(fetchFn).toHaveBeenCalledWith('https://x.com/u', expect.objectContaining({ method: 'GET' }))
    expect(r.ok).toBe(true)
  })
  it('non-2xx → ok=false', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    const r = await executeAutoUnsubscribe('oneclick', 'https://x.com/u', fetchFn as unknown as typeof fetch)
    expect(r.ok).toBe(false)
  })
  it('nicht-automatischer Typ (mailto/login_portal) → ok=false, kein fetch', async () => {
    const fetchFn = vi.fn()
    const r = await executeAutoUnsubscribe('mailto', 'mailto:a@x.com', fetchFn as unknown as typeof fetch)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Tests laufen (müssen fehlschlagen)**

Run: `npx vitest run tests/lib/subscriptions-cancel.test.ts`
Expected: FAIL — `cancel.ts` existiert nicht.

- [ ] **Step 3: `cancel.ts` implementieren**

`lib/subscriptions/cancel.ts`:

```ts
import type { UnsubscribeType } from '@/lib/subscriptions/types'

/**
 * Führt einen serverseitigen Auto-Unsubscribe aus — NUR für 'oneclick' (POST) und
 * 'http' (GET). Andere Typen (mailto/login_portal/unknown) werden im Browser des
 * Nutzers erledigt und geben hier ok=false zurück (kein serverseitiger Request).
 */
export async function executeAutoUnsubscribe(
  type: UnsubscribeType,
  target: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: boolean; detail: string }> {
  try {
    if (type === 'oneclick') {
      const res = await fetchFn(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      })
      return { ok: res.ok, detail: `POST ${res.status}` }
    }
    if (type === 'http') {
      const res = await fetchFn(target, { method: 'GET' })
      return { ok: res.ok, detail: `GET ${res.status}` }
    }
    return { ok: false, detail: `Typ ${type} nicht serverseitig kündbar` }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'Request-Fehler' }
  }
}
```

- [ ] **Step 4: Tests laufen (müssen bestehen)**

Run: `npx vitest run tests/lib/subscriptions-cancel.test.ts`
Expected: PASS (4 Tests).

- [ ] **Step 5: Commit**

```bash
git add lib/subscriptions/cancel.ts tests/lib/subscriptions-cancel.test.ts
git commit -m "feat(abo-kosten): executeAutoUnsubscribe (One-Click/HTTP)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Kündigungs-API `/api/admin/subscriptions/cancel`

**Files:**
- Create: `app/api/admin/subscriptions/cancel/route.ts`

**Interfaces:**
- Consumes: `executeAutoUnsubscribe` (Task 8); `getSession`; Tabelle `paid_subscriptions`.
- Produces: `POST { id }` → `{ ok, status, detail }`. Nur für Fall A (oneclick/http). Fall B wird nicht serverseitig ausgeführt.

- [ ] **Step 1: Route schreiben**

`app/api/admin/subscriptions/cancel/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth/session'
import { executeAutoUnsubscribe } from '@/lib/subscriptions/cancel'

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'id fehlt' }, { status: 400 })

  const supabase = await createClient()
  const { data: sub } = await supabase
    .from('paid_subscriptions')
    .select('id, unsubscribe_type, unsubscribe_target, cancel_log')
    .eq('id', id)
    .single()
  if (!sub) return NextResponse.json({ error: 'Abo nicht gefunden' }, { status: 404 })

  const type = sub.unsubscribe_type as 'oneclick' | 'http' | 'mailto' | 'login_portal' | 'unknown'
  if (type !== 'oneclick' && type !== 'http') {
    return NextResponse.json({ error: 'Nur im Browser kündbar (Fall B)', ok: false }, { status: 400 })
  }
  if (!sub.unsubscribe_target) {
    return NextResponse.json({ error: 'Kein Unsubscribe-Ziel', ok: false }, { status: 400 })
  }

  await supabase.from('paid_subscriptions').update({ status: 'cancelling' }).eq('id', id)
  const result = await executeAutoUnsubscribe(type, sub.unsubscribe_target)

  const logEntry = { ts: new Date().toISOString(), type, result: result.ok ? 'success' : 'error', detail: result.detail }
  const newLog = Array.isArray(sub.cancel_log) ? [...sub.cancel_log, logEntry] : [logEntry]
  const newStatus = result.ok ? 'cancelled' : 'active'
  await supabase.from('paid_subscriptions')
    .update({ status: newStatus, cancel_log: newLog, updated_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ ok: result.ok, status: newStatus, detail: result.detail })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/subscriptions/cancel/route.ts
git commit -m "feat(abo-kosten): Kündigungs-API (One-Click serverseitig)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Kündigungs-UI (Fall A Bestätigung, Fall B Link öffnen)

**Files:**
- Modify: `app/admin/subscriptions/page.tsx` (Kündigungs-Handler + Dialog statt `alert`-Platzhalter aus Task 7)

**Interfaces:**
- Consumes: `POST /api/admin/subscriptions/cancel` (Task 9); Supabase-Update für „als gekündigt markieren" (Fall B).

- [ ] **Step 1: Kündigungs-State + Handler ergänzen**

In `app/admin/subscriptions/page.tsx` innerhalb der Komponente (nach `setStatus`) ergänzen:

```tsx
  const [cancelTarget, setCancelTarget] = useState<Subscription | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const isAutoCancellable = (s: Subscription) => s.unsubscribe_type === 'oneclick' || s.unsubscribe_type === 'http'

  async function confirmCancel() {
    if (!cancelTarget) return
    setCancelling(true)
    try {
      if (isAutoCancellable(cancelTarget)) {
        const res = await fetch('/api/admin/subscriptions/cancel', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: cancelTarget.id }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) alert('Kündigung fehlgeschlagen: ' + (data.detail || data.error || 'unbekannt'))
      } else {
        // Fall B: Ziel im Browser des Nutzers öffnen (mailto/login_portal/unknown)
        const url = cancelTarget.unsubscribe_target
          || `https://www.google.com/search?q=${encodeURIComponent(cancelTarget.provider_name + ' Abo kündigen')}`
        window.open(url, '_blank', 'noopener,noreferrer')
      }
      await fetchSubs()
    } finally {
      setCancelling(false)
      setCancelTarget(null)
    }
  }
```

- [ ] **Step 2: „Kündigen"-Button verdrahten (alert-Platzhalter ersetzen)**

Den Button aus Task 7 (`onClick={() => alert('Kündigung folgt in Task 10')}`) ersetzen durch:

```tsx
                        <Button variant="ghost" size="icon" title="Kündigen"
                          onClick={() => setCancelTarget(s)}>
                          <Ban className="h-4 w-4 text-red-600" />
                        </Button>
```

Zusätzlich für Fall-B-Abos, die bereits geöffnet wurden, eine „Als gekündigt markieren"-Aktion anbieten (nur wenn nicht auto-kündbar und Status noch aktiv) — direkt daneben:

```tsx
                        {!isAutoCancellable(s) && s.status === 'active' && (
                          <Button variant="ghost" size="sm" title="Als gekündigt markieren"
                            onClick={() => setStatus(s.id, 'cancelled')}>
                            ✓ erledigt
                          </Button>
                        )}
```

- [ ] **Step 3: Bestätigungs-Dialog ergänzen**

Import oben erweitern:
```tsx
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
```

Am Ende des JSX (vor dem schließenden `</div>` der Seite) einfügen:

```tsx
      <Dialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{cancelTarget?.provider_name} kündigen?</DialogTitle>
            <DialogDescription>
              {cancelTarget && isAutoCancellable(cancelTarget)
                ? `Führt einen Unsubscribe-Request an ${cancelTarget.provider_name} aus.`
                : 'Erfordert Login/Bestätigung — die Seite wird in einem neuen Tab geöffnet, du schließt die Kündigung manuell ab.'}
              {cancelTarget?.is_content_source && ' Achtung: Damit fällt auch eine redaktionelle Content-Quelle weg.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>Abbrechen</Button>
            <Button onClick={confirmCancel} disabled={cancelling}>
              {cancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {cancelTarget && isAutoCancellable(cancelTarget) ? 'Jetzt kündigen' : 'Seite öffnen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 4: Verifizieren**

Run: `npm run build`
Expected: Build erfolgreich. Manuell: Fall-A-Abo → Dialog „Jetzt kündigen" → Status wird `cancelled`; Fall-B-Abo → Dialog „Seite öffnen" → neuer Tab öffnet, danach „✓ erledigt" setzt `cancelled`.

- [ ] **Step 5: Commit**

```bash
git add app/admin/subscriptions/page.tsx
git commit -m "feat(abo-kosten): Kündigungs-Workflow UI (Fall A Bestätigung, Fall B Link)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Manuelles Anlegen verpasster Abos

**Files:**
- Modify: `app/admin/subscriptions/page.tsx` (Dialog + Insert)

**Interfaces:**
- Consumes: Supabase-Browser-Client-Insert in `paid_subscriptions` (analog `newsletter_sources` addSource).

- [ ] **Step 1: State + Handler ergänzen**

In `app/admin/subscriptions/page.tsx` innerhalb der Komponente ergänzen:

```tsx
  const [addOpen, setAddOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [addAmount, setAddAmount] = useState('')
  const [addInterval, setAddInterval] = useState('monthly')
  const [addSaving, setAddSaving] = useState(false)

  async function addManual() {
    if (!addName.trim()) return
    setAddSaving(true)
    const amount = addAmount ? parseFloat(addAmount.replace(',', '.')) : null
    const factor: Record<string, number> = { monthly: 1, yearly: 1 / 12, quarterly: 1 / 3, weekly: 52 / 12, one_time: 0, unknown: 0 }
    const amountMonthly = amount != null ? Math.round(amount * (factor[addInterval] ?? 0) * 100) / 100 : null
    const { error } = await supabase.from('paid_subscriptions').insert({
      provider_name: addName.trim(),
      provider_key: addName.trim().toLowerCase(),
      amount, currency: '€', interval: addInterval, amount_monthly: amountMonthly,
      status: 'active', manually_added: true, unsubscribe_type: 'unknown',
    })
    if (error) alert('Fehler: ' + error.message)
    else { setAddName(''); setAddAmount(''); setAddInterval('monthly'); setAddOpen(false); fetchSubs() }
    setAddSaving(false)
  }
```

- [ ] **Step 2: Button + Dialog ergänzen**

Neben „Neu scannen" (im Kopf-`<div className="flex ...">` – den Button in einen `<div className="flex gap-2">` mit „Neu scannen" gruppieren) einen Button einfügen und den Dialog am Seitenende ergänzen:

```tsx
      <Button variant="outline" onClick={() => setAddOpen(true)}>Manuell hinzufügen</Button>

      {/* am Seitenende, neben dem Kündigungs-Dialog: */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abo manuell hinzufügen</DialogTitle>
            <DialogDescription>Für Abos, die der Scan nicht erkannt hat.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input placeholder="Anbieter (z. B. Stratechery)" value={addName} onChange={(e) => setAddName(e.target.value)} />
            <Input placeholder="Betrag (z. B. 12.00)" value={addAmount} onChange={(e) => setAddAmount(e.target.value)} />
            <select className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={addInterval} onChange={(e) => setAddInterval(e.target.value)}>
              <option value="monthly">monatlich</option>
              <option value="yearly">jährlich</option>
              <option value="quarterly">quartalsweise</option>
              <option value="weekly">wöchentlich</option>
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Abbrechen</Button>
            <Button onClick={addManual} disabled={addSaving || !addName.trim()}>
              {addSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Hinzufügen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

Import `Input` ergänzen: `import { Input } from '@/components/ui/input'`.

- [ ] **Step 3: Verifizieren**

Run: `npm run build`
Expected: Build erfolgreich. Manuell: „Manuell hinzufügen" → Abo erscheint mit `manually_added=true`; ein Re-Scan überschreibt es NICHT (siehe Task 6 `locked`-Set).

- [ ] **Step 4: Commit**

```bash
git add app/admin/subscriptions/page.tsx
git commit -m "feat(abo-kosten): manuelles Anlegen verpasster Abos

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Abschluss-Verifikation

- [ ] `npx vitest run tests/lib/subscriptions-detector.test.ts tests/lib/subscriptions-cancel.test.ts` — alle grün.
- [ ] `npm run build` — erfolgreich.
- [ ] Prod: Migration via `supabase db push` angewandt; `/admin/subscriptions` → „Neu scannen" liefert plausible Abos mit Belegen; ein echter One-Click-Unsubscribe an einem unkritischen Abo getestet.
- [ ] Push auf `main` (Mattes-Konvention: direkt auf main).

## Hinweise für die Umsetzung

- **Reihenfolge:** Tasks 1→10 sind linear abhängig (2 vor 5, 3 vor 5, 4 vor 5, 5 vor 6, 6 vor 7, 8 vor 9, 9+7 vor 10).
- **Scan-Kosten/-Laufzeit:** `MAX_CANDIDATES=300`, `LLM_BATCH_SIZE=12` → ~25 Haiku-Calls je Scan. Falls Laufzeit an 300s stößt: Kandidatenzahl senken oder auf das bestehende `article_jobs`-Job-Pattern umstellen (Spec §10).
- **RLS:** `paid_subscriptions` folgt dem Muster von `newsletter_sources` (Client-Reads/-Status-Updates direkt). Falls RLS Schreibzugriff blockt, analog zu `newsletter_sources` behandeln (dort funktioniert direkter Client-Insert/Update bereits).
