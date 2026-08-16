# SEO Site-weit Runde 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die im Site-weiten Follow-up-Audit (2026-07-03, nach dem Rankings-Fix-Batch) gefundenen SEO-Blocker beheben: falsche Canonicals, fehlendes Edge-Caching auf allen Detailseiten, unsichtbare Companies-Sektion, Artikel-Volltext nicht im Server-HTML, Middleware-TTFB, Cover-Bildformat, fehlende Schemas.

**Architecture:** Drei Muster ziehen sich durch: (1) `createClient` (cookie-basiert) → `createAnonClient` (env-basiert) macht Routen ISR-fähig — für anonyme Besucher ist die RLS-Sicht identisch, es ändert sich nichts an den Daten; (2) leeres `generateStaticParams` aktiviert on-demand ISR auf Dynamic-Segment-Routen (Erkenntnis aus Runde 1: Vercel ignoriert `revalidate` sonst); (3) Client-only-Content bekommt server-gerenderte Fallbacks (Companies-Tabelle: initiale Rows aus Props; Artikel-Body: `generateHTML` aus TipTap-JSON, das der Client-Editor nach Hydration ersetzt).

**Tech Stack:** Next.js 16 App Router, TipTap 3.14 (`generateHTML` aus `@tiptap/core` läuft serverseitig — im Repo bereits bewiesen durch `lib/utils/markdown-to-tiptap.ts`), Supabase, Vitest, Vercel.

## Global Constraints

- **Deploy:** Alle Änderungen direkt auf `main` (User-Präferenz). Vercel deployt automatisch.
- **Verifikation:** Lokal `npm run build` + Vitest; für Rendering-Checks `npx next start -p 3199` + curl (`.env.local` vorhanden). Finale Prod-Verifikation gebündelt in Task 12. WICHTIG: gegen Prod (synthszr.com) NUR die in Task 12 gelisteten Requests, mit `sleep 2` dazwischen — die Vercel-DDoS-Mitigation hat heute bereits einmal angeschlagen.
- **Client-Tausch-Regel:** `const supabase = await createClient()` (aus `@/lib/supabase/server`) → `const supabase = createAnonClient()` (aus `@/lib/supabase/admin`, synchron, KEIN await). NIE `createAdminClient` als Ersatz verwenden (würde RLS umgehen und könnte mehr Daten zeigen als heute).
- **Kanonischer Host:** überall `https://www.synthszr.com`. `SITE_URL`/`safeJsonLd` aus `@/lib/seo/site`.
- **Kein erfundenes Schema-Markup** (kein aggregateRating/offers).
- **Surgical changes**, deutsche Code-Kommentare wie im Repo üblich.
- **Bekannter Kontext aus Runde 1:** `generateLocalizedMetadata` (lib/i18n/metadata.ts) liefert canonical+hreflang+OG; `locale`-Param nicht übergeben ⇒ Fallback DEFAULT_LOCALE='de' (Bug-Quelle); Middleware setzt `s-maxage=60`-Header auf locale-Routen, aber dynamische Routen überschreiben mit `no-store` — deshalb ISR nötig.

## Bewusst NICHT in diesem Plan

- **Legacy-Routen ohne Locale-Präfix aufräumen** (`app/posts/`, `app/archive/`, `app/why/`, `app/companies/`, `app/impressum/`, `app/datenschutz/`): Middleware fängt sie zuverlässig ab (Live verifiziert: 307 auf `/{lang}/…`), Löschen ist reines Hygiene-Refactoring mit Regressionsrisiko → eigenes Ticket.
- **Cover-Pipeline auf WebP-Erzeugung umstellen** (`app/api/generate-image/route.ts`, 10+ Stellen): Task 10 löst das Auslieferungs-Problem stattdessen über Next Image Optimization — Pipeline bleibt unangetastet.
- **`<html lang>`-SSR**: weiterhin deferred (Route-Group-Restructure).
- **`rankings.group.*`-i18n-Keys**: kosmetisch, Backlog.

---

### Task 1: Canonical-Fix — fehlender `locale`-Parameter auf 4 Seiten

`/en/why`, `/en/archive` etc. kanonisieren heute fälschlich auf die `/de`-Version, weil `generateLocalizedMetadata` ohne `locale` auf `de` zurückfällt.

**Files:**
- Modify: `app/[lang]/why/page.tsx:24-28`
- Modify: `app/[lang]/archive/page.tsx:29-33`
- Modify: `app/[lang]/datenschutz/page.tsx:23-27`
- Modify: `app/[lang]/impressum/page.tsx:22-26`

**Interfaces:**
- Consumes: `generateLocalizedMetadata({ title, description, path, locale })` — korrektes Muster steht in `app/[lang]/sources/page.tsx:25-31`.

- [ ] **Step 1: `locale` in allen 4 generateMetadata ergänzen**

In jeder der 4 Dateien im `generateLocalizedMetadata`-Aufruf eine Zeile ergänzen (Beispiel why, die anderen 3 analog — Titel/Description/Path bleiben unverändert):

```typescript
  return generateLocalizedMetadata({
    title: t['why.title'] || 'Feed the Soul. Run the System. | Synthszr',
    description: t['why.description'] || 'Die News Synthese zum Start in den Tag.',
    path: '/why',
    locale: lang as LanguageCode,
  })
```

`LanguageCode` ist in allen 4 Dateien bereits importiert.

- [ ] **Step 2: Build prüfen**

Run: `npm run build`
Expected: erfolgreich.

- [ ] **Step 3: Lokal verifizieren**

Run: `npx next start -p 3199 &` dann:
```bash
curl -s http://localhost:3199/en/archive | grep -o '<link rel="canonical"[^>]*>'
```
Expected: canonical auf `https://www.synthszr.com/en/archive` (NICHT /de/archive). Server killen.

- [ ] **Step 4: Commit**

```bash
git add "app/[lang]/why/page.tsx" "app/[lang]/archive/page.tsx" "app/[lang]/datenschutz/page.tsx" "app/[lang]/impressum/page.tsx"
git commit -m "fix(seo): locale-Param in generateMetadata — Self-Canonicals für en/cs/nds/fr statt de-Fallback"
```

---

### Task 2: Posts-ISR aktivieren (leeres generateStaticParams)

`posts/[slug]` hat `revalidate = 60`, aber ohne `generateStaticParams` behandelt Vercel die Route als voll-dynamisch (`no-store`, jeder Googlebot-Hit = voller SSR-Roundtrip). Exakt dieses Muster wurde in Runde 1 auf `rankings/[slug]` gefixt (Commit 2e2851a).

**Files:**
- Modify: `app/[lang]/posts/[slug]/page.tsx` (direkt nach `export const revalidate = 60`, Zeile ~29)

- [ ] **Step 1: generateStaticParams ergänzen**

```typescript
// Leeres generateStaticParams aktiviert on-demand ISR: ohne diese Funktion
// behandelt Vercel Dynamic-Segment-Routen als voll-dynamisch und ignoriert
// revalidate (gleicher Fix wie rankings/[slug], dort prod-verifiziert).
export async function generateStaticParams() {
  return []
}
```

- [ ] **Step 2: Build prüfen — Klassifizierung MUSS wechseln**

Run: `npm run build 2>&1 | grep -E "posts/\[slug\]"`
Expected: `● /[lang]/posts/[slug]` (SSG/ISR-Marker), nicht mehr `ƒ`. Falls der Build fehlschlägt: abbrechen, BLOCKED melden.

- [ ] **Step 3: Lokal Cache-Verhalten prüfen**

`npx next start -p 3199 &`, einen Post-Slug aus der lokalen Sitemap holen, 2× curlen:
```bash
curl -sI http://localhost:3199/de/posts/<slug> | grep -i 'x-nextjs-cache\|cache-control'
```
Expected: 2. Request `x-nextjs-cache: HIT`, `cache-control: public, s-maxage=...`. Server killen.

- [ ] **Step 4: Commit**

```bash
git add "app/[lang]/posts/[slug]/page.tsx"
git commit -m "fix(seo): leeres generateStaticParams für posts/[slug] — aktiviert on-demand ISR (800+ Posts)"
```

---

### Task 3: Statische Seiten + Companies-Index auf ISR (Anon-Client)

Alle nutzen `createClient` (cookies → dynamic) und meist `force-dynamic`. Der Companies-Index hat sogar schon `revalidate = 7200`, das durch cookies() sabotiert wird.

**Files:**
- Modify: `app/[lang]/why/page.tsx` (Import, `dynamic`-Export Zeile 14, `createClient`-Aufruf)
- Modify: `app/[lang]/archive/page.tsx` (Import, `dynamic`-Export Zeile 4, Aufruf)
- Modify: `app/[lang]/sources/page.tsx` (Import, `dynamic`-Export Zeile 9, Aufruf)
- Modify: `app/[lang]/datenschutz/page.tsx` (Import, `dynamic`-Export Zeile 13, Aufruf)
- Modify: `app/[lang]/impressum/page.tsx` (Import, `dynamic`-Export Zeile 12, Aufruf)
- Modify: `app/[lang]/companies/page.tsx` (Import + Aufruf; `revalidate = 7200` bleibt)

**Interfaces:**
- Consumes: `createAnonClient()` aus `@/lib/supabase/admin` (synchron, env-basiert, kein cookies()).

- [ ] **Step 1: Pro Datei drei Änderungen**

(a) Import tauschen:
```typescript
// Vorher:
import { createClient } from "@/lib/supabase/server"
// Nachher:
import { createAnonClient } from "@/lib/supabase/admin"
```
(b) `export const dynamic = 'force-dynamic'` ersetzen durch (Werte pro Seite):
```typescript
// ISR statt force-dynamic: Anon-Client (kein cookies()) erlaubt Prerender +
// Edge-Cache. Inhalte ändern sich selten; Frische kommt über revalidate.
export const revalidate = 3600
```
— why: 3600 · archive: 300 · sources: 3600 · datenschutz: 86400 · impressum: 86400 · companies/page.tsx: KEIN dynamic-Export vorhanden, nur Import+Aufruf tauschen (revalidate 7200 existiert).

(c) Aufruf tauschen (jede Vorkommnis in der Datei):
```typescript
// Vorher:
const supabase = await createClient()
// Nachher:
const supabase = createAnonClient()
```

- [ ] **Step 2: Build prüfen**

Run: `npm run build 2>&1 | grep -E "/(why|archive|sources|datenschutz|impressum|companies)$"`
Expected: alle als `●` (ISR) mit Revalidate-Angabe, Build fehlerfrei.

- [ ] **Step 3: Lokal Datenvollständigkeit verifizieren (RLS-Gegenprobe)**

`npx next start -p 3199 &`:
```bash
curl -s http://localhost:3199/de/archive | grep -c 'href="/de/posts/'   # erwartet: ~187 (wie vorher)
curl -s http://localhost:3199/de/companies | grep -o '[0-9]* Unternehmen'  # Count > 0
curl -s http://localhost:3199/de/impressum | grep -ci 'impressum'          # > 0, Seite rendert Inhalt
curl -s http://localhost:3199/de/sources | grep -c '<a '                    # Quellen-Links > 0
```
Falls eine Seite plötzlich LEER ist (RLS blockt anon auf einer Tabelle, die vorher per Cookie-Client ging — unwahrscheinlich, anonyme Besucher hatten nie eine Session): Diese eine Seite auf `force-dynamic` + `createClient` zurückstellen und als Concern melden, Rest committen. Server killen.

- [ ] **Step 4: Commit**

```bash
git add "app/[lang]/why/page.tsx" "app/[lang]/archive/page.tsx" "app/[lang]/sources/page.tsx" "app/[lang]/datenschutz/page.tsx" "app/[lang]/impressum/page.tsx" "app/[lang]/companies/page.tsx"
git commit -m "perf(seo): statische Seiten + Companies-Index auf ISR — Anon-Client statt Cookie-Client, Edge-Cache aktiv"
```

---

### Task 4: Company-Detailseiten — ISR + Slug-Decode (105-Firmen-404-Fix)

`companies/[slug]` ist `force-dynamic` mit Cookie-Client. Zusätzlich (pre-existing, Review-Fund aus Runde 1): `params.slug` kommt percent-encoded an (`Hugging%20Face`) und wird nirgends dekodiert → 404 für ~105 Premarket-Firmen mit Leerzeichen im Slug, obwohl sie von der Companies-Liste verlinkt sind.

**Files:**
- Modify: `app/[lang]/companies/[slug]/page.tsx` (Import Zeile 4, `dynamic` Zeile 70, `createClient` Zeilen ~104+146, Slug-Decode an beiden `const { lang, slug } = await params`-Stellen Zeilen ~103+144)

- [ ] **Step 1: Client + Rendering-Modus umstellen**

Import: `createClient` aus `@/lib/supabase/server` → `createAnonClient` aus `@/lib/supabase/admin`. Beide Aufrufe `const supabase = await createClient()` → `const supabase = createAnonClient()`.

Zeile 70 ersetzen:
```typescript
// Vorher:
export const dynamic = 'force-dynamic'
// Nachher:
// On-demand ISR (siehe rankings/[slug]): Anon-Client + leeres
// generateStaticParams → Vercel cached 1h am Edge statt no-store.
export const revalidate = 3600

export async function generateStaticParams() {
  return []
}
```

- [ ] **Step 2: Slug-Decode an beiden params-Stellen**

In `generateMetadata` (Zeile ~103) und in der Page-Komponente (Zeile ~144):
```typescript
// Vorher:
const { lang, slug } = await params
// Nachher:
const { lang, slug: rawSlug } = await params
// Next liefert Dynamic-Params percent-encoded ("Hugging%20Face") — ohne
// Decode 404en alle Company-Slugs mit Leerzeichen (~105 Premarket-Firmen).
const slug = decodeURIComponent(rawSlug)
```
Alle weiteren `slug`-Verwendungen in beiden Funktionen bleiben unverändert (nutzen jetzt den dekodierten Wert). Prüfe per grep, dass es in der Datei keine dritte `await params`-Stelle gibt.

- [ ] **Step 3: Build + lokale Verifikation**

`npm run build` (Route `● /[lang]/companies/[slug]`), dann `npx next start -p 3199 &`:
```bash
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3199/de/companies/Hugging%20Face'   # vorher 404 → jetzt 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3199/de/companies/anthropic            # weiterhin 200
curl -sI http://localhost:3199/de/companies/anthropic | grep -i x-nextjs-cache                    # 2. Hit: HIT
```
Falls `Hugging%20Face` trotz Decode 404 liefert: prüfen, ob die Mentions-Query `.ilike('company_slug', slug)` den Wert mit Leerzeichen findet (DB speichert 'Hugging Face') — Befund im Report dokumentieren. Server killen.

- [ ] **Step 4: Commit**

```bash
git add "app/[lang]/companies/[slug]/page.tsx"
git commit -m "fix(companies): Slug-Decode (104 Firmen mit Leerzeichen 404ten) + on-demand ISR statt force-dynamic"
```

---

### Task 5: Companies-Index — Links im initialen Server-HTML

`CompaniesListClient` bekommt die Firmenliste als Props, rendert aber im `loading`-State nur Skeletons ohne `<a href>` — Google sieht 0 Company-Links. Fix: initialer State = Basis-Daten aus Props (Name, Slug, mentionCount), die Tabelle rendert sofort echte Rows; Ratings/Ticker hydratisieren nachträglich in die bestehenden Rows.

**Files:**
- Modify: `app/companies/companies-list-client.tsx`

**Interfaces:**
- Consumes: `CompanyCardData` aus `components/company-table-row.tsx:12` — `rating/ticker/changePercent/direction` sind optional, Basis-Felder (`name, slug, type, mentionCount`) reichen für einen Row-Render.

- [ ] **Step 1: Initial-State aus Props + Loading-Gate entfernen**

```typescript
// Vorher:
const [enrichedCompanies, setEnrichedCompanies] = useState<CompanyCardData[]>([])
const [loading, setLoading] = useState(true)
// Nachher:
// Basis-Rows sofort aus den Server-Props rendern (SSR-HTML enthält damit
// echte <a href>-Links für Crawler); Ratings/Ticker hydratisieren nachträglich.
const [enrichedCompanies, setEnrichedCompanies] = useState<CompanyCardData[]>(
  () => companies.map((c) => ({ ...c }))
)
const [loading, setLoading] = useState(true)
```

Dann den kompletten `if (loading) { return ( ...Skeleton-Tabelle... ) }`-Block (Zeilen ~250-270) ersatzlos entfernen — die Haupt-Tabelle rendert jetzt immer. Die `loading`-State-Variable NUR entfernen, wenn sie danach nirgends mehr gelesen wird (grep!); wird sie z.B. für Zell-Platzhalter genutzt, bleibt sie.

- [ ] **Step 2: fetchRatings-useEffect prüfen**

Der bestehende `useEffect` (endet ~Zeile 245 mit `setLoading(false)`) setzt `setEnrichedCompanies` mit angereicherten Daten — das funktioniert unverändert weiter (ersetzt die Basis-Rows durch angereicherte). Nichts ändern, nur verifizieren, dass er `companies` als Basis nimmt und nicht `enrichedCompanies` liest (sonst Endlosschleife).

- [ ] **Step 3: Build + SSR-Verifikation**

`npm run build`, `npx next start -p 3199 &`:
```bash
curl -s http://localhost:3199/de/companies | grep -o 'href="/de/companies/[^"]*"' | sort -u | wc -l
```
Expected: >100 (vorher 0). Kurz im Headless-Chrome oder per zweitem curl prüfen, dass kein Hydration-Fehler geloggt wird (`npx next start`-Konsole beobachten). Server killen.

- [ ] **Step 4: Commit**

```bash
git add app/companies/companies-list-client.tsx
git commit -m "fix(seo): Companies-Tabelle rendert Links server-seitig — Ratings hydratisieren nachträglich"
```

---

### Task 6: Company-Slugs in die Sitemap

**Files:**
- Modify: `app/sitemap.ts` (vor `return sitemap`, nach dem Rankings-Block)

**Interfaces:**
- Consumes: bestehende `supabase`-Instanz (seit Runde-2-Task ist das `createAnonClient` — falls sitemap.ts noch `createAnonClient` aus dem Runde-1-Fix nutzt: ja, tut es), `BASE_URL`, `activeLocales`, `DEFAULT_LOCALE`.

- [ ] **Step 1: Companies-Block ergänzen**

Vor `return sitemap` einfügen:

```typescript
  // Company-Detailseiten: distinct Slugs aus den Mentions veröffentlichter
  // Posts (gleiche Quelle wie der /companies-Index). Lowercase-normalisiert —
  // die Seite ist case-insensitiv (ilike), kanonisch ist die Kleinschreibung.
  try {
    const { data: companyMentions } = await supabase
      .from('post_company_mentions')
      .select('company_slug, post:generated_posts!inner(status)')
      .eq('post.status', 'published')
    const companySlugs = [...new Set(
      (companyMentions ?? []).map((m) => (m.company_slug as string).toLowerCase())
    )]
    for (const slug of companySlugs) {
      const alternates: Record<string, string> = {
        'x-default': `${BASE_URL}/${DEFAULT_LOCALE}/companies/${encodeURIComponent(slug)}`,
      }
      for (const locale of activeLocales) {
        alternates[locale] = `${BASE_URL}/${locale}/companies/${encodeURIComponent(slug)}`
      }
      for (const locale of activeLocales) {
        sitemap.push({
          url: `${BASE_URL}/${locale}/companies/${encodeURIComponent(slug)}`,
          changeFrequency: 'weekly',
          priority: locale === DEFAULT_LOCALE ? 0.6 : 0.4,
          alternates: { languages: alternates },
        })
      }
    }
  } catch (e) {
    console.error('sitemap: companies section failed', e)
  }
```

- [ ] **Step 2: Build + lokale Verifikation**

`npm run build`, `npx next start -p 3199 &`:
```bash
curl -s http://localhost:3199/sitemap.xml | grep -c '/companies/'
```
Expected: > 500 (~120 Slugs × 5 Locales, plus die 5 Index-Einträge). Stichprobe: eine URL mit encodetem Leerzeichen (`hugging%20face`) muss enthalten sein und (nach Task 4) 200 liefern. Server killen.

- [ ] **Step 3: Commit**

```bash
git add app/sitemap.ts
git commit -m "feat(seo): Company-Detailseiten in die Sitemap (~120 Slugs x Locales, lowercase-kanonisch)"
```

---

### Task 7: Middleware — DB-Call raus aus dem Request-Pfad

`getActiveLanguages()` macht heute (bei kaltem 5-Min-Cache pro Edge-Isolate) einen blockierenden Supabase-Roundtrip vor jeder Seiten-Response — site-weiter TTFB-Aufschlag.

**Files:**
- Modify: `middleware.ts` (Cache-Konstanten Zeilen ~24-27, `getActiveLanguages`-Funktion, Aufrufstelle Zeile ~213, Middleware-Signatur)

- [ ] **Step 1: Nicht-blockierendes SWR-Muster**

Die Cache-Logik umbauen — Kernpunkte, an die bestehende `getActiveLanguages`-Implementierung angepasst:

```typescript
import { PUBLIC_LOCALES } from '@/lib/i18n/config'
import type { NextFetchEvent } from 'next/server'

// Aktive Sprachen: nie den Request blockieren. Start-Wert = PUBLIC_LOCALES
// (Code-Wahrheit, identisch zu Sitemap/hreflang); DB-Refresh läuft im
// Hintergrund via event.waitUntil. Stale-Werte sind hier völlig ok —
// Sprachaktivierungen passieren quasi nie.
let activeLanguagesCache: Set<string> = new Set(PUBLIC_LOCALES)
let cacheTimestamp = 0
const CACHE_TTL = 60 * 60 * 1000 // 1h

async function refreshActiveLanguages(): Promise<void> {
  try {
    // bestehende Fetch-Logik aus getActiveLanguages hierher verschieben
    // (Supabase-REST-Call auf languages, is_active=true)
    // bei Erfolg: activeLanguagesCache = new Set(codes); cacheTimestamp = Date.now()
  } catch {
    // stale Wert behalten — kein Throw in der Middleware
  }
}
```

An der Aufrufstelle (Zeile ~213):
```typescript
// Vorher:
const activeLanguages = await getActiveLanguages()
// Nachher:
if (Date.now() - cacheTimestamp > CACHE_TTL) {
  event.waitUntil(refreshActiveLanguages())
}
const activeLanguages = activeLanguagesCache
```

Middleware-Signatur um den Event-Parameter erweitern: `export async function middleware(request: NextRequest, event: NextFetchEvent)`. Die alte `getActiveLanguages`-Funktion entfernen bzw. zu `refreshActiveLanguages` umbauen (ihre Fetch-Logik 1:1 übernehmen — lies sie vor dem Umbau vollständig).

- [ ] **Step 2: Build + Verhaltenscheck**

`npm run build`, dann `npx next start -p 3199 &`:
```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3199/de           # 200
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3199/xx/archive  # 301 → /de/archive (inaktive Sprache)
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3199/            # 307 → /de (bzw. Geo-Locale)
```
Server killen.

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "perf(middleware): Sprachen-Cache nicht-blockierend (waitUntil-Refresh, PUBLIC_LOCALES-Start) — kein DB-Call im Request-Pfad"
```

---

### Task 8: Artikel-Body server-rendern (größter Hebel — 800+ Posts)

Der TipTap-Content wird heute zu 100 % client-gerendert; das Server-HTML enthält nur Headline+Bullets. Fix: Server-Renderer via `generateHTML` (TipTap 3, läuft in Node — Beweis: `lib/utils/markdown-to-tiptap.ts:42`), als statisches `<div>` VOR der Suspense-Boundary; der Client-Editor entfernt es nach Hydration.

**Files:**
- Create: `lib/tiptap/render-static-html.ts`
- Test: `tests/lib/render-static-html.test.ts`
- Modify: `components/post-content-view.tsx` (wird Hybrid: Server-HTML + Client-Enhancer)
- Modify: `components/tiptap-renderer/tiptap-renderer.tsx` (neues optionales Prop `ssrFallbackId`, Cleanup nach Editor-Init)
- Modify: `app/[lang]/why/page.tsx`, `app/[lang]/impressum/page.tsx`, `app/[lang]/datenschutz/page.tsx` (nutzen TiptapRenderer direkt — auf PostContentView-Muster bzw. direktes Server-HTML umstellen)

**Interfaces:**
- Produces: `renderStaticArticleHtml(content: Record<string, unknown> | string): string` — TipTap-JSON (Objekt oder JSON-String) → sanitisiertes HTML; `{Company}`-Direktiven-Tags entfernt.
- Consumes: Extensions identisch zum Client-Editor (`tiptap-renderer.tsx`: StarterKit, Link, HeadingWithQueueId) — MUSS deckungsgleich sein, sonst wirft generateHTML bei unbekannten Node-Typen.

- [ ] **Step 1: Failing Test schreiben**

```typescript
// tests/lib/render-static-html.test.ts
import { describe, it, expect } from 'vitest'
import { renderStaticArticleHtml } from '@/lib/tiptap/render-static-html'

const doc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Testüberschrift' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Ein Absatz über {Palantir} und KI.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Link: ', }, { type: 'text', text: 'Quelle', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }] },
  ],
}

describe('renderStaticArticleHtml', () => {
  it('rendert Headings, Absätze und Links als HTML', () => {
    const html = renderStaticArticleHtml(doc)
    expect(html).toContain('<h2')
    expect(html).toContain('Testüberschrift')
    expect(html).toContain('href="https://example.com"')
  })

  it('entfernt {Company}-Direktiven-Tags aus dem Text', () => {
    const html = renderStaticArticleHtml(doc)
    expect(html).not.toContain('{Palantir}')
    expect(html).toContain('und KI')
  })

  it('akzeptiert JSON-Strings und liefert bei Müll leeren String statt zu werfen', () => {
    expect(renderStaticArticleHtml(JSON.stringify(doc))).toContain('Testüberschrift')
    expect(renderStaticArticleHtml('kein json')).toBe('')
    expect(renderStaticArticleHtml({} as Record<string, unknown>)).toBe('')
  })
})
```

- [ ] **Step 2: Test laufen lassen — FAIL**

Run: `npx vitest run tests/lib/render-static-html.test.ts`
Expected: FAIL (Modul existiert nicht).

- [ ] **Step 3: Renderer implementieren**

```typescript
// lib/tiptap/render-static-html.ts
import { generateHTML } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { HeadingWithQueueId } from '@/lib/tiptap/heading-with-queue-id'

/** Rendert TipTap-JSON serverseitig zu statischem HTML — der crawlbare
 *  Fallback für den client-only TiptapRenderer. Extensions MÜSSEN mit
 *  tiptap-renderer.tsx übereinstimmen, sonst wirft generateHTML.
 *  {Company}-Direktiven werden gestript (macht client-seitig
 *  hideExplicitCompanyTags). Fehler → leerer String, nie werfen. */
export function renderStaticArticleHtml(content: Record<string, unknown> | string): string {
  try {
    const json = typeof content === 'string' ? JSON.parse(content) : content
    if (!json || typeof json !== 'object' || !('type' in json)) return ''
    const html = generateHTML(json as Parameters<typeof generateHTML>[0], [
      StarterKit.configure({ heading: false }),
      HeadingWithQueueId,
      Link.configure({ openOnClick: false }),
    ])
    // {Company}-Tags entfernen (gleiche Semantik wie hideExplicitCompanyTags)
    return html.replace(/\{[^{}<>\n]{1,80}\}/g, '')
  } catch {
    return ''
  }
}
```

WICHTIG: Vor dem Schreiben `components/tiptap-renderer/tiptap-renderer.tsx` (useEditor-Extensions, Zeilen ~137-160) UND `lib/utils/markdown-to-tiptap.ts` lesen und die Extension-Liste exakt spiegeln (inkl. `StarterKit.configure({ heading: false })` falls der Client HeadingWithQueueId als Heading-Ersatz nutzt — prüfen!). Wenn der Client abweichend konfiguriert, die Client-Konfiguration übernehmen.

- [ ] **Step 4: Test laufen lassen — PASS**

Run: `npx vitest run tests/lib/render-static-html.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: PostContentView zum Hybrid machen**

```tsx
// components/post-content-view.tsx  (komplett ersetzen)
import { TiptapRenderer } from "@/components/tiptap-renderer"
import { renderStaticArticleHtml } from "@/lib/tiptap/render-static-html"

interface PostContentViewProps {
  content: Record<string, unknown>
  postId?: string
  queueItemIds?: string[]
  originalContent?: Record<string, unknown>
}

/**
 * Hybrid-Renderer: server-gerendertes statisches HTML (crawlbar, sofort
 * lesbar) + TiptapRenderer, der nach Hydration übernimmt (Badges,
 * Produkt-Links, Thumbnails) und den statischen Block entfernt.
 * Server Component — kein 'use client'.
 */
export function PostContentView({ content, postId, queueItemIds, originalContent }: PostContentViewProps) {
  const staticHtml = renderStaticArticleHtml(content)
  const ssrId = postId ? `post-ssr-${postId}` : `post-ssr-static`
  return (
    <>
      {staticHtml && (
        <div
          id={ssrId}
          // Gleiche Typo-Klassen wie der Editor (tiptap-renderer.tsx editorProps)
          className="prose prose-neutral max-w-none font-serif text-base md:text-sm leading-relaxed tiptap-content"
          dangerouslySetInnerHTML={{ __html: staticHtml }}
        />
      )}
      <TiptapRenderer
        content={content}
        postId={postId}
        queueItemIds={queueItemIds}
        originalContent={originalContent}
        ssrFallbackId={staticHtml ? ssrId : undefined}
      />
    </>
  )
}
```

Hinweis: `renderStaticArticleHtml` erzeugt vertrauenswürdiges HTML aus eigenem CMS-Content (TipTap-JSON aus eigener DB — gleiche Vertrauensstufe wie der Client-Editor, der denselben Content rendert). XSS-Angriffsfläche ändert sich nicht.

- [ ] **Step 6: TiptapRenderer — SSR-Block nach Hydration entfernen**

In `components/tiptap-renderer/tiptap-renderer.tsx`:
(a) Props-Typ um `ssrFallbackId?: string` erweitern (in `components/tiptap-renderer/types.ts`, dort liegt `TiptapRendererProps`).
(b) In der Komponente einen Effect ergänzen, der greift, sobald der Editor gerendert hat (es gibt einen bestehenden `editorReady`/Editor-Init-Punkt — Zeile ~198 `if (!editorReady ...)`; denselben State nutzen):

```typescript
  // SSR-Fallback entfernen, sobald der interaktive Editor steht — sonst
  // stünde der Artikel doppelt im DOM.
  useEffect(() => {
    if (!editorReady || !ssrFallbackId) return
    document.getElementById(ssrFallbackId)?.remove()
  }, [editorReady, ssrFallbackId])
```
(Existiert kein `editorReady`-State, den tatsächlichen Ready-Mechanismus der Datei verwenden — vor dem Edit die Datei lesen.)

- [ ] **Step 7: why/impressum/datenschutz umstellen**

Diese 3 Seiten rendern `<TiptapRenderer content={...} />` direkt (ohne postId/Badges-Bedarf). Dort jeweils den `TiptapRenderer`-Aufruf durch `PostContentView` ersetzen:
```tsx
// Vorher (Beispiel):
<TiptapRenderer content={page.content} />
// Nachher:
<PostContentView content={page.content as Record<string, unknown>} />
```
Import anpassen (`PostContentView` aus `@/components/post-content-view`; `TiptapRenderer`-Import entfernen, wenn ungenutzt). Exakte Stellen per grep `TiptapRenderer` in den 3 Dateien finden.

- [ ] **Step 8: Alle Tests + Build**

Run: `npx vitest run tests/lib/ && npm run build`
Expected: alle grün, Build ok.

- [ ] **Step 9: End-to-End-Verifikation (der eigentliche Beweis)**

`npx next start -p 3199 &`; einen Post-Slug wählen, dann:
```bash
# Volltext im Server-HTML? Wortzahl im SSR-Body-Div:
curl -s http://localhost:3199/de/posts/<slug> | python3 -c "
import sys, re, html
doc = sys.stdin.read()
m = re.search(r'id=\"post-ssr-[^\"]*\"[^>]*>(.*?)</div>', doc, re.S)
text = html.unescape(re.sub(r'<[^>]+>', ' ', m.group(1))) if m else ''
print('SSR-Body-Woerter:', len(text.split()))
"
# Erwartet: > 300 (vorher: Body nicht vorhanden)
# Kein {Company}-Leak:
curl -s http://localhost:3199/de/posts/<slug> | grep -o 'post-ssr[^<]*{[A-Za-z]' | head -3   # erwartet: leer
# Homepage-Featured-Article hat jetzt auch Volltext:
curl -s http://localhost:3199/de | grep -c 'post-ssr-'   # ≥ 1
```
Zusätzlich im Browser/Headless prüfen: Seite öffnen, nach Hydration darf der Artikel NICHT doppelt sichtbar sein (SSR-Div wird entfernt) und die Vote-Badges/Produkt-Links müssen weiter funktionieren. Server killen.

- [ ] **Step 10: Commit**

```bash
git add lib/tiptap/render-static-html.ts tests/lib/render-static-html.test.ts components/post-content-view.tsx components/tiptap-renderer/tiptap-renderer.tsx components/tiptap-renderer/types.ts "app/[lang]/why/page.tsx" "app/[lang]/impressum/page.tsx" "app/[lang]/datenschutz/page.tsx"
git commit -m "feat(seo): Artikel-Volltext server-gerendert — statisches TipTap-HTML als crawlbarer Fallback, Editor ersetzt nach Hydration"
```

---

### Task 9: PodcastEpisode/AudioObject-Schema auf Posts

`apple_episode_url` wird serverseitig geladen (posts-page ~Zeile 263), aber kein Schema emittiert.

**Files:**
- Modify: `app/[lang]/posts/[slug]/page.tsx` (bei den bestehenden LD-Objekten, ~Zeile 309ff)

- [ ] **Step 1: Schema ergänzen**

Nach `breadcrumbLd` (die Variablen `post`, `appleEpisodeUrl`, `locale`, `slug`, `SITE_URL` existieren dort):

```typescript
  // Podcast-Folge als strukturierte Daten — nur wenn eine Episode existiert.
  const podcastLd = appleEpisodeUrl
    ? {
        '@context': 'https://schema.org',
        '@type': 'PodcastEpisode',
        name: post.title,
        url: appleEpisodeUrl,
        datePublished: post.created_at,
        partOfSeries: { '@type': 'PodcastSeries', name: 'Synthszr' },
        associatedMedia: { '@type': 'MediaObject', contentUrl: appleEpisodeUrl },
      }
    : null
```

Im JSX bei den beiden bestehenden `<script type="application/ld+json">`-Tags ergänzen:
```tsx
      {podcastLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(podcastLd) }} />
      )}
```
(`safeJsonLd` ist bereits importiert.) Falls `appleEpisodeUrl` erst NACH den LD-Definitionen geladen wird: die podcastLd-Definition entsprechend nach unten ziehen — Reihenfolge in der Datei prüfen.

- [ ] **Step 2: Build + Verifikation + Commit**

`npm run build`; lokal einen Post MIT Podcast finden (`grep`/DB oder mehrere Posts curlen) und `grep -c PodcastEpisode` → 1; ein Post ohne Podcast → 0.

```bash
git add "app/[lang]/posts/[slug]/page.tsx"
git commit -m "feat(seo): PodcastEpisode-JSON-LD auf Posts mit Podcast-Folge"
```

---

### Task 10: Cover-Bilder über Next Image Optimization (LCP)

`next.config.mjs` hat `images: { unoptimized: true }` — das LCP-Bild ist ein rohes 1408×1408-PNG von Vercel Blob. Fix: Optimizer aktivieren und die zwei Cover-Stellen umstellen. Art-Direction (separates Desktop-Cover) via `getImageProps`.

**Files:**
- Modify: `next.config.mjs:4-6`
- Modify: `components/featured-article.tsx` (Cover-`<picture>`/`<img>`, ~Zeile 69-77)
- Modify: `app/[lang]/posts/[slug]/page.tsx` (Cover-`<img>` ~Zeile 384-394 und `ReactDOM.preload` ~Zeile 340)

- [ ] **Step 1: Optimizer aktivieren**

```javascript
  images: {
    // Next Image Optimization aktiv (WebP/AVIF on-the-fly). Quellen: Cover
    // auf Vercel Blob + Google-Favicon-Service.
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: 'lbrzdn804nhy3kox.public.blob.vercel-storage.com' },
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
```
(`unoptimized: true` entfernen.) Prüfe per grep, welche Hosts in `post_images.image_url` real vorkommen (Blob vs. Supabase-Storage) — fehlende Hosts zu remotePatterns hinzufügen; die zwei bestehenden `next/image`-Nutzer (`bloom-language-switcher`, `article-thumbnail`) auf lokale/erlaubte Quellen prüfen.

- [ ] **Step 2: Cover-Render umstellen (beide Stellen)**

Vor dem Edit die exakte aktuelle Struktur lesen (mobile `cover_image_url` + optionales `desktop_cover_url` in einem `<picture>`). Muster mit `getImageProps` (Art-Direction, Next-offizieller Weg):

```tsx
import { getImageProps } from 'next/image'

// im Render:
const common = { alt: title, sizes: '(max-width: 704px) 100vw, 704px', quality: 80 }
const desktop = desktopCoverUrl
  ? getImageProps({ ...common, src: desktopCoverUrl, width: 1408, height: 768 })
  : null
const mobile = getImageProps({ ...common, src: coverImageUrl, width: 1408, height: 1408, priority: true })

<picture>
  {desktop && <source media="(min-width: 768px)" srcSet={desktop.props.srcSet} sizes={desktop.props.sizes} />}
  {/* eslint-disable-next-line @next/next/no-img-element -- getImageProps-Pattern */}
  <img {...mobile.props} className={/* bestehende Klassen übernehmen */} />
</picture>
```
Die realen width/height/media-Werte aus dem Bestandscode übernehmen (nicht raten — Datei lesen). `loading`/`fetchPriority` liefert `priority: true` automatisch.

- [ ] **Step 3: Preload anpassen**

`ReactDOM.preload(post.cover_image_url, …)` preloadet jetzt die falsche (Original-)URL. Ersetzen durch responsive Preload mit den optimierten Props:
```typescript
  if (post.cover_image_url) {
    const { props: p } = getImageProps({ alt: '', src: post.cover_image_url, width: 1408, height: 1408, sizes: '(max-width: 704px) 100vw, 704px' })
    ReactDOM.preload(p.src, { as: 'image', imageSrcSet: p.srcSet, imageSizes: p.sizes, fetchPriority: 'high' })
  }
```

- [ ] **Step 4: Build + visuelle Verifikation (Pflicht)**

`npm run build`, `npx next start -p 3199 &`:
```bash
curl -s http://localhost:3199/de | grep -o 'src="/_next/image[^"]*"' | head -2   # Optimizer-URLs aktiv
curl -sI "http://localhost:3199$(curl -s http://localhost:3199/de | grep -o '/_next/image[^"]*' | head -1 | sed 's/&amp;/\&/g')" | grep -i content-type
# erwartet: image/webp oder image/avif
```
Headless-Chrome-Check (CDP wie in Runde 1): Homepage + eine Post-Seite bei 375px und 1280px — Cover sichtbar, korrekt zugeschnitten, kein Layout-Sprung. Bei visueller Regression: BLOCKED melden statt raten. Server killen.

- [ ] **Step 5: Commit**

```bash
git add next.config.mjs components/featured-article.tsx "app/[lang]/posts/[slug]/page.tsx"
git commit -m "perf(seo): Cover über Next Image Optimization (AVIF/WebP statt 1408px-PNG) inkl. responsive Preload"
```

---

### Task 11: Breadcrumb- und Organization-Schema auf Company-Seiten

**Files:**
- Modify: `app/[lang]/companies/[slug]/page.tsx` (Company-Detail: BreadcrumbList + Organization)
- Modify: `app/[lang]/companies/page.tsx` (Index: BreadcrumbList)

- [ ] **Step 1: Company-Detail**

In der Page-Komponente (nach dem Daten-Load; `companyName`-Variable per Read identifizieren):

```typescript
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Synthszr', item: `${SITE_URL}/${lang}` },
      { '@type': 'ListItem', position: 2, name: 'Companies', item: `${SITE_URL}/${lang}/companies` },
      { '@type': 'ListItem', position: 3, name: companyName },
    ],
  }
```
Import `SITE_URL, safeJsonLd` aus `@/lib/seo/site`; `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbLd) }} />` am Anfang von `<main>`. KEIN Organization-Schema mit erfundenen Feldern — nur wenn die Seite echte Daten hat (Name reicht: `{'@context':'https://schema.org','@type':'Organization','name': companyName}` ist zulässig, mehr nicht).

- [ ] **Step 2: Companies-Index analog**

BreadcrumbList mit 2 Ebenen (Synthszr → Companies, Position 2 ohne item).

- [ ] **Step 3: Build + Commit**

```bash
npm run build
git add "app/[lang]/companies/[slug]/page.tsx" "app/[lang]/companies/page.tsx"
git commit -m "feat(seo): BreadcrumbList + Organization-JSON-LD auf Companies-Seiten"
```

---

### Task 12: Deploy + Prod-Verifikation

- [ ] **Step 1: Push**

```bash
git push origin main
```
Deploy abwarten (poll: `curl -s https://www.synthszr.com/de/companies | grep -c 'href="/de/companies/'` bis > 0 — max. 15 min).

- [ ] **Step 2: Prod-Checkliste (gedrosselt, `sleep 2` zwischen allen Requests!)**

```bash
B=https://www.synthszr.com
# 1. Canonical-Fix
curl -s $B/en/archive | grep -o '<link rel="canonical"[^>]*>'          # → /en/archive
# 2. Posts-ISR (2. Request)
curl -sI $B/de/posts/<aktueller-slug> | grep -i x-vercel-cache          # 2. Hit: HIT/STALE
# 3. Companies-Index SSR + ISR
curl -s $B/de/companies | grep -o 'href="/de/companies/[^"]*"' | sort -u | wc -l   # > 100
# 4. Company mit Leerzeichen
curl -s -o /dev/null -w '%{http_code}\n' "$B/de/companies/hugging%20face"           # 200
# 5. Sitemap
curl -s $B/sitemap.xml | grep -c '/companies/'                          # > 500
# 6. Artikel-Volltext
curl -s $B/de/posts/<slug> | grep -c 'post-ssr-'                        # ≥ 1
# 7. Podcast-Schema (Post mit Episode)
curl -s $B/de/posts/<podcast-slug> | grep -c 'PodcastEpisode'           # 1
# 8. Cover optimiert
curl -s $B/de | grep -c '/_next/image'                                  # ≥ 1
# 9. Statische Seiten gecacht (2. Request)
curl -sI $B/de/impressum | grep -i x-vercel-cache                       # HIT/STALE
```

- [ ] **Step 3: GSC (manuell, User)**

Sitemap neu einreichen (jetzt inkl. Companies); URL-Prüfung für einen Post → „Indexierung beantragen" (bestätigt den Volltext-Fix).
