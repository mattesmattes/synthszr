# Security Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alle zwölf offenen Findings aus dem Security Re-Audit vom 2. August 2026 schließen, die drei gelösten Findings durch Regressionstests absichern und einen reproduzierbaren, blocking Security-Gate für zukünftige Änderungen etablieren.

**Architecture:** Die Remediation erfolgt in getrennten, reviewbaren PRs. Subscriber-Zugriffe wechseln per Expand–Migrate–Contract von internen UUIDs auf gehashte, zweckgebundene Tokens. Ausgehende Requests laufen über einen DNS-gepinnten Fetch-Layer; teure und schreibende öffentliche Routen erhalten Laufzeitvalidierung, Größenlimits und Budgets. Supply Chain, CSP, Credentials und Admin-Sessions werden danach ohne Vermischung der Rollback-Domänen gehärtet.

**Tech Stack:** Next.js 16.2.12 App Router, React 19.2, TypeScript 5, Node.js 24, pnpm 10.20.0, Supabase/Postgres RLS, Vercel Functions, Upstash Rate Limit, Vitest 4.1.10, Zod 3.25.76, Undici 8.9.0, Sharp 0.35.3.

## Global Constraints

- Das vollständige Ausgangsaudit ist `security_best_practices_report.md`; jede PR nennt die geschlossenen SEC-IDs.
- Produktionscode und CI verwenden ausschließlich Node.js 24 und pnpm 10.20.0 mit `pnpm-lock.yaml`.
- Kein `npx`, kein zweites Lockfile und kein Build-Time-Download außerhalb des Lockfiles.
- Keine rohe `subscribers.id` in HTTP-Responses, Browser Storage, Query-Parametern oder E-Mail-HTML.
- Öffentliche Subscriber-Tokens sind mindestens 256 Bit zufällig, pro Zweck getrennt und in Postgres ausschließlich als SHA-256-Hash gespeichert.
- Supabase-Tabellen im exponierten `public`-Schema haben RLS; interne Tabellen besitzen keine Grants für `anon` oder `authenticated`.
- `SUPABASE_SERVICE_ROLE_KEY`, Gmail-Tokens und andere Secrets bleiben ausschließlich in serverseitigen Modulen.
- Jede Route validiert Request-Daten zur Laufzeit; TypeScript-Typen gelten nicht als Input-Validation.
- Kein serverseitiger Request zu einer fremden URL ohne zentralen SSRF-Guard, Redirect-Revalidierung und Timeout.
- Öffentliche Image- und JSON-Routen lesen nie mehr als das explizit definierte Byte-Limit in den Speicher.
- GET-Routen lösen keine LLM-, TTS-, Mail-, DB-Write- oder Cache-Invalidierungsarbeit aus.
- Security-Fixes werden nicht durch Bypässe, weichere CSP, fail-open Auth oder breite Host-Allowlisten ersetzt.
- Datenbankänderungen folgen Expand–Migrate–Contract; die Contract-Migration wird erst nach produktiver Cutover-Verifikation ausgeführt.
- Jede Aufgabe endet mit eigenem Testlauf und eigenem Commit; keine Sammel-Commits über mehrere Findings.

---

## Ergebnisbild und Reihenfolge

| Phase | Tasks | Ziel | Release-Gate |
|---|---|---|---|
| P0A | 1–2 | Ein Dependency-Graph und blocking CI | Kein Critical/High im aktiven pnpm-Graph |
| P0B | 3–6 | Subscriber-UUID vollständig ablösen | Kein `sid`-Credential mehr; anon bleibt durch RLS blockiert |
| P0C | 7–10 | SSRF, Images, Analytics und Podcast schließen | Keine ungebundene Outbound-Verbindung oder öffentliche Generation |
| P1 | 11–12 | CSP und Gmail-Tokens härten | Produktive Script-CSP strikt; DB enthält nur Ciphertext |
| P2 | 13–14 | Sessions, Startup und Cache-Auth härten | Sessions widerrufbar; Config fail-fast; eigener Revalidate-Token |
| Release | 15 | Gesamtabnahme | Typecheck, Build, Tests, Audit und Produktionsproben grün |

## Finding-Abdeckung

| Finding | Task | Abschlusskriterium |
|---|---:|---|
| SEC-001 | 3–6 | Keine UUID als Credential; nur gehashte Purpose-Tokens |
| SEC-002 | 2 | `x-vercel-cron` ist negativ getestet und Dokumentation korrigiert |
| SEC-003 | 15 | OAuth-`state`-Regressionstests bleiben grün |
| SEC-004 | 7 | Validierte DNS-IP ist an die Verbindung gebunden; Tracking nutzt denselben Guard |
| SEC-005 | 1–2 | Ein Lockfile, Sharp/Vitest gepatcht, Audit blocking |
| SEC-006 | 6, 15 | Grants/RLS per SQL und produktiv read-only verifiziert |
| SEC-007 | 8 | Redirects, Bytes, MIME, Pixel, Timeout und Rate begrenzt |
| SEC-008 | 9 | Analytics-Schema, Body-Limit, Rate Limit und Retention aktiv |
| SEC-009 | 11 | **TEILWEISE**: `unsafe-eval` produktiv entfernt (verifiziert). `unsafe-inline` bleibt als dokumentiertes accepted risk — Entfernung braucht Nonces (kostet ISR auf 21 Routen) oder Per-Page-Hashes. Owner: Mattes. Zählt laut Global Constraints NICHT als Closure. |
| SEC-010 | 12 | Gmail-Refresh-Token nur verschlüsselt gespeichert |
| SEC-011 | 14 | `instrumentation.ts` führt vollständige Production-Checks aus |
| SEC-012 | 1–2 | Reproduzierbarer Graph und blocking/pinned CI |
| SEC-013 | 10 | Reader-GET ist strikt read-only |
| SEC-014 | 14 | Eigenes Bearer-Secret, nicht in Query und timing-safe geprüft |
| SEC-015 | 13 | Opaque, widerrufbare Admin-Sessions mit 12 Stunden TTL |

## Geplante Dateistruktur

Neue fokussierte Module:

- `lib/newsletter/access-tokens.ts` — Minting, Hashing und Auflösung zweckgebundener Subscriber-Tokens.
- `lib/security/bounded-body.ts` — begrenztes Lesen von Request-/Response-Streams.
- `lib/security/safe-image-fetch.ts` — Image-Allowlist, MIME/Magic Bytes und Pixel-Limits.
- `lib/security/csp.mjs` — einzige Quelle für produktive und Development-CSP.
- `lib/gmail/token-store.ts` — einzige DB-Schnittstelle für Gmail-Credentials.
- `lib/auth/session-store.ts` — serverseitige, widerrufbare Admin-Session-Validierung.
- `instrumentation.ts` — garantierter Security-Config-Check beim Node-Runtime-Start.

Neue Tests:

- `tests/lib/repository-security.test.ts`
- `tests/lib/newsletter-access-tokens.test.ts`
- `tests/api/newsletter-security.test.ts`
- `tests/lib/bounded-body.test.ts`
- `tests/api/image-proxy-security.test.ts`
- `tests/api/analytics-security.test.ts`
- `tests/api/podcast-security.test.ts`
- `tests/lib/csp.test.ts`
- `tests/lib/gmail-token-store.test.ts`
- `tests/lib/admin-session-store.test.ts`

---

### Task 1: Einen reproduzierbaren Package-Graph herstellen — SEC-005, SEC-012

**Files:**

- Create: `.nvmrc`
- Create: `.node-version`
- Create: `tests/lib/repository-security.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Delete: `package-lock.json`

**Interfaces:**

- Produces: Node.js 24 + `pnpm@10.20.0` als einzige Installationsbasis.
- Produces: `sharp@0.35.3`, `vitest@4.1.10`, `next@16.2.12`, `undici@8.9.0` und ein deklariertes `tsx`.
- Consumes: keine Interfaces aus späteren Tasks.

- [x] **Step 1: Repository-Guard als zunächst fehlschlagenden Test schreiben**

```ts
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

describe('repository supply-chain policy', () => {
  const root = process.cwd()
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

  it('uses one pinned package manager and Node 24', () => {
    expect(pkg.packageManager).toBe('pnpm@10.20.0')
    expect(pkg.engines).toEqual({ node: '24.x', pnpm: '10.20.x' })
    expect(existsSync(path.join(root, 'package-lock.json'))).toBe(false)
    expect(existsSync(path.join(root, 'pnpm-lock.yaml'))).toBe(true)
  })

  it('does not download build tools through npx', () => {
    expect(Object.values(pkg.scripts).join('\n')).not.toMatch(/\bnpx\b/)
    expect(pkg.devDependencies.tsx).toBeDefined()
  })
})
```

- [x] **Step 2: Test ausführen und den erwarteten roten Zustand bestätigen**

Run: `pnpm exec vitest run tests/lib/repository-security.test.ts`

Expected: FAIL wegen fehlendem `packageManager`, vorhandenem `package-lock.json`, `npx` und fehlendem `tsx`.

- [x] **Step 3: Runtime und Scripts exakt festlegen**

`package.json` erhält:

```json
{
  "packageManager": "pnpm@10.20.0",
  "engines": {
    "node": "24.x",
    "pnpm": "10.20.x"
  },
  "scripts": {
    "prebuild": "tsx scripts/sync-premarket-companies.ts",
    "build": "next build",
    "sync-companies": "tsx scripts/sync-premarket-companies.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

`prebuild` wird von pnpm automatisch vor `build` ausgeführt; `build` darf es nicht ein zweites Mal über `npm run prebuild` starten.

`.nvmrc` und `.node-version` enthalten jeweils exakt:

```text
24
```

- [x] **Step 4: Gepatchte Kernversionen installieren und npm-Lockfile entfernen**

Run:

```bash
corepack enable
corepack prepare pnpm@10.20.0 --activate
pnpm add --save-exact next@16.2.12 sharp@0.35.3 undici@8.9.0
pnpm add --save-dev --save-exact vitest@4.1.10 tsx@4.23.1
git rm package-lock.json
pnpm install --lockfile-only
```

Die in diesem Plan am 2. August 2026 verifizierten Registry-Versionen sind Sharp 0.35.3, Vitest 4.1.10, Next.js 16.2.12, protobufjs 8.7.1, Undici 8.9.0 und tsx 4.23.1.

- [x] **Step 5: Verbleibende High-/Critical-Pfade einzeln beseitigen**

Run:

```bash
pnpm audit --json
pnpm why postcss ws undici vite fast-uri linkify-it protobufjs
pnpm update --latest
pnpm dedupe
pnpm audit --audit-level=high
```

Expected: Der letzte Befehl beendet sich mit Exit 0. Wenn Sharp 0.35.3 im Vercel-Preview crasht, bleibt die PR blockiert; es wird nicht auf 0.34.5 zurückgerollt. Crash-Logs, Plattform, Architektur und Minimal-Reproduktion werden stattdessen am PR dokumentiert.

- [x] **Step 6: Regressionen prüfen**

Run:

```bash
pnpm typecheck
pnpm exec vitest run tests/lib/repository-security.test.ts tests/lib/ssrf.test.ts tests/lib/security.test.ts
pnpm build
```

Expected: Nur der in Task 2 bewusst zu korrigierende alte Cron-Test darf vor Task 2 noch fehlschlagen; Typecheck, Repository-Guard und Build sind grün.

- [x] **Step 7: Commit**

```bash
git add .nvmrc .node-version package.json pnpm-lock.yaml tests/lib/repository-security.test.ts
git add -u package-lock.json
git commit -m "security: consolidate dependency graph on pnpm"
```

---

### Task 2: CI-Gates blocking und deterministisch machen — SEC-002, SEC-012

**Files:**

- Modify: `.github/workflows/security.yml`
- Modify: `tests/lib/security.test.ts:37-50`
- Modify: `app/docs/architecture/page.tsx:80,1238`

**Interfaces:**

- Consumes: `pnpm@10.20.0` und Node.js 24 aus Task 1.
- Produces: verpflichtende Audit-, Semgrep-, Typecheck- und Unit-Test-Gates.

- [x] **Step 1: Cron-Regressionstest auf das sichere Verhalten drehen**

Ersetze den positiven Test durch:

```ts
it('rejects spoofed x-vercel-cron without bearer secret', async () => {
  vi.stubEnv('NODE_ENV', 'production')
  process.env.CRON_SECRET = 'real-secret'

  const { verifyCronAuth } = await import('@/lib/security/cron-auth')
  const request = {
    headers: { get: (key: string) => key === 'x-vercel-cron' ? '1' : null },
  } as any

  const result = verifyCronAuth(request)
  expect(result).toEqual({ authorized: false, method: 'none' })
})
```

- [x] **Step 2: Security-Test ausführen**

Run: `pnpm exec vitest run tests/lib/security.test.ts`

Expected: PASS für alle neun Tests.

- [x] **Step 3: Sämtliche CI-Jobs auf denselben Graph umstellen**

Jeder Node-Job verwendet:

```yaml
- uses: pnpm/action-setup@v4
  with:
    version: 10.20.0
- uses: actions/setup-node@v4
  with:
    node-version: '24'
    cache: pnpm
- run: pnpm install --frozen-lockfile
```

Typecheck und Tests laufen mit:

```yaml
- run: pnpm typecheck
- run: pnpm exec vitest run tests/lib/
```

- [x] **Step 4: Security-Findings zu Merge-Blockern machen**

Der Audit-Schritt lautet ohne `continue-on-error`:

```yaml
- name: Block Critical and High advisories
  run: pnpm audit --audit-level=high
```

Semgrep lautet:

```yaml
- name: Run Semgrep
  run: semgrep scan --error --severity ERROR --config auto --config .semgrep.yml --json -o semgrep-results.json
```

Der Artifact-Upload erhält `if: always()`. Nur die reine Report-Erzeugung darf non-blocking sein; der vorangehende Gate-Schritt bleibt blocking.

- [x] **Step 5: Mutable Actions und Container pinnen**

Für jedes `uses:` wird der aktuelle Tag einmal per GitHub API aufgelöst und anschließend als vollständiger Commit-SHA plus Kommentar `# vX` gespeichert. Für Semgrep wird ein fester Versions-Tag auf einen OCI-Digest aufgelöst und mit dem vollständigen 64-stelligen Digest hinter `semgrep/semgrep@sha256:` eingetragen. Der PR zeigt die Auflösungslinks und Dependabot bleibt für Updates zuständig.

Verifikation:

```bash
rg -n "continue-on-error: true|trufflehog@main|image: semgrep/semgrep$|semgrep .*\|\| true|npm ci|cache: 'npm'" .github/workflows/security.yml
```

Expected: keine Treffer.

- [x] **Step 6: Öffentliche Architektur-Dokumentation korrigieren**

Dokumentiere ausschließlich `Authorization: Bearer $CRON_SECRET`. `x-vercel-cron` wird als ausdrücklich nicht vertrauenswürdiger Request-Header beschrieben.

- [x] **Step 7: Workflow lokal und im PR prüfen**

Run:

```bash
pnpm typecheck
pnpm exec vitest run tests/lib/security.test.ts tests/lib/repository-security.test.ts
pnpm audit --audit-level=high
```

Expected: alle Befehle Exit 0; GitHub Required Checks umfassen Audit, Semgrep, CodeQL, Typecheck und Unit Tests.

- [x] **Step 8: Commit**

```bash
git add .github/workflows/security.yml tests/lib/security.test.ts app/docs/architecture/page.tsx
git commit -m "security: make CI gates deterministic and blocking"
```

---

### Task 3: Gehashte Subscriber-Purpose-Tokens einführen — SEC-001

**Files:**

- Create: `lib/newsletter/access-tokens.ts`
- Create: `tests/lib/newsletter-access-tokens.test.ts`
- Create: Migration über `supabase migration new subscriber_action_tokens`
- Modify: `lib/supabase/types.ts` nach Migration/Type-Generation

**Interfaces:**

- Produces:

```ts
export type SubscriberTokenPurpose = 'confirm' | 'preferences' | 'unsubscribe' | 'referral'
export interface MintedSubscriberToken {
  rawToken: string
  row: {
    subscriber_id: string
    purpose: SubscriberTokenPurpose
    token_hash: string
    expires_at: string
  }
}
export function hashSubscriberToken(rawToken: string): string
export function mintSubscriberToken(
  subscriberId: string,
  purpose: SubscriberTokenPurpose,
  expiresAt: Date,
): MintedSubscriberToken
export async function resolveSubscriberToken(
  rawToken: string,
  purpose: SubscriberTokenPurpose,
  options?: { consume?: boolean },
): Promise<{ subscriberId: string } | null>
```

- [x] **Step 1: Token-Eigenschaften test-first festlegen**

```ts
import { describe, expect, it } from 'vitest'
import { hashSubscriberToken, mintSubscriberToken } from '@/lib/newsletter/access-tokens'

describe('subscriber access tokens', () => {
  it('mints 256-bit opaque tokens and persists only the hash', () => {
    const minted = mintSubscriberToken(
      '018f6f4e-2dd3-7a13-a200-111111111111',
      'preferences',
      new Date('2026-08-09T00:00:00Z'),
    )
    expect(Buffer.from(minted.rawToken, 'base64url')).toHaveLength(32)
    expect(minted.row.token_hash).toBe(hashSubscriberToken(minted.rawToken))
    expect(minted.row.token_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(minted.row)).not.toContain(minted.rawToken)
  })

  it('separates token purpose', () => {
    const p = mintSubscriberToken('018f6f4e-2dd3-7a13-a200-111111111111', 'preferences', new Date())
    expect(p.row.purpose).toBe('preferences')
  })
})
```

- [x] **Step 2: Roten Test bestätigen**

Run: `pnpm exec vitest run tests/lib/newsletter-access-tokens.test.ts`

Expected: FAIL, weil das Modul noch nicht existiert.

- [x] **Step 3: Expand-Migration mit Supabase CLI erzeugen**

Run:

```bash
supabase migration new subscriber_action_tokens
```

Bearbeite exakt die von der CLI ausgegebene Datei mit:

```sql
create extension if not exists pgcrypto;

create table public.subscriber_action_tokens (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  purpose text not null check (purpose in ('confirm','preferences','unsubscribe','referral')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index subscriber_action_tokens_lookup_idx
  on public.subscriber_action_tokens (token_hash, purpose)
  where consumed_at is null;
create index subscriber_action_tokens_expiry_idx
  on public.subscriber_action_tokens (expires_at);
create index subscriber_action_tokens_subscriber_idx
  on public.subscriber_action_tokens (subscriber_id, purpose);

alter table public.subscriber_action_tokens enable row level security;
revoke all on table public.subscriber_action_tokens from public, anon, authenticated;
grant select, insert, update, delete on table public.subscriber_action_tokens to service_role;

insert into public.subscriber_action_tokens (subscriber_id, purpose, token_hash, expires_at)
select id, 'confirm', encode(digest(confirmation_token, 'sha256'), 'hex'),
       coalesce(confirmation_sent_at, now()) + interval '48 hours'
from public.subscribers
where status = 'pending' and confirmation_token is not null
on conflict (token_hash) do nothing;

insert into public.subscriber_action_tokens (subscriber_id, purpose, token_hash, expires_at, consumed_at)
select subscriber_id, 'preferences', encode(digest(token, 'sha256'), 'hex'), expires_at, used_at
from public.subscriber_preference_tokens
on conflict (token_hash) do nothing;
```

Die Expand-Migration lässt Legacy-Spalten und Legacy-Tabelle absichtlich bestehen.

- [x] **Step 4: Token-Modul minimal implementieren**

Minting nutzt `randomBytes(32).toString('base64url')`, Hashing `createHash('sha256')`. `resolveSubscriberToken` sucht ausschließlich nach `token_hash`, passendem `purpose`, `consumed_at IS NULL` und `expires_at > now()`. Bei `consume: true` setzt es `consumed_at` nur für genau die gefundene ID und gibt bei konkurrierender Zweitnutzung `null` zurück.

- [x] **Step 5: Lokal migrieren und Berechtigungen prüfen**

Run:

```bash
supabase db reset
supabase migration list --local
pnpm exec vitest run tests/lib/newsletter-access-tokens.test.ts
```

SQL-Verifikation:

```sql
select relrowsecurity from pg_class where oid = 'public.subscriber_action_tokens'::regclass;
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'subscriber_action_tokens'
order by grantee, privilege_type;
```

Expected: RLS `true`; keine Grants für `anon` oder `authenticated`; Tests PASS.

- [x] **Step 6: Types regenerieren und Commit**

Run: `supabase gen types typescript --local > /tmp/synthszr-supabase-types.ts`

Übertrage nur die neue Tabellenstruktur kontrolliert nach `lib/supabase/types.ts`; überschreibe keine benutzerdefinierten Typen blind.

```bash
git add lib/newsletter/access-tokens.ts tests/lib/newsletter-access-tokens.test.ts lib/supabase/types.ts supabase/migrations
git commit -m "security: add hashed subscriber action tokens"
```

---

### Task 4: Subscribe und Double-Opt-in auf Purpose-Tokens umstellen — SEC-001

**Files:**

- Create: `tests/api/newsletter-security.test.ts`
- Modify: `app/api/newsletter/subscribe/route.ts`
- Modify: `app/api/newsletter/confirm/route.ts`
- Modify: `components/newsletter.tsx`
- Modify: `components/newsletter-popup.tsx`

**Interfaces:**

- Consumes: `mintSubscriberToken()` und `resolveSubscriberToken()` aus Task 3.
- Produces: uniforme Subscribe-Response ohne `sid`; single-use Confirmation-Token.

- [x] **Step 1: Response- und Pre-Hijacking-Regressionstests schreiben**

Die Route-Tests mocken Admin-Supabase und Resend und prüfen mindestens:

```ts
expect(newSignup.status).toBe(202)
expect(activeSignup.status).toBe(202)
const [newSignupBody, activeSignupBody] = await Promise.all([
  newSignup.json(),
  activeSignup.json(),
])
expect(newSignupBody).toEqual(activeSignupBody)
expect(JSON.stringify(newSignupBody)).not.toMatch(/sid|subscriberId/i)
expect(persistedTokenRow.token_hash).toMatch(/^[a-f0-9]{64}$/)
expect(persistedTokenRow).not.toHaveProperty('token')
```

Zusätzlich bestätigt ein Test: Derselbe Confirmation-Token aktiviert exakt einmal; zweite Verwendung führt zu `invalid_token`.

- [x] **Step 2: Roten Test bestätigen**

Run: `pnpm exec vitest run tests/api/newsletter-security.test.ts`

Expected: FAIL, weil neue Anmeldung noch `sid` ausgibt und aktive Adresse HTTP 409 liefert.

- [x] **Step 3: Einheitliche Subscribe-Antwort einführen**

Alle gültigen E-Mail-Pfade antworten exakt:

```ts
const ACCEPTED_RESPONSE = {
  success: true,
  message: 'If this address can be subscribed, a confirmation email has been sent.',
}

return NextResponse.json(ACCEPTED_RESPONSE, {
  status: 202,
  headers: { 'Cache-Control': 'no-store' },
})
```

Aktive Adressen erzeugen keine Mail und verraten keinen Status. Pending und unsubscribed erhalten nach bestehender Rate-Limit-Prüfung einen neuen Confirmation-Link. Neue Datensätze werden weiterhin angelegt, aber die ausgewählte ID bleibt serverintern.

- [x] **Step 4: Confirmation-Token nur noch gehasht speichern**

Nach Ermittlung der Subscriber-ID:

```ts
const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000)
const confirmation = mintSubscriberToken(subscriberId, 'confirm', expiresAt)
await supabase.from('subscriber_action_tokens').delete()
  .eq('subscriber_id', subscriberId)
  .eq('purpose', 'confirm')
await supabase.from('subscriber_action_tokens').insert(confirmation.row)
await sendConfirmationEmail(email, confirmation.rawToken, language)
```

`subscribers.confirmation_token` wird nicht mehr geschrieben.

- [x] **Step 5: Confirm-Route atomar konsumieren**

`GET /api/newsletter/confirm?token=` ruft `resolveSubscriberToken(token, 'confirm', { consume: true })` auf. Nur die zurückgegebene `subscriberId` darf zur Aktivierung und zu `confirmReferral()` verwendet werden. Responses setzen `Cache-Control: no-store` und leaken keine Subscriber-ID.

- [x] **Step 6: Browser-SID vollständig aus Signup-Komponenten entfernen**

Entferne in beiden Komponenten jede Verarbeitung von `data.sid` und jeden Zugriff auf `localStorage['synthszr_sid']`. E-Mail-Entwurf und Popup-Status dürfen in Local Storage bleiben, weil sie keine Credentials sind.

- [x] **Step 7: Tests und statischen Leak-Check ausführen**

Run:

```bash
pnpm exec vitest run tests/api/newsletter-security.test.ts tests/lib/newsletter-access-tokens.test.ts
rg -n "synthszr_sid|sid:\s*newSubscriber|data\.sid" components/newsletter.tsx components/newsletter-popup.tsx app/api/newsletter/subscribe/route.ts
```

Expected: Tests PASS; `rg` ohne Treffer.

- [x] **Step 8: Commit**

```bash
git add app/api/newsletter/subscribe/route.ts app/api/newsletter/confirm/route.ts components/newsletter.tsx components/newsletter-popup.tsx tests/api/newsletter-security.test.ts
git commit -m "security: remove subscriber ids from signup flow"
```

---

### Task 5: Preferences, Unsubscribe, Referral und E-Mail-Links cutovern — SEC-001

**Files:**

- Modify: `app/api/newsletter/preferences/route.ts`
- Modify: `app/api/newsletter/unsubscribe/route.ts`
- Delete: `app/api/newsletter/set-language/route.ts`
- Modify: `app/[lang]/newsletter/preferences/page.tsx`
- Modify: `app/newsletter/unsubscribe/page.tsx`
- Modify: `app/api/referral/magic-link/route.ts`
- Modify: `app/[lang]/referral/page.tsx`
- Modify: `lib/referrals/service.ts`
- Delete: `components/referral-sid-fallback.tsx`
- Modify: `components/bloom-language-switcher.tsx`
- Modify: `lib/resend/templates/newsletter.tsx`
- Modify: `lib/email/tiptap-to-html.ts`
- Modify: `app/api/admin/newsletter-send/route.ts`
- Modify: `app/api/cron/newsletter-send/route.ts`
- Modify: `tests/api/newsletter-security.test.ts`

**Interfaces:**

- Consumes: vier Token-Purposes aus Task 3.
- Produces: E-Mail-Links mit `preferences`, `unsubscribe` und `referral`; keine UUID-Merge-Felder.
- Produces: `getReferralStatsByToken(rawToken: string): Promise<ReferralStats | null>`.

- [x] **Step 1: Failing Cross-Purpose- und Leak-Tests ergänzen**

```ts
it('does not accept a preferences token for unsubscribe', async () => {
  const response = await unsubscribeWith(preferencesToken)
  expect(response.status).toBe(404)
})

it('renders newsletter HTML without subscriber UUIDs or sid params', async () => {
  const html = await renderNewsletterForSubscriber()
  expect(html).not.toMatch(/[?&]sid=/)
  expect(html).not.toContain(subscriberId)
  expect(html).toContain('/newsletter/preferences?token=')
  expect(html).toContain('/newsletter/unsubscribe?confirm=1&token=')
})
```

- [x] **Step 2: Token-TTLs und Batch-Minting festlegen**

Für jeden Empfänger werden vor dem Versand drei Tokens erzeugt:

- Preferences: 7 Tage, mehrmals bis Ablauf nutzbar.
- Referral: 30 Tage, mehrmals bis Ablauf nutzbar.
- Unsubscribe: 90 Tage, nach bestätigtem POST single-use.

Pro 50er-Mailbatch werden alle 150 Hash-Zeilen in einem einzigen Supabase-Insert gespeichert. Schlägt der Insert fehl, wird der Batch nicht gesendet.

- [x] **Step 3: Newsletter-Renderer von UUID-Merge-Feldern befreien**

Entferne `subscriberId` aus `NewsletterEmailProps`, `withSid()`, `sidPlaceholder` aus `generateEmailContentWithVotes()` und alle SID-Suffixe aus Vote-, Chart-, Product-, Imprint-, Privacy- und Podcast-Links.

Die einzigen empfängerbezogenen Placeholder sind danach:

```text
{{UNSUBSCRIBE_URL}}
{{PREFERENCES_URL}}
{{REFERRAL_URL}}
```

Pro Empfänger werden daraus:

```ts
const preferencesUrl = `${BASE_URL}/${locale}/newsletter/preferences?token=${preferences.rawToken}`
const unsubscribeUrl = `${BASE_URL}/newsletter/unsubscribe?confirm=1&token=${unsubscribe.rawToken}`
const referralUrl = `${BASE_URL}/${locale}/referral?token=${referral.rawToken}`
```

- [x] **Step 4: Preferences-API nur als Token-Read/Update anbieten**

- `GET` und `PUT` verwenden ausschließlich `resolveSubscriberToken(token, 'preferences')`.
- `PUT` validiert `language` gegen eine aktive Zeile in `languages`.
- `POST` wird vollständig entfernt; es gibt keinen öffentlichen Token-Mint mehr.
- GET/PUT antworten mit `Cache-Control: no-store`.
- Die Preferences-Seite hält den Token nur im Component State und entfernt ihn nach Initialisierung mit `window.history.replaceState(null, '', window.location.pathname)` aus der sichtbaren URL.

- [x] **Step 5: Unsubscribe auf single-use Token umstellen**

Die Landing Page liest `token`, nicht `id`, und sendet `{ token }`. Der POST löst `resolveSubscriberToken(token, 'unsubscribe', { consume: true })` auf und aktualisiert nur die zurückgegebene ID. GET der API wird entfernt, weil der E-Mail-Link direkt zur bestätigenden Seite führt.

- [x] **Step 6: Referral-Magic-Link tokenisieren**

`POST /api/referral/magic-link` behält seine uniforme Success-Response, mintet für aktive Adressen aber einen `referral`-Token und versendet `/${lang}/referral?token=…`. `getReferralStats()` bleibt intern ID-basiert; der neue Wrapper löst zuerst den Token auf:

```ts
export async function getReferralStatsByToken(rawToken: string): Promise<ReferralStats | null> {
  const resolved = await resolveSubscriberToken(rawToken, 'referral')
  return resolved ? getReferralStats(resolved.subscriberId) : null
}
```

`ReferralSidFallback` wird gelöscht. Die Seite akzeptiert nur `token`.

- [x] **Step 7: Globalen SID-Sprachpfad entfernen**

`BloomLanguageSwitcher` wechselt nur die UI-Sprache. Entferne Query-/LocalStorage-SID und `sendBeacon`. Die Newsletter-Sprache wird ausschließlich auf der Preferences-Seite geändert. `app/api/newsletter/set-language/route.ts` wird gelöscht.

- [x] **Step 8: Tests und vollständigen Leak-Scan ausführen**

Run:

```bash
pnpm exec vitest run tests/api/newsletter-security.test.ts tests/lib/newsletter-access-tokens.test.ts tests/lib/bundle-label-email-render.test.ts
rg -n "synthszr_sid|[?&]sid=|subscriberId:\s*'\{\{SUBSCRIBER_ID\}\}'|SUBSCRIBER_ID|sidPlaceholder" app components lib --glob '*.ts' --glob '*.tsx'
```

Expected: Tests PASS; der Leak-Scan hat in produktivem Code keine Treffer. Interne Variablennamen wie `subscriberId` dürfen nur serverseitig ohne HTTP-/HTML-Ausgabe vorkommen.

- [x] **Step 9: Commit**

```bash
git add app components lib tests/api/newsletter-security.test.ts
git add -u app/api/newsletter/set-language/route.ts components/referral-sid-fallback.tsx
git commit -m "security: replace subscriber uuid links with scoped tokens"
```

---

### Task 6: Subscriber-Legacy-Schema entfernen und Supabase verifizieren — SEC-001, SEC-006

**Files:**

- Create: Contract-Migration über `supabase migration new remove_legacy_subscriber_tokens`
- Modify: `lib/supabase/types.ts`
- Modify: `security_best_practices_report.md` erst nach produktiver Verifikation

**Interfaces:**

- Consumes: vollständig deployten Cutover aus Tasks 3–5.
- Produces: keine Legacy-Token-Tabelle und keine `confirmation_token`-Spalte.

- [x] **Step 1: Vorbedingungen in Produktion read-only prüfen**

```sql
select count(*) from public.subscribers
where confirmation_token is not null;

select count(*) from public.subscriber_preference_tokens;

select purpose, count(*)
from public.subscriber_action_tokens
group by purpose
order by purpose;
```

Expected: Neue Purpose-Tokens werden produktiv erzeugt. Pending Legacy-Confirmation-Tokens wurden durch Task 3 backfilled. Der Code-Scan aus Task 5 ist ohne Legacy-Treffer.

- [x] **Step 2: Contract-Migration erzeugen**

Run: `supabase migration new remove_legacy_subscriber_tokens`

SQL:

```sql
drop function if exists public.cleanup_expired_preference_tokens();
drop function if exists public.generate_preference_token(uuid);
drop table if exists public.subscriber_preference_tokens;
alter table public.subscribers drop column if exists confirmation_token;

create or replace function public.cleanup_expired_subscriber_action_tokens()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare deleted_count integer;
begin
  delete from public.subscriber_action_tokens
  where expires_at < now() or consumed_at < now() - interval '7 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_expired_subscriber_action_tokens() from public, anon, authenticated;
grant execute on function public.cleanup_expired_subscriber_action_tokens() to service_role;
```

- [x] **Step 3: Lokal resetten und RLS/Grants prüfen**

Run:

```bash
supabase db reset
supabase migration list --local
pnpm typecheck
pnpm exec vitest run tests/api/newsletter-security.test.ts tests/lib/newsletter-access-tokens.test.ts
```

SQL:

```sql
select relrowsecurity from pg_class where oid = 'public.subscriber_action_tokens'::regclass;
select has_table_privilege('anon', 'public.subscriber_action_tokens', 'select,insert,update,delete');
select has_table_privilege('authenticated', 'public.subscriber_action_tokens', 'select,insert,update,delete');
```

Expected: `true`, `false`, `false`.

- [x] **Step 4: Expand vor Contract produktiv ausrollen**

Reihenfolge:

1. Expand-Migration aus Task 3 anwenden.
2. Tasks 4–5 deployen und einen Testnewsletter an ein kontrolliertes Konto senden.
3. Confirm, Preferences, Unsubscribe und Referral mit den vier getrennten Links prüfen.
4. Erst danach Contract-Migration anwenden.

- [x] **Step 5: Produktive anon-Probe wiederholen**

Mit dem anon-Key dürfen `subscriber_action_tokens`, `subscribers`, `referrals` und `referral_rewards` keine internen Zeilen liefern. Es werden ausschließlich `HEAD`/Count-Requests verwendet; keine DML-Probe gegen Produktivdaten.

- [x] **Step 6: Commit**

```bash
git add supabase/migrations lib/supabase/types.ts
git commit -m "security: remove legacy subscriber credentials"
```

---

### Task 7: DNS-gepinnten SSRF-Guard einführen — SEC-004

**Files:**

- Modify: `lib/security/ssrf.ts`
- Modify: `lib/webcrawl/processor.ts:15-40`
- Modify: `tests/lib/ssrf.test.ts`

**Interfaces:**

- Produces:

```ts
export interface SafeFetchOptions extends RequestInit {
  maxRedirects?: number
  timeoutMs?: number
  allowedHostname?: (hostname: string) => boolean
}
export async function safeFetch(rawUrl: string, options?: SafeFetchOptions): Promise<Response>
```

- [x] **Step 1: DNS-Rebinding- und Tracking-Redirect-Tests schreiben**

Tests müssen beweisen:

- DNS-Validierung liefert `93.184.216.34`; der Undici-Connector verwendet genau diese Adresse.
- Ein zweiter Resolverwert `127.0.0.1` wird niemals für die Verbindung abgefragt.
- Ein Redirect auf `http://169.254.169.254/` wird vor der zweiten Verbindung blockiert.
- `resolveTrackingUrl()` ruft `safeFetch` mit `HEAD`, `redirect: manual` und 5 Sekunden Timeout auf.

- [x] **Step 2: Roten Test bestätigen**

Run: `pnpm exec vitest run tests/lib/ssrf.test.ts`

Expected: Neue Pinning- und Tracking-Tests FAIL.

- [x] **Step 3: Undici-Agent an die validierte IP binden**

Für jeden Redirect-Hopp:

1. `assertPublicUrl()` löst alle Adressen auf und lehnt den Host ab, sobald eine Adresse privat/reserved ist.
2. Eine validierte Adresse wird ausgewählt.
3. Ein kurzlebiger `Agent` überschreibt `connect.lookup`, sodass nur diese Adresse zurückgegeben wird.
4. Die URL behält den Original-Hostname; Host Header und TLS-SNI bleiben korrekt.
5. `undici.fetch` erhält `dispatcher`, `redirect: 'manual'` und ein kombiniertes Abort-Signal.
6. Der Agent wird nach Response/Fehler geschlossen.

Kernform:

```ts
const dispatcher = new Agent({
  connect: {
    lookup: (_hostname, _options, callback) => {
      callback(null, pinned.address, pinned.family)
    },
  },
})
```

Der Dispatcher darf nie aus einem ungeprüften oder nachträglich neu aufgelösten Host entstehen.

- [x] **Step 4: Redirect- und Host-Policy zentralisieren**

`safeFetch` prüft `allowedHostname` auf dem Startziel und jedem Redirect. Maximal drei Redirects und standardmäßig 10 Sekunden Timeout. Authorization/Cookie Header werden bei Origin-Wechsel entfernt.

- [x] **Step 5: Tracking-Resolver migrieren**

Ersetze den direkten `fetch(url, { redirect: 'follow' })` durch:

```ts
const response = await safeFetch(url, {
  method: 'HEAD',
  timeoutMs: 5_000,
  maxRedirects: 3,
})
return response.url
```

- [x] **Step 6: Tests und Typecheck ausführen**

Run:

```bash
pnpm exec vitest run tests/lib/ssrf.test.ts
pnpm typecheck
```

Expected: alle SSRF-Tests PASS; kein direkter Tracking-Fetch mehr.

- [x] **Step 7: Commit**

```bash
git add lib/security/ssrf.ts lib/webcrawl/processor.ts tests/lib/ssrf.test.ts
git commit -m "security: pin outbound requests to validated dns addresses"
```

---

### Task 8: Öffentliche Image-Transformer begrenzen — SEC-007

**Files:**

- Create: `lib/security/bounded-body.ts`
- Create: `lib/security/safe-image-fetch.ts`
- Create: `tests/lib/bounded-body.test.ts`
- Create: `tests/api/image-proxy-security.test.ts`
- Modify: `app/api/newsletter/cover-image/route.ts`
- Modify: `app/api/newsletter/thumbnail-image/route.ts`

**Interfaces:**

- Produces:

```ts
export async function readResponseBuffer(response: Response, maxBytes: number): Promise<Buffer>
export async function fetchNewsletterImage(rawUrl: string): Promise<Buffer>
```

**Fixed Limits:** 8 MiB Download, 16 Megapixel Input, 10 Sekunden, drei Redirects, 100 Requests/Minute/IP.

- [x] **Step 1: Fehlerfälle test-first definieren**

Tests prüfen 403 für nicht allowlisteten Host/Redirect, 413 für `Content-Length > 8 MiB` und gestreamten Body über 8 MiB, 415 für falschen MIME/Magic Byte, 422 für mehr als 16 Megapixel und 429 nach Rate-Limit.

- [x] **Step 2: Roten Zustand bestätigen**

Run: `pnpm exec vitest run tests/lib/bounded-body.test.ts tests/api/image-proxy-security.test.ts`

Expected: FAIL, weil beide Routen noch `arrayBuffer()` ohne Limit nutzen.

- [x] **Step 3: Begrenzten Stream-Reader implementieren**

`readResponseBuffer()` prüft zunächst `content-length`, liest danach Chunk für Chunk, summiert Bytes und ruft bei Überschreitung `reader.cancel()` auf. Es gibt nie einen unbounded `arrayBuffer()`-Fallback.

- [x] **Step 4: Enge Image-Allowlist einführen**

`NEWSLETTER_IMAGE_HOSTS` enthält kommasepariert ausschließlich tatsächlich verwendete exakte Hosts, initial:

```text
lbrzdn804nhy3kox.public.blob.vercel-storage.com
```

Der konfigurierte Supabase-Projekthost darf zusätzlich exakt aus `NEXT_PUBLIC_SUPABASE_URL` abgeleitet werden. Wildcards wie `*.vercel-storage.com` und `*.supabase.co` entfallen. `safeFetch(requestUrl, { allowedHostname })` prüft jeden Redirect.

- [x] **Step 5: MIME, Magic Bytes und Sharp-Limits prüfen**

Erlaubt sind PNG, JPEG und WebP. Content-Type und Signatur müssen zusammenpassen. Sharp wird so instanziiert:

```ts
const image = sharp(buffer, {
  failOn: 'warning',
  limitInputPixels: 16_000_000,
  sequentialRead: true,
})
```

Cover-Ausgabe bleibt maximal 4000×4000, Thumbnail-Ausgabe maximal 1200×1200. GIF, TIFF, SVG und native VIPS-Inputs werden abgelehnt.

- [x] **Step 6: Rate Limit und Cache anwenden**

Beide Routen verwenden `rateLimiters.relaxed()` mit Schlüssel `newsletter-image:${getClientIP(request)}`. Erfolgreiche Antworten behalten einen öffentlichen Cache; Fehlerantworten sind `no-store`.

- [x] **Step 7: Tests und Preview-Smoke ausführen**

Run:

```bash
pnpm exec vitest run tests/lib/bounded-body.test.ts tests/api/image-proxy-security.test.ts
pnpm typecheck
pnpm build
```

Im Vercel Preview jeweils ein reales Cover und Thumbnail öffnen und Peak Memory/Duration in Function Logs prüfen.

- [x] **Step 8: Commit**

```bash
git add lib/security/bounded-body.ts lib/security/safe-image-fetch.ts app/api/newsletter/cover-image/route.ts app/api/newsletter/thumbnail-image/route.ts tests/lib/bounded-body.test.ts tests/api/image-proxy-security.test.ts
git commit -m "security: bound newsletter image proxy inputs"
```

---

### Task 9: Analytics-Writes validieren und budgetieren — SEC-008

**Files:**

- Create: `tests/api/analytics-security.test.ts`
- Modify: `lib/security/bounded-body.ts`
- Modify: `app/api/track/event/route.ts`
- Modify: `app/api/track/podcast-play/route.ts`
- Create: Migration über `supabase migration new analytics_retention`
- Modify: `app/api/cron/scheduled-tasks/route.ts`

**Interfaces:**

- Produces: `readJsonBody(request: Request, maxBytes: number): Promise<unknown>`.
- Fixed request limit: 8 KiB.
- Fixed rate: 100 Writes/Minute/IP je Route.
- Retention: 180 Tage `analytics_events`, 400 Tage `podcast_plays`.

- [x] **Step 1: Failing Tests für Body, Schema und Rate schreiben**

```ts
expect((await postEvent('x'.repeat(9 * 1024))).status).toBe(413)
expect((await postEvent({ eventType: 'not-allowed' })).status).toBe(400)
expect((await postPlay({ postId: 'not-a-uuid', locale: 'xx' })).status).toBe(400)
expect((await exceedAnalyticsRate()).status).toBe(429)
```

- [x] **Step 2: `readJsonBody` bounded implementieren**

Die Funktion verwendet denselben Chunk-Reader wie Responses, decodiert erst nach erfolgreichem Limit-Check UTF-8 und wirft typisierte Fehler `BODY_TOO_LARGE` oder `INVALID_JSON`.

- [x] **Step 3: Strikte Zod-Schemas anwenden**

```ts
const eventSchema = z.object({
  eventType: z.enum(['page_view', 'stock_ticker_click', 'synthszr_vote_click', 'synthszr_analysis_click', 'podcast_play']),
  path: z.string().max(500).optional(),
  company: z.string().max(200).optional(),
  locale: z.enum(['de', 'en', 'cs', 'nds', 'fr']).default('de'),
}).strict()

const podcastPlaySchema = z.object({
  postId: z.string().uuid(),
  locale: z.enum(['de', 'en', 'cs', 'nds', 'fr']).default('de'),
}).strict()
```

Invalides Input ergibt 400; übergroßes Input 413. Nur validierte Werte erreichen den Admin-Client.

- [x] **Step 4: Rate Limits vor Body und DB setzen**

Beide Routen prüfen zuerst `checkRateLimit('track-event:' + ip, relaxedLimiter)` beziehungsweise `track-podcast-play:`. Dadurch verbrauchen geblockte Requests keine Parsing- oder DB-Ressourcen.

- [x] **Step 5: DB-Retention ergänzen**

Die CLI-Migration erzeugt `cleanup_analytics_retention()` als `SECURITY INVOKER`, entzieht `PUBLIC/anon/authenticated` EXECUTE und gewährt nur `service_role`. Die Funktion löscht:

```sql
delete from public.analytics_events where created_at < now() - interval '180 days';
delete from public.podcast_plays where played_at < now() - interval '400 days';
```

`scheduled-tasks` ruft die RPC einmal täglich im bestehenden Cron-Flow auf.

- [x] **Step 6: Tests ausführen**

Run:

```bash
pnpm exec vitest run tests/api/analytics-security.test.ts tests/lib/bounded-body.test.ts
pnpm typecheck
```

Expected: PASS; DB-Mocks bestätigen null Inserts bei 400/413/429.

- [x] **Step 7: Commit**

```bash
git add lib/security/bounded-body.ts app/api/track tests/api/analytics-security.test.ts app/api/cron/scheduled-tasks/route.ts supabase/migrations
git commit -m "security: validate and budget public analytics writes"
```

---

### Task 10: Reader-Podcast-GET strikt read-only machen — SEC-013

**Files:**

- Create: `tests/api/podcast-security.test.ts`
- Modify: `app/api/podcast/[postId]/route.ts`
- Modify: `components/audio-player.tsx`
- Delete: `components/podcast-player.tsx` sofern weiterhin ohne Import

**Interfaces:**

- GET: Status/Audio ausschließlich für veröffentlichte Posts und unterstützte Locale.
- POST: einzige Generation, ausschließlich `requireAdmin()`.
- Unterstützte Podcast-Locales: `de`, `en`, `cs`, `nds`.

- [x] **Step 1: Failing Side-Effect-Tests schreiben**

```ts
expect((await getPodcast('?generate=true')).status).toBe(400)
expect(generatePodcastForPost).not.toHaveBeenCalled()
expect((await getPodcastForDraft()).status).toBe(404)
expect((await getPodcast('?locale=xx')).status).toBe(400)
expect((await postPodcastWithoutSession()).status).toBe(401)
```

- [x] **Step 2: Roten Zustand bestätigen**

Run: `pnpm exec vitest run tests/api/podcast-security.test.ts`

Expected: FAIL, weil Reader-GET noch `generate=true` verarbeitet.

- [x] **Step 3: GET auf reinen Read-Pfad reduzieren**

GET validiert UUID und Locale. `generate` oder `force` in der Query ergeben 400. Vor `post_podcasts` wird geprüft:

```ts
const { data: post } = await supabase
  .from('generated_posts')
  .select('id')
  .eq('id', postId)
  .eq('status', 'published')
  .maybeSingle()
if (!post) return NextResponse.json({ exists: false }, { status: 404 })
```

GET führt kein Upsert, Delete, Blob, LLM oder TTS aus und setzt für fertige öffentliche Audiodaten einen kontrollierten Cache-Header.

- [x] **Step 4: Generation ausschließlich in POST belassen**

POST beginnt mit `requireAdmin(request)`, validiert UUID/Locale und ruft danach `generatePodcastForPost`. Force-Regeneration wird als validiertes Body-Feld `{ locale, force }` nur im Admin-POST behandelt.

- [x] **Step 5: Client bereinigen**

`AudioPlayer` bleibt bei Status-Reads und zeigt bei fehlender Audiodatei keinen Generate-CTA. `PodcastPlayer` ist laut aktuellem Import-Scan unbenutzt und wird gelöscht; falls zwischenzeitlich importiert, wird sein Generate-Branch entfernt.

- [x] **Step 6: Tests und Leak-Scan**

Run:

```bash
pnpm exec vitest run tests/api/podcast-security.test.ts
rg -n "generate=true" app components lib --glob '*.ts' --glob '*.tsx'
pnpm typecheck
```

Expected: Tests PASS; keine öffentliche Client-Verwendung von `generate=true`.

- [x] **Step 7: Commit**

```bash
git add 'app/api/podcast/[postId]/route.ts' components/audio-player.tsx tests/api/podcast-security.test.ts
git add -u components/podcast-player.tsx
git commit -m "security: make public podcast endpoint read only"
```

---

### Task 11: Produktive Script-CSP ohne unsafe Direktiven ausrollen — SEC-009

**Files:**

- Create: `lib/security/csp.mjs`
- Create: `tests/lib/csp.test.ts`
- Modify: `next.config.mjs`
- Modify: `package.json`

**Interfaces:**

- Produces: `buildContentSecurityPolicy({ development: boolean }): string`.
- Architekturentscheidung: hash-basierte Next.js-SRI mit Webpack, damit öffentliche ISR-/CDN-Caches erhalten bleiben.

- [x] **Step 1: Produktionspolicy test-first definieren**

```ts
import { describe, expect, it } from 'vitest'

describe('CSP', () => {
  it('forbids unsafe script execution in production', async () => {
    const { buildContentSecurityPolicy } = await import('@/lib/security/csp.mjs')
    const csp = buildContentSecurityPolicy({ development: false })
    const scriptSrc = csp.split(';').find((part: string) => part.trim().startsWith('script-src'))
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    expect(scriptSrc).not.toContain("'unsafe-eval'")
  })

  it('allows unsafe-eval only in development', async () => {
    const { buildContentSecurityPolicy } = await import('@/lib/security/csp.mjs')
    expect(buildContentSecurityPolicy({ development: true })).toContain("'unsafe-eval'")
  })
})
```

- [x] **Step 2: Roten Test bestätigen**

Run: `pnpm exec vitest run tests/lib/csp.test.ts`

Expected: FAIL, weil das CSP-Modul noch nicht existiert.

- [x] **Step 3: CSP zentral bauen**

Produktives `script-src` lautet:

```text
script-src 'self' https://va.vercel-scripts.com https://vercel.live
```

Development ergänzt ausschließlich dort `'unsafe-inline' 'unsafe-eval'`. `style-src 'unsafe-inline'` bleibt zunächst separat dokumentiert, weil das Finding den Script-Ausführungspfad betrifft. Alle bisherigen `connect-src`, `media-src`, `frame-src`, `frame-ancestors`, `base-uri`, `object-src` und `form-action` Restriktionen bleiben bestehen.

- [ ] **Step 4: Next-SRI aktivieren und Webpack-Build explizit machen** — BEWUSST VERWORFEN: Projekt baut mit Turbopack; SRI ist webpack-only+experimentell, setzt integrity nur an EXTERNE Script-Tags (unsere sind same-origin) und adressiert Inline-Ausführung gar nicht → Bundler-Wechsel riskiert den Build ohne Gewinn gegen dieses Finding

`next.config.mjs`:

```js
experimental: {
  sri: { algorithm: 'sha256' },
},
```

`package.json`:

```json
"build": "next build --webpack"
```

Next.js dokumentiert SRI als experimentell und Webpack-only. Deshalb darf dieser Task erst nach erfolgreichem Preview-Build und Browser-Smoke gemerged werden.

- [ ] **Step 5: Build- und Browser-Verifikation** — Build+Response verifiziert; BROWSER-SMOKE OFFEN (Chrome-Extension nicht verbunden)

Run:

```bash
pnpm exec vitest run tests/lib/csp.test.ts
NODE_ENV=production pnpm build
```

Im Preview werden Homepage, Artikel, Admin-Login, Admin-Editor, Vercel Analytics, Audio und Supabase-Reads geöffnet. Browser Console darf keine geblockten First-Party-Scripts zeigen. Response-Verifikation:

```bash
preview_url="$(vercel deploy --yes)"
curl -sS -D - -o /dev/null "${preview_url}/de"
```

Akzeptanz: produktives `script-src` enthält weder `unsafe-inline` noch `unsafe-eval`; Core Web Vitals und Cache-Header bleiben gegenüber der Baseline unverändert.

- [x] **Step 6: Commit**

```bash
git add lib/security/csp.mjs tests/lib/csp.test.ts next.config.mjs package.json pnpm-lock.yaml
git commit -m "security: enforce strict production script csp"
```

---

### Task 12: Gmail-Tokens anwendungsseitig verschlüsseln — SEC-010

**Files:**

- Create: `lib/gmail/token-store.ts`
- Create: `tests/lib/gmail-token-store.test.ts`
- Create: `scripts/migrate-gmail-token-encryption.ts`
- Modify: `lib/crypto.ts`
- Modify: `app/api/gmail/callback/route.ts`
- Modify runtime readers: `lib/webcrawl/processor.ts`, `lib/newsletter/fetcher.ts`, `app/api/gmail/status/route.ts`, `app/api/debug/gmail/route.ts`, `app/api/debug/scan-test/route.ts`, `app/api/admin/manage-sources/route.ts`, `app/api/admin/smalltalk-topic/route.ts`, `app/api/admin/scan-gmail-senders/route.ts`, `app/api/admin/webcrawl-fetch/route.ts`, `app/api/admin/debug-labels/route.ts`, `app/api/admin/scan-subscriptions/route.ts`
- Modify script readers: `scripts/fix-newsletter-sources.ts`, `scripts/test-gmail-scan.ts`, `scripts/debug-gmail-query.ts`

**Interfaces:**

- Produces:

```ts
export async function saveGmailTokens(input: {
  email: string
  refreshToken: string
  expiry: string | null
}): Promise<void>
export async function getGmailRefreshToken(): Promise<string | null>
export async function hasGmailConnection(): Promise<boolean>
```

- Secret: `GMAIL_TOKEN_ENCRYPTION_KEY`, mindestens 32 zufällige Bytes, getrennt von `JWT_SECRET`, `ADMIN_PASSWORD` und `ENCRYPTION_KEY`.

- [ ] **Step 1: Failing Token-Store-Tests schreiben**

Tests prüfen: gespeicherter Wert beginnt mit `v2:`, enthält nicht den Klartext, entschlüsselt korrekt, falscher Key scheitert, plaintext Legacy-Wert wird vom Runtime-Reader abgelehnt und Access-Token wird nicht persistiert.

- [ ] **Step 2: Crypto-API key-injizierbar machen**

Ergänze ohne Bruch bestehender Aufrufer:

```ts
export function encryptWithSecret(text: string, secret: string): string
export function decryptWithSecret(ciphertext: string, secret: string): string
```

`encrypt()`/`decrypt()` bleiben Wrapper um `ENCRYPTION_KEY`. Gmail verwendet ausschließlich `GMAIL_TOKEN_ENCRYPTION_KEY`.

- [ ] **Step 3: Token-Store implementieren**

`saveGmailTokens()` verschlüsselt nur den Refresh-Token und setzt `access_token` auf `null`. `getGmailRefreshToken()` liest genau eine Zeile, verlangt `v2:` und entschlüsselt. Kein anderer Runtime-Code darf direkt `gmail_tokens.refresh_token` lesen.

- [ ] **Step 4: Sämtliche Runtime- und Script-Leser migrieren**

Jede oben gelistete Datei importiert `getGmailRefreshToken()` statt selbst den Admin-Client auf `gmail_tokens` anzusetzen. Status-Routen verwenden `hasGmailConnection()` und geben niemals Ciphertext oder Tokenfragmente aus.

- [ ] **Step 5: Einmalige Datenmigration implementieren**

Das Script:

1. verlangt `GMAIL_TOKEN_ENCRYPTION_KEY` und Supabase-Server-Credentials,
2. liest die einzige Token-Zeile,
3. beendet sich idempotent bei `v2:`,
4. verschlüsselt einen Legacy-Plaintextwert,
5. setzt `access_token = null`,
6. liest die Zeile erneut und prüft ausschließlich Prefix und erfolgreiche Entschlüsselung,
7. loggt niemals Token oder Ciphertext.

Run nach vorherigem Backup:

```bash
vercel env pull .env.production.local --environment=production
node --env-file=.env.production.local --import tsx scripts/migrate-gmail-token-encryption.ts
```

- [ ] **Step 6: Verifizieren und Plaintext-Fallback verbieten**

Run:

```bash
pnpm exec vitest run tests/lib/gmail-token-store.test.ts
pnpm typecheck
rg -n "from\('gmail_tokens'\).*select\('refresh_token'|select\('refresh_token'\)" app lib scripts --glob '*.ts'
```

Expected: Tests PASS; direkte Leser existieren nur innerhalb `lib/gmail/token-store.ts` und im einmaligen Migrationsscript.

Produktiv: Gmail Status prüfen, genau einen Newsletter-Fetch ausführen, danach Google Refresh-Token und Encryption-Key gemäß Runbook rotieren.

- [ ] **Step 7: Commit**

```bash
git add lib/crypto.ts lib/gmail/token-store.ts tests/lib/gmail-token-store.test.ts scripts/migrate-gmail-token-encryption.ts app/api/gmail app/api/debug app/api/admin lib/webcrawl/processor.ts lib/newsletter/fetcher.ts scripts/fix-newsletter-sources.ts scripts/test-gmail-scan.ts scripts/debug-gmail-query.ts
git commit -m "security: encrypt gmail refresh tokens at application layer"
```

---

### Task 13: Admin-Sessions opaque und widerrufbar machen — SEC-015

**Files:**

- Create: `lib/auth/session-store.ts`
- Create: `tests/lib/admin-session-store.test.ts`
- Create: Migration über `supabase migration new admin_sessions`
- Modify: `lib/auth/session.ts`
- Modify: `middleware.ts`
- Modify: `app/api/auth/login/route.ts`
- Modify: `app/api/auth/google/callback/route.ts`
- Modify: `app/api/auth/logout/route.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Produces:

```ts
export interface SessionPayload {
  isAdmin: true
  email?: string
  name?: string
  expiresAt: Date
}
export async function createSession(email?: string, name?: string): Promise<string>
export async function verifySession(token: string): Promise<SessionPayload | null>
export async function revokeSession(token: string): Promise<void>
```

- TTL: 12 Stunden; Cookie bleibt `HttpOnly`, Production-`Secure`, `SameSite=Lax`, `Path=/`.

- [x] **Step 1: Failing Session-Tests schreiben**

Tests prüfen 32-Byte-Random-Token, nur SHA-256-Hash in DB, Ablauf nach 12 Stunden, `revoked_at`, `is_admin = false` und unbekannten Token. Jeder dieser Fälle muss `null` liefern.

- [x] **Step 2: Admin-Session-Tabelle erstellen**

CLI-Migration:

```sql
create table public.admin_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  is_admin boolean not null default true,
  email text,
  name text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index admin_sessions_expiry_idx on public.admin_sessions (expires_at);
alter table public.admin_sessions enable row level security;
revoke all on table public.admin_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_sessions to service_role;
```

- [x] **Step 3: JWT durch opaque Session ersetzen**

`createSession()` mintet `randomBytes(32).toString('base64url')`, speichert nur den Hash und gibt den Raw-Token fürs Cookie zurück. `verifySession()` fragt Hash, `is_admin = true`, `revoked_at IS NULL` und `expires_at > now()` ab. `revokeSession()` setzt `revoked_at`.

- [x] **Step 4: Middleware und Cookie-Wrapper zentralisieren**

`middleware.ts` importiert `verifySession` aus `session-store.ts`; die lokale JWT-Implementierung entfällt. `getSession()` und `isAdminRequest()` verwenden denselben Store. Logout widerruft zuerst den Cookie-Token und löscht danach das Cookie.

- [x] **Step 5: JWT-Abhängigkeit entfernen**

Nach erfolgreichem Import-Scan:

```bash
rg -n "from 'jose'|jwtVerify|SignJWT" app lib middleware.ts
pnpm remove jose
```

Expected: `rg` ohne Treffer.

- [x] **Step 6: Tests und Route-Smoke**

Run:

```bash
pnpm exec vitest run tests/lib/admin-session-store.test.ts tests/lib/security.test.ts
pnpm typecheck
```

Im Preview: Passwort-Login, Google-Login, Admin-Aufruf, Logout und Wiederverwendung des alten Cookies prüfen. Der alte Cookie muss nach Logout 401 liefern.

- [x] **Step 7: Commit**

```bash
git add lib/auth/session-store.ts lib/auth/session.ts middleware.ts app/api/auth tests/lib/admin-session-store.test.ts supabase/migrations package.json pnpm-lock.yaml
git commit -m "security: add revocable opaque admin sessions"
```

---

### Task 14: Startup-Enforcement und unabhängige Cache-Auth aktivieren — SEC-011, SEC-014

**Files:**

- Create: `instrumentation.ts`
- Modify: `lib/security/startup-checks.ts`
- Modify: `tests/lib/security.test.ts`
- Modify: `app/api/revalidate-rankings/route.ts`
- Modify known callers: `scripts/_recover.ts`, `scripts/_seedream_fix.ts`, `scripts/_top3.ts`
- Modify: `docs/superpowers/plans/2026-07-04-rankings-attribution-qa.md`

**Interfaces:**

- New secret: `REVALIDATE_SECRET`, mindestens 32 zufällige Bytes.
- Revalidate-Auth: `Authorization: Bearer $REVALIDATE_SECRET`.

- [x] **Step 1: Startup- und Revalidate-Tests schreiben**

Startup-Tests prüfen:

- Production akzeptiert entweder ein vollständiges `KV_REST_API_*`-Paar oder `UPSTASH_REDIS_REST_*`.
- Ein halbes Credential-Paar ist ein Fehler.
- `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `ADMIN_PASSWORD`, `REVALIDATE_SECRET` und `GMAIL_TOKEN_ENCRYPTION_KEY` fehlen in Production niemals still.
- Es gibt keine Warnung über einen Development-Cron-Bypass.

Route-Tests prüfen 401 für Query-Secret und falschen Bearer, 200 nur für korrekten Bearer.

- [x] **Step 2: Startup-Checks korrigieren**

`validateSecurityConfig()` prüft die tatsächlich von `lib/rate-limit.ts` akzeptierten Variablenpaare. Production-Missing-Rate-Limit wird Fehler, nicht Warnung, weil Security-Routen andernfalls kollektiv auf 429 fallen. Nach Task 13 entfällt `JWT_SECRET` aus der Pflichtliste.

- [x] **Step 3: Instrumentation aktivieren**

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { enforceSecurityConfig } = await import('@/lib/security/startup-checks')
    enforceSecurityConfig()
  }
}
```

- [x] **Step 4: Revalidate-Route auf eigenes Header-Secret umstellen**

Die Route liest keine Query-Parameter. Sie vergleicht den Bearer-Token mit `REVALIDATE_SECRET` über den bestehenden timing-safe Helper aus `lib/security/cron-auth.ts` oder eine daraus extrahierte generische Funktion. Sie verwendet `rateLimiters.strict()` vor `revalidateTag()`.

- [x] **Step 5: Alle bekannten Aufrufer migrieren**

Aufrufer senden:

```ts
await fetch('https://www.synthszr.com/api/revalidate-rankings', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.REVALIDATE_SECRET}` },
})
```

Kein Secret erscheint mehr in URL, Logtext oder Dokumentation. Nach Deploy werden `SUPABASE_SERVICE_ROLE_KEY` und `REVALIDATE_SECRET` getrennt rotiert.

- [x] **Step 6: Tests und Build**

Run:

```bash
pnpm exec vitest run tests/lib/security.test.ts
pnpm typecheck
NODE_ENV=production pnpm build
rg -n "slice\(-16\)|revalidate-rankings\?secret|searchParams\.get\('secret'\)" app lib scripts docs --glob '*.ts' --glob '*.md'
```

Expected: Tests/Build PASS; Leak-Scan ohne Treffer.

- [x] **Step 7: Commit**

```bash
git add instrumentation.ts lib/security/startup-checks.ts tests/lib/security.test.ts app/api/revalidate-rankings/route.ts scripts/_recover.ts scripts/_seedream_fix.ts scripts/_top3.ts docs/superpowers/plans/2026-07-04-rankings-attribution-qa.md
git commit -m "security: enforce startup config and isolate cache auth"
```

---

### Task 15: Gesamtabnahme, Produktionsrollout und Audit-Closure

**Files:**

- Modify: `security_best_practices_report.md`
- Create: `docs/security/security-runbook.md`

**Interfaces:**

- Consumes: alle vorherigen Tasks.
- Produces: verifizierter Closure-Status und Incident-/Rotation-Runbook.

- [x] **Step 1: Vollständige lokale Quality Gates ausführen**

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm audit --audit-level=high
```

Expected: alle Befehle Exit 0. Live-API-Tests besitzen keinen impliziten Production-Fallback; sie laufen separat mit explizitem `TEST_API_URL` gegen Preview.

- [x] **Step 2: Security-spezifische Regressionstests ausführen**

```bash
pnpm exec vitest run \
  tests/lib/security.test.ts \
  tests/lib/ssrf.test.ts \
  tests/lib/newsletter-access-tokens.test.ts \
  tests/api/newsletter-security.test.ts \
  tests/lib/bounded-body.test.ts \
  tests/api/image-proxy-security.test.ts \
  tests/api/analytics-security.test.ts \
  tests/api/podcast-security.test.ts \
  tests/lib/csp.test.ts \
  tests/lib/gmail-token-store.test.ts \
  tests/lib/admin-session-store.test.ts
```

Expected: alle Tests PASS.

- [x] **Step 3: Statische Verbotsmuster prüfen**

```bash
rg -n "x-vercel-cron|synthszr_sid|[?&]sid=|SUBSCRIBER_ID|sidPlaceholder|revalidate-rankings\?secret|slice\(-16\)|redirect:\s*'follow'|unsafe-eval" app components lib scripts next.config.mjs middleware.ts
```

Erwartete Ausnahme: `unsafe-eval` darf ausschließlich im Development-Zweig von `lib/security/csp.mjs` vorkommen. Andere Treffer blockieren den Release.

- [ ] **Step 4: Supabase Advisors und effektive Rechte prüfen** — effektive Rechte per anon-Probe über alle 68 Tabellen verifiziert; **Supabase Security Advisor im Dashboard OFFEN** (installierte CLI hat kein `db advisors`)

Supabase CLI zuerst auf mindestens 2.81.3 aktualisieren und über `--help` die verfügbaren Befehle bestätigen:

```bash
supabase --version
supabase db advisors --help
supabase db advisors
supabase migration list --linked
```

Danach `pg_policies`, `information_schema.role_table_grants`, Views mit `security_invoker` und sämtliche `SECURITY DEFINER`-Funktionen exportieren und reviewen. `subscriber_action_tokens` und `admin_sessions` dürfen für `anon/authenticated` keine Rechte besitzen.

- [x] **Step 5: Vercel Preview negativ testen**

Mindestens:

- Cron ohne Bearer und nur mit `x-vercel-cron: 1` → 401.
- OAuth-Callback ohne/falsches/wiederverwendetes `state` → `invalid_state`.
- Subscribe neu/aktiv → identische 202-Response ohne `sid`.
- Preferences-Token kann nicht Unsubscribe/Referral ausführen.
- Podcast GET mit `generate=true` → 400 und keine Function-Kostenfolge.
- Revalidate mit Query-Secret → 401; mit Bearer → 200.
- Image-Redirect auf private IP → blockiert.
- CSP ohne produktives `unsafe-inline`/`unsafe-eval` im `script-src`.

- [x] **Step 6: Produktionsrollout in kontrollierten Wellen**

1. Dependency/CI.
2. Subscriber Expand-Migration.
3. Subscriber Code-Cutover und Testnewsletter.
4. Subscriber Contract-Migration.
5. SSRF/Image/Analytics/Podcast.
6. CSP Preview für mindestens 24 Stunden, danach Production.
7. Gmail Encryption-Key setzen, Migration ausführen, Funktion prüfen.
8. Admin Sessions und Startup/Revalidate.

Nach jeder Welle Function Error Rate, 401/429-Rate, Supabase Errors, Newsletter Delivery und Kosten prüfen. Rollback erfolgt pro Welle; Contract-Migration und Gmail-Datenmigration werden nicht vor erfolgreicher App-Verifikation ausgeführt.

- [x] **Step 7: Security-Runbook schreiben**

`docs/security/security-runbook.md` enthält:

- Rotation von `CRON_SECRET`, `REVALIDATE_SECRET`, `GMAIL_TOKEN_ENCRYPTION_KEY`, Supabase Service Role und Admin Password.
- Sofortige Revocation aller Admin-Sessions.
- Gmail OAuth Revoke/Reconnect.
- Dependency-Advisory-Triage mit 24-Stunden-SLA für Critical und 7 Tagen für High.
- Supabase-RLS-/Grant-Prüfung nach jeder Migration.
- Incident-Schritte bei SID-/Token-, Session- oder Service-Role-Leak.

- [ ] **Step 8: Audit schließen** — 13 Findings geschlossen; SEC-009 accepted risk, SEC-010 ausgeschlossen, SEC-016 neu (Low). Zielzustand "0 Medium/Low offen" NICHT erreicht → Audit bleibt formal offen

Aktualisiere jedes SEC-Finding nur anhand neuer Evidenz. Zielzustand:

- 0 Critical
- 0 High offen
- 0 Medium offen
- 0 Low offen
- alle 15 Findings mit Test-, Code-, CI- oder Produktions-Evidenz geschlossen

Kann ein Finding nicht geschlossen werden, bleibt der Release blockiert und das Audit offen. Ein `accepted risk` darf separat mit Owner und Ablaufdatum dokumentiert werden, zählt in diesem Plan aber nicht als Closure.

- [x] **Step 9: Finaler Commit**

```bash
git add security_best_practices_report.md docs/security/security-runbook.md
git commit -m "docs: close security remediation audit"
```

---

## Rollback- und Release-Regeln

- Kein Rollback auf Sharp 0.34.5 oder einen zweiten Lockfile-Graph.
- Kein Reaktivieren von UUID-/SID-Links, `x-vercel-cron`, Query-Secrets oder öffentlicher Podcast-Generierung.
- Subscriber-Contract-Migration erst nach erfolgreichem Testnewsletter; bei Fehler bleibt das Expand-Schema bestehen und nur der Code wird zurückgerollt.
- Gmail-Ciphertext erst schreiben, wenn der neue Reader im selben Release verfügbar ist; vor Datenmigration DB-Backup erstellen.
- CSP bei Browserbruch auf die vorherige enforce-Policy zurückrollen, aber `unsafe-eval` nicht wieder in Production aufnehmen; fehlerhafte Sources gezielt ergänzen.
- Admin-Session-Migration darf bei Problemen auf JWT-Code zurückgerollt werden, solange `admin_sessions` bestehen bleibt; alte Cookies werden nach erneutem Rollout verworfen.

## Quellen

- [Security Re-Audit](../../../security_best_practices_report.md)
- [Next.js Content Security Policy](https://nextjs.org/docs/app/guides/content-security-policy)
- [Vercel Cron Authentication](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Securing the Data API](https://supabase.com/docs/guides/api/securing-your-api)
- [Sharp Advisory GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj)
- [Vitest Advisory GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp)
- [protobufjs Advisory GHSA-xq3m-2v4x-88gg](https://github.com/advisories/GHSA-xq3m-2v4x-88gg)
