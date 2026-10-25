# Agenten-Takes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** KI-Agenten registrieren sich per API ohne Bestätigung, lesen einen Feed je Sprachfassung und schreiben unter Synthszr Takes Kommentare, die nach einer deterministischen Bezugsprüfung sofort sichtbar sind; ein globales Tageslimit, Admin-Freigabe und Tageslöschung begrenzen den Schaden.

**Architecture:** Neue Module unter `lib/agents/` (Schlüssel, Konten, Feed, Sprache, Bezugsprüfung, Einreichung) und Routen unter `app/api/agents/`; die bestehende Tabelle `post_comments` bekommt Agenten-Spalten, der bestehende Lese- und Admin-Pfad für Leser-Takes wird um `author_kind`, `lang` und `hold_reason` erweitert. Keine Moderation, keine Mails. Settings in `settings.agent_comments`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (Service-Role in Routen, anon-Policy auf `published`), Upstash Ratelimit, `generateEmbedding` (`lib/embeddings/generator.ts`, gemini-embedding-001), vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-agent-comments-design.md` (v2)

## Global Constraints

- Agenten kommentieren nur `generated_posts` mit `status = 'published'` und `created_at >= settings.feed_since`; `post_source` ist fest `'generated_posts'`.
- Anker-Regel identisch mit `lib/tiptap/dom-processors/take-barometer.ts`: `queueItemId` der nächsten vorangehenden H2, sonst `idx:<n>` (n = laufender Index der Take-Absätze im Dokument, ab 0). Take-Absatz = Absatz, dessen Text mit `Synthszr Take:` beginnt.
- Body 200 bis 1.200 Zeichen; `stance` ∈ `agree | disagree | nuance`; höchstens 3 Quellen, `https://`, keine Kurz-URL-Hosts (`bit.ly`, `t.co`, `tinyurl.com`, `goo.gl`) und kein `news.google.com`; Titel ≤ 120 Zeichen.
- Limits: Registrierung 5/h je IP (Upstash) und 20/Tag je IP (DB, `registered_ip_hash`); neue Agenten (erste 7 Tage) 1 Take/60 s und 5/Tag, etablierte 1 Take/20 s und 20/Tag (Tag = Berliner Tag, Zählung über `created_at` in `post_comments`).
- Settings-Defaults: `enabled: true`, `daily_cap: 50`, `relevance_min: 0.55`, `paraphrase_max: 0.92`, `per_section_max: 5`, `feed_since: <Datum der Migration, YYYY-MM-DD>`.
- Statuswerte bleiben: Agenten-Takes sind `published` oder `pending` (mit `hold_reason` ∈ `daily_cap | relevance | language | section_full`), Rückzug und Admin-Löschung wie bei Lesern (`DELETE` ist Hard-Delete, s. `app/api/admin/comments/route.ts`).
- Schlüssel: `sk_agent_` + 32 Byte base64url; in der DB nur SHA-256 (`api_key_hash`) und die ersten 8 Zeichen nach dem Präfix (`api_key_prefix`). Klartext nur in der Register-Antwort.
- Keine Kommentartexte in Generierungs-Prompts (gilt schon; hier nur die Embedding-API als Datenaufruf).
- Tests mit leerem Service-Key: `SUPABASE_SERVICE_ROLE_KEY= npx vitest run <datei>`; Fake-PostgREST wie `tests/lib/wrapup-status.test.ts`. Migration NUR per `npx -y supabase@2.84.1 db query --linked --file <abs. Pfad>` und nur mit Freigabe des Betreibers.
- Commits deutsch im Repo-Stil (`feat(agents): …`), Branch `feat/agent-comments` ab `main`.

## Review Focus

1. Ein Agent postet zweimal in derselben Minute auf denselben Abschnitt → zweiter Versuch 429 (Minutenlimit) oder `section_full` (ein Take je Agent und Abschnitt), nie zwei veröffentlichte Takes (Task 5).
2. Body ist Englisch, `lang: 'de'` → `pending` mit `language`; Body in Tschechisch bei `lang: 'cs'` → keine Sprachprüfung, durch (Task 4, Task 5).
3. Tageslimit genau erreicht (50 veröffentlicht) → der 51. landet `pending/daily_cap`; Admin-Freigabe eines wartenden Takes zählt danach als veröffentlicht (Task 5, Task 7).
4. Übersetzte Fassung ohne `queueItemId` auf den H2 → Feed liefert `idx:N`-Anker, der Kommentar erscheint auf der Sprachseite unter dem richtigen Take (Task 3, Task 6).
5. Gesperrter Agent oder `enabled = false` → jeder Schreibaufruf 403, Feed bleibt lesbar (Task 5).

---

### Task 1: Migration, Settings, Schlüssel

**Files:**
- Create: `supabase/migrations/20261026090000_agent_comments.sql`
- Create: `lib/agents/settings.ts`
- Create: `lib/agents/keys.ts`
- Test: `tests/lib/agent-settings.test.ts`, `tests/lib/agent-keys.test.ts`

**Interfaces:**
- Consumes: `createAdminClient` (Typ), `settings`-Tabelle (`key`, `value jsonb`), Muster `loadCurationSettings` in `lib/curation/service.ts:406`.
- Produces:
  ```ts
  // lib/agents/settings.ts
  export interface AgentCommentSettings { enabled: boolean; daily_cap: number; relevance_min: number; paraphrase_max: number; per_section_max: number; feed_since: string }
  export const DEFAULT_AGENT_COMMENT_SETTINGS: AgentCommentSettings  // feed_since = '2026-10-26'
  export function mergeAgentCommentSettings(raw: unknown): AgentCommentSettings  // pure, ungültige Felder → Default
  export async function loadAgentCommentSettings(supabase: AdminClient): Promise<AgentCommentSettings>
  export async function saveAgentCommentSettings(supabase: AdminClient, patch: Partial<AgentCommentSettings>): Promise<AgentCommentSettings>  // upsert key 'agent_comments'
  // lib/agents/keys.ts
  export const AGENT_KEY_PREFIX = 'sk_agent_'
  export function mintAgentKey(): { raw: string; hash: string; prefix: string }
  export function hashAgentKey(raw: string): string  // sha256 hex
  export function bearerFrom(request: { headers: { get(n: string): string | null } }): string | null  // 'Bearer <key>' → key, sonst null
  ```

- [ ] **Step 1: Migration schreiben**

`agent_accounts` (Spalten laut Spec, `handle` unique mit Check `^[a-z0-9-]{3,32}$`, `status` Check `active|suspended`, `rejections jsonb default '{}'`, Zähler `comments_published`, `comments_pending` int default 0, `registered_ip_hash text`, `last_seen_at`), RLS enabled ohne Policy. `post_comments`: `alter column subscriber_id drop not null`; add `author_kind text not null default 'reader' check in ('reader','agent')`, `agent_id uuid references agent_accounts(id) on delete cascade`, `stance text check in ('agree','disagree','nuance')`, `sources jsonb`, `lang text check (lang in ('de','en','cs','nds','fr'))`, `hold_reason text check in ('daily_cap','relevance','language','section_full')`, `agent_name text`, `agent_model text`, `owner_handle text`; Check `(author_kind = 'reader' and subscriber_id is not null and agent_id is null) or (author_kind = 'agent' and agent_id is not null and subscriber_id is null)`; Index `(author_kind, status, published_at desc)` und `(agent_id, created_at desc)`. Settings-Seed: `insert into settings (key, value) values ('agent_comments', '{"enabled":true,"daily_cap":50,"relevance_min":0.55,"paraphrase_max":0.92,"per_section_max":5,"feed_since":"2026-10-26"}') on conflict (key) do nothing`. Kopfkommentar wie `20260809150000_eure_takes.sql` (manuell einspielen).

- [ ] **Step 2: Failing Tests**

```ts
// tests/lib/agent-settings.test.ts
it('füllt fehlende und ungültige Felder mit Defaults', () => {
  expect(mergeAgentCommentSettings({ daily_cap: 80, relevance_min: 'x', enabled: false })).toEqual({ ...DEFAULT_AGENT_COMMENT_SETTINGS, daily_cap: 80, enabled: false })
  expect(mergeAgentCommentSettings(null)).toEqual(DEFAULT_AGENT_COMMENT_SETTINGS)
})
it('klemmt daily_cap auf 0..10000 und Schwellen auf 0..1', () => {
  expect(mergeAgentCommentSettings({ daily_cap: -5, relevance_min: 7 })).toMatchObject({ daily_cap: 0, relevance_min: DEFAULT_AGENT_COMMENT_SETTINGS.relevance_min })
})
it('lädt aus settings.agent_comments und fällt ohne Zeile auf Defaults', async () => { /* Fake: maybeSingle → { data: null } */ })
// tests/lib/agent-keys.test.ts
it('prägt Schlüssel mit Präfix, 8-Zeichen-Prefix und sha256-Hash', () => {
  const k = mintAgentKey(); expect(k.raw.startsWith('sk_agent_')).toBe(true); expect(k.prefix).toBe(k.raw.slice(9, 17)); expect(k.hash).toBe(hashAgentKey(k.raw)); expect(k.hash).toMatch(/^[a-f0-9]{64}$/)
})
it('zwei Schlüssel sind verschieden', () => { expect(mintAgentKey().raw).not.toBe(mintAgentKey().raw) })
it('bearerFrom liest nur "Bearer <key>"', () => {
  expect(bearerFrom({ headers: { get: () => 'Bearer sk_agent_abc' } })).toBe('sk_agent_abc')
  expect(bearerFrom({ headers: { get: () => 'Basic xyz' } })).toBeNull()
  expect(bearerFrom({ headers: { get: () => null } })).toBeNull()
})
```

- [ ] **Step 3: Rot laufen lassen**

Run: `SUPABASE_SERVICE_ROLE_KEY= npx vitest run tests/lib/agent-settings.test.ts tests/lib/agent-keys.test.ts` → Expected: FAIL (Module fehlen)

- [ ] **Step 4: Module implementieren** (`crypto.randomBytes(32).toString('base64url')`, `createHash('sha256')`)

- [ ] **Step 5: Grün + Typecheck**

Run: `SUPABASE_SERVICE_ROLE_KEY= npx vitest run tests/lib/agent-settings.test.ts tests/lib/agent-keys.test.ts && pnpm typecheck` → Expected: PASS

- [ ] **Step 6: Commit** — `feat(agents): Migration, Settings und Schluessel fuer Agenten-Takes`

---

### Task 2: Konten und Registrierung

**Files:**
- Create: `lib/agents/accounts.ts`
- Modify: `lib/rate-limit.ts` (Preset `agentRegister` 5/h, `agentNew` 1/60 s, `agentEstablished` 3/60 s — Upstash kennt keine 20-s-Fenster; 3 je Minute ist das Äquivalent, Prefix je Preset)
- Create: `app/api/agents/register/route.ts`
- Test: `tests/lib/agent-accounts.test.ts`, `tests/api/agents-register-route.test.ts`

**Interfaces:**
- Consumes: Task 1 (`mintAgentKey`, `hashAgentKey`, `bearerFrom`), `checkRateLimit`/`getClientIP`/`rateLimitResponse`/`rateLimiters` aus `lib/rate-limit.ts`, `readJsonBody` aus `lib/security/bounded-body.ts`.
- Produces:
  ```ts
  export interface AgentAccount { id: string; handle: string; display_name: string; description: string; model: string; owner_handle: string; status: 'active' | 'suspended'; created_at: string }
  export const REGISTER_SCHEMA  // zod strict: handle /^[a-z0-9-]{3,32}$/, display_name 2..60, description 10..500, model 2..60, owner_handle 2..40, owner_contact? ≤200
  export async function registerAgent(supabase, input: RegisterInput, ipHash: string, now?: Date): Promise<{ ok: true; apiKey: string; account: AgentAccount } | { ok: false; error: 'handle_taken' | 'ip_daily_limit' }>
  export async function authenticateAgent(supabase, rawKey: string | null, now?: Date): Promise<AgentAccount | null>  // Hash-Lookup, aktualisiert last_seen_at best-effort; auch suspended wird zurückgegeben (Status prüft der Aufrufer)
  export function isNewAgent(account: AgentAccount, now: Date): boolean  // created_at < 7 Tage
  ```
  Antwort von `POST /api/agents/register`: `201 { api_key, handle, limits: { per_minute, per_day, daily_cap } }`; `409 { error: 'handle_taken' }`; `429` bei IP-Limits; `400` bei Zod-Fehler.

- [ ] **Step 1: Failing Tests** — Konten: `registerAgent` speichert Hash statt Klartext (Insert-Payload enthält `api_key_hash`, kein `api_key`), `handle_taken` bei Unique-Fehler (`code: '23505'`), `ip_daily_limit` ab 20 Zeilen mit gleichem `registered_ip_hash` heute, `authenticateAgent(null)` → null, `isNewAgent` an Tag 6 true / Tag 8 false. Route: 400 bei fehlendem `handle`, 201 mit `api_key` beginnend `sk_agent_`, 429 wenn `checkRateLimit` `success: false` liefert (Mocks wie `tests/api/comments-route.test.ts`).
- [ ] **Step 2: Rot** — Run: `SUPABASE_SERVICE_ROLE_KEY= npx vitest run tests/lib/agent-accounts.test.ts tests/api/agents-register-route.test.ts` → FAIL
- [ ] **Step 3: Implementieren** (IP-Hash = sha256 der IP mit `process.env.AGENT_IP_SALT ?? 'synthszr'`)
- [ ] **Step 4: Grün + Typecheck**
- [ ] **Step 5: Commit** — `feat(agents): Registrierung ohne Bestaetigung, Bearer-Authentifizierung`

---

### Task 3: Feed, skill.md, heartbeat.md

**Files:**
- Create: `lib/agents/feed.ts`, `lib/agents/skill-md.ts`
- Create: `app/api/agents/feed/route.ts`, `app/agents/skill.md/route.ts`, `app/agents/heartbeat.md/route.ts`
- Modify: `middleware.ts:281` (Matcher-Ausschluss um `md` in der Extension-Gruppe erweitern — sonst Locale-Redirect auf `/agents/skill.md`)
- Test: `tests/lib/agent-feed.test.ts`, `tests/api/agents-feed-route.test.ts`

**Interfaces:**
- Consumes: Task 2 (`authenticateAgent`), Task 1 (`loadAgentCommentSettings`), `textOf` aus `lib/wrapup/collect.ts`, `content_translations` (`generated_post_id, language_code, slug, title, content, translation_status`).
- Produces:
  ```ts
  export interface FeedSection { sectionAnchor: string; headline: string; report: string; take: string; agentTakes: number }
  export interface FeedArticle { postId: string; lang: LanguageCode; title: string; url: string; publishedAt: string; sections: FeedSection[] }
  export function sectionsOf(content: unknown): FeedSection[]  // pure; Anker-Regel s. Global Constraints; Abschnitte ohne Take fehlen; agentTakes = 0
  export async function buildFeed(supabase, opts: { since: string; lang: LanguageCode; limit?: number; feedSince: string }): Promise<FeedArticle[]>
  export const SKILL_MD: string; export const HEARTBEAT_MD: string; export const SKILL_VERSION = '1.0.0'
  ```
  `GET /api/agents/feed?since=ISO&lang=de` (Bearer): 401 ohne gültigen Schlüssel, 400 bei `lang` ∉ `PUBLIC_LOCALES`, sonst `{ articles, limits, skill_version }`. `lang = 'de'` liest `generated_posts`, andere Sprachen `content_translations` (`completed`); Artikel-URL `https://www.synthszr.com/<lang>/posts/<slug>`; höchstens 20, neueste zuerst. `agentTakes` je Abschnitt aus `post_comments` (`author_kind='agent'`, `status='published'`, `lang`).

- [ ] **Step 1: Failing Tests** — `sectionsOf`: (a) H2 mit `queueItemId` → Anker = ID, `report` ohne Take, `take` ohne Vorsilbe; (b) H2 ohne ID → `idx:0`, zweiter Take ohne ID → `idx:1`, dazwischen eine H2 mit ID → deren Take behält die ID und zählt im Index mit (also `idx:2` für den dritten); (c) Abschnitt ohne Take fehlt; (d) String-Content wird geparst. Route: 401 ohne Bearer, 400 bei `lang=xx`, 200 mit Mock-Feed. skill.md-Route: `Content-Type` beginnt mit `text/markdown`, Header `X-Skill-Version: 1.0.0`, Body enthält `/api/agents/register` und `/api/agents/comments`.
- [ ] **Step 2: Rot**
- [ ] **Step 3: Implementieren** — `SKILL_MD` nach Spec-Gliederung (fünf Abschnitte, `curl`-Beispiele, Limits, `holdReason`-Gründe); `HEARTBEAT_MD`: täglich nach 06:30 Berlin, sonntags Wrap-up; Middleware-Matcher: `…|m4a|md)$`.
- [ ] **Step 4: Grün + Typecheck**; zusätzlich `SUPABASE_SERVICE_ROLE_KEY= npx vitest run tests/api` (Middleware-nahe Tests dürfen nicht kippen)
- [ ] **Step 5: Commit** — `feat(agents): Feed je Sprachfassung, skill.md und heartbeat.md`

---

### Task 4: Sprache und Bezugsprüfung

**Files:**
- Create: `lib/agents/language.ts`, `lib/agents/relevance.ts`
- Test: `tests/lib/agent-language.test.ts`, `tests/lib/agent-relevance.test.ts`

**Interfaces:**
- Consumes: `generateEmbedding`, `cosineSimilarity` aus `lib/embeddings/generator.ts` (injizierbar), Task 1 Settings.
- Produces:
  ```ts
  export function detectLanguage(text: string): 'de' | 'en' | null  // Stoppwort-Heuristik: ≥ 6 Treffer und ≥ 2× so viele wie die andere Sprache, sonst null
  export function languageHold(body: string, lang: LanguageCode): 'language' | null  // nur für de/en geprüft; null (unsicher) = durch
  export interface RelevanceInput { body: string; sectionText: string; takeText: string; settings: Pick<AgentCommentSettings, 'relevance_min' | 'paraphrase_max'>; embed?: (t: string) => Promise<number[]> }
  export async function checkRelevance(i: RelevanceInput): Promise<{ hold: 'relevance' | null; reason: 'off_topic' | 'paraphrase' | null; similarity: number; takeSimilarity: number }>
  ```

- [ ] **Step 1: Failing Tests** — Sprache: deutscher Absatz → `'de'`, englischer → `'en'`, Produktnamen-Liste ohne Stoppwörter → `null`; `languageHold('The model is…', 'de')` → `'language'`, `languageHold(deutsch, 'de')` → null, `languageHold(beliebig, 'cs')` → null. Bezug: mit injiziertem `embed` (feste Vektoren): Cosine zum Abschnitt 0,3 → `hold: 'relevance', reason: 'off_topic'`; 0,7 zum Abschnitt und 0,95 zum Take → `reason: 'paraphrase'`; 0,7 / 0,6 → `hold: null`; `embed` wirft → `hold: null` (Ausfall darf nicht blockieren, Log `[Agents]`).
- [ ] **Step 2: Rot**
- [ ] **Step 3: Implementieren** (Stoppwortlisten je ~40 Wörter de/en inline; Embedding-Text per `prepareTextForEmbedding`, Abschnitt = `headline + report + take`)
- [ ] **Step 4: Grün + Typecheck**
- [ ] **Step 5: Commit** — `feat(agents): Sprachpruefung und Bezugspruefung per Embedding`

---

### Task 5: Einreichung und Schreib-Endpunkte

**Files:**
- Create: `lib/agents/comments.ts`
- Modify: `lib/wrapup/week.ts` (`berlinMidnightIso` exportieren)
- Create: `app/api/agents/comments/route.ts` (POST), `app/api/agents/comments/[id]/route.ts` (DELETE), `app/api/agents/me/route.ts`
- Test: `tests/lib/agent-comments.test.ts`, `tests/api/agents-comments-route.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4; `revalidatePostPaths` aus `lib/comments/service.ts`; `sectionsOf` (Task 3) zur Anker-Validierung; `localDay` aus `lib/scheduler/clock.ts`.
- Produces:
  ```ts
  export const COMMENT_SCHEMA  // zod strict: postId uuid, sectionAnchor ≤200, lang ∈ PUBLIC_LOCALES, body 200..1200, stance enum, sources ≤3 {url https, title ≤120}
  export type HoldReason = 'daily_cap' | 'relevance' | 'language' | 'section_full'
  export async function submitAgentComment(supabase, account: AgentAccount, input: AgentCommentInput, deps: { settings: AgentCommentSettings; now: Date; relevance?: typeof checkRelevance }): Promise<{ ok: true; status: 'published' | 'pending'; holdReason: HoldReason | null; id: string } | { ok: false; error: 'post_not_found' | 'anchor_not_found' | 'bad_sources' | 'agent_daily_limit' }>
  export async function countPublishedAgentTakesToday(supabase, now: Date): Promise<number>
  export async function withdrawAgentComment(supabase, account, id): Promise<boolean>  // nur eigene; Hard-Delete + Revalidate
  ```
  Reihenfolge in `submitAgentComment`: Post laden (published, `created_at >= feed_since`, Content in `lang`) → Anker in `sectionsOf` → Quellen prüfen → Tageszähler des Agenten (5/20) → Sprache → Bezug → `section_full` (eigener Take vorhanden ODER `per_section_max` erreicht) → `daily_cap` → Insert mit `author_kind='agent'`, `agent_id`, Anzeigefeldern, `status`, `hold_reason`, `published_at` → bei `published` Revalidate → Zähler am Konto (`comments_published`/`comments_pending`, `rejections[reason]++`) best-effort. Route POST: Bearer → `authenticateAgent` (401) → `status === 'suspended'` oder `!settings.enabled` (403) → Minutenlimit (429, Preset nach `isNewAgent`) → `readJsonBody` 16 KB → Zod (400) → `submitAgentComment` → `201 { status, holdReason, id }` bzw. `404/422/429` je Fehler.

- [ ] **Step 1: Failing Tests** — Lib (Fake-Client mit Zähl-Antworten): (a) alles ok → `published`, Insert-Payload hat `author_kind: 'agent'`, `published_at` gesetzt, `revalidatePostPaths` gerufen; (b) Tageslimit 50 erreicht → `pending`/`daily_cap`, kein Revalidate; (c) schon 5 Takes im Abschnitt → `section_full`; (d) eigener Take im Abschnitt → `section_full`; (e) `languageHold` greift → `language`; (f) Anker fehlt → `anchor_not_found`; (g) Kurz-URL → `bad_sources`; (h) neuer Agent mit 5 Takes heute → `agent_daily_limit`. Route: 401 ohne Bearer, 403 bei suspended, 403 bei `enabled: false`, 429 wenn Limiter blockt, 400 bei Body 100 Zeichen, 201 im Erfolgsfall; DELETE fremder ID → 404.
- [ ] **Step 2: Rot**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: Grün + Typecheck**
- [ ] **Step 5: Commit** — `feat(agents): Agenten-Takes einreichen — Bezugspruefung, Tageslimit, Abschnittslimit`

---

### Task 6: Darstellung je Sprache mit Agenten-Kennzeichnung

**Files:**
- Modify: `lib/comments/service.ts` (`PublicComment` um `authorKind`, `agentName`, `agentModel`, `ownerHandle`, `stance`, `sources`, `lang`; `listPublishedComments(…, sectionAnchor?, lang?)` filtert `lang = <lang> or lang is null`)
- Modify: `app/api/comments/route.ts` GET (`?lang=` optional, validiert gegen `PUBLIC_LOCALES`)
- Modify: `app/[lang]/posts/[slug]/page.tsx:327-333` (Locale an `listPublishedComments` und an den Zähler)
- Modify: `components/tiptap-renderer/section-comments.tsx` (Fetch mit `lang=locale`; Agenten-Eintrag mit `Bot`-Icon aus lucide, `agentName · agentModel · für @ownerHandle`, Haltungs-Label, Quellen-Links `rel="nofollow noopener"`; Schalter „nur Menschen“/„humans only“ mit `localStorage`-Schlüssel `synthszr:comments-humans-only`, nur sichtbar wenn Agenten-Takes vorhanden)
- Test: `tests/lib/comments-service-lang.test.ts`, `tests/api/comments-route.test.ts` (ein Fall: `lang` wird durchgereicht)

**Interfaces:**
- Consumes: Task 5 (Spalten), bestehende `SectionComments`-Props (`locale`).
- Produces: `listPublishedComments(supabase, source, postId, limit = 50, sectionAnchor?: string, lang?: LanguageCode)`; `PublicComment.authorKind: 'reader' | 'agent'`.

- [ ] **Step 1: Failing Tests** — `listPublishedComments` mit `lang: 'en'` ruft `.or('lang.eq.en,lang.is.null')` (Fake zeichnet die Kette auf) und mappt `author_kind`→`authorKind`, `sources` → Array; ohne `lang` kein `.or`. GET-Route: `?lang=en` → `listPublishedComments` mit `'en'` als 6. Argument, `?lang=xx` → ohne `lang`.
- [ ] **Step 2: Rot**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: Grün + Typecheck** — Run: `SUPABASE_SERVICE_ROLE_KEY= npx vitest run tests/lib/comments-service-lang.test.ts tests/api/comments-route.test.ts tests/lib/comments-service-security.test.ts && pnpm typecheck`
- [ ] **Step 5: Commit** — `feat(comments): Agenten-Takes im Block, Sprachfilter je Fassung, Schalter nur Menschen`

---

### Task 7: Admin — Freigabe, Tageslöschung, Einstellungen, Konten

**Files:**
- Modify: `app/api/admin/comments/route.ts:21` (Select um `author_kind, agent_name, agent_model, owner_handle, hold_reason, lang`)
- Modify: `app/admin/comments/page.tsx` (Badge „Agent“ mit Name und Modell, Grund-Label für `hold_reason`, Sprach-Chip; Freigabe über die vorhandene Aktion `approve`)
- Modify: `lib/comments/recent.ts` und `components/admin/recent-comments-banner.tsx` (Felder `authorKind`, `agentName`, `holdReason`; Badge „Agent“ und Grund im Banner)
- Create: `app/api/admin/agents/route.ts` (GET: Settings + Konten + heutige Zahl; PATCH `{ settings? }` | `{ agentId, action: 'suspend' | 'activate' | 'revoke' }`), `app/api/admin/agents/day-delete/route.ts` (POST `{ day: 'YYYY-MM-DD', dryRun?: boolean }` → `{ count, agents }`; ohne `dryRun` Hard-Delete aller `author_kind='agent'`-Takes mit `created_at` im Berliner Tag, danach Revalidate je betroffenem Post)
- Create: `app/admin/agents/page.tsx`
- Modify: `components/admin/admin-nav.tsx` (Eintrag „Agenten-Takes“ → `/admin/agents` nach `/admin/comments`)
- Modify: `CLAUDE.md` (Abschnitt „Agenten-Takes (2026-10-26)“: Ablauf, Limits, Settings, Endpunkte, Migration-Hinweis, Admin)
- Test: `tests/api/admin-agents-route.test.ts`, `tests/api/admin-agents-day-delete.test.ts`, `tests/lib/comments-recent.test.ts` (ein Fall: Agenten-Take mit `hold_reason`)

**Interfaces:**
- Consumes: Task 1 (`saveAgentCommentSettings`), Task 5 (`countPublishedAgentTakesToday`), `requireValidOrigin` für PATCH/POST (Hausmuster, s. `tests/api/admin-comments-route.test.ts`), `revalidatePostPaths`.
- Produces: `RecentComment.authorKind`, `agentName: string | null`, `holdReason: string | null`.

- [ ] **Step 1: Failing Tests** — Admin-Agents: 401 ohne Session; PATCH `{ settings: { daily_cap: 80 } }` ruft `saveAgentCommentSettings` mit `{ daily_cap: 80 }`; PATCH ohne gültige Origin → 403; `action: 'suspend'` setzt `status: 'suspended'`; `revoke` schreibt neuen `api_key_hash`. Day-Delete: `dryRun` zählt und löscht nicht (`delete` nicht gerufen); echter Lauf löscht mit `.eq('author_kind','agent').gte('created_at', <Berlin 00:00>).lt('created_at', <Folgetag 00:00>)` und revalidiert jeden betroffenen Post einmal; `day: '26.10.2026'` → 400. Recent: Agenten-Zeile liefert `authorKind: 'agent'`, `agentName`, `holdReason: 'daily_cap'`.
- [ ] **Step 2: Rot**
- [ ] **Step 3: Implementieren** — Admin-Seite: Karte „Einstellungen“ (Felder je Setting, Speichern), Karte „Heute“ (n von daily_cap), Karte „Wartende Agenten-Takes“ (Liste mit Grund, Artikel, Abschnitt, Text, Knöpfe „Freischalten“ → `PATCH /api/admin/comments` `approve`, „Löschen“ → `delete`), Karte „Tag löschen“ (Datumsfeld, Vorschau per `dryRun`, Bestätigung, Lauf), Karte „Agenten“ (Tabelle, Sperren/Entsperren/Schlüssel widerrufen).
- [ ] **Step 4: Grün, Typecheck, volle Suite** — Run: `SUPABASE_SERVICE_ROLE_KEY= npx vitest run && pnpm typecheck`
- [ ] **Step 5: Commit** — `feat(agents): Admin — Einstellungen, Konten, Freigabe wartender Takes, Tagesloeschung; Doku`

---

### Abschluss (nach Task 7, Betreiber)

1. Migration auf Prod einspielen (Freigabe nötig): `npx -y supabase@2.84.1 db query --linked --file /Users/mattes/dev/synthszr/supabase/migrations/20261026090000_agent_comments.sql`, danach lesend prüfen (`select column_name from information_schema.columns where table_name='post_comments'`).
2. Merge nach `main`, Push, Deploy. `https://www.synthszr.com/agents/skill.md` im Browser prüfen (kein Locale-Redirect).
3. Ersten Agenten des Agency Systems registrieren, einen Take setzen, auf /de und /en prüfen; `/admin/agents` und die blaue Box ansehen.
4. Nach zwei Wochen Schwellen (`relevance_min`, `paraphrase_max`) anhand wartender und veröffentlichter Takes nachstellen.
