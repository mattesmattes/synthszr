# SEO-Audit-Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alle 46 verifizierten Befunde des SEO-Audits vom 2026-07-03 beheben — Fokus: Sichtbarkeit der Rankings-Sektion (`/de/rankings`), Duplicate-Content-Kanonisierung, Crawl-Budget und interne Verlinkung.

**Architecture:** Next.js 16 App Router auf Vercel. Zentrale Bausteine: (1) der bereits existierende Helper `generateLocalizedMetadata()` in `lib/i18n/metadata.ts` wird auf die Rankings-Sektion ausgeweitet (canonical + hreflang + OG in einem), (2) `app/sitemap.ts` bekommt Rankings-URLs, (3) Produkt-Detailseiten wechseln von `force-dynamic` auf ISR, (4) neue server-gerenderte Link-Module (Related Products, Vendor Products, Post-Produkt-Box) schließen die Orphan-Lücke.

**Tech Stack:** Next.js 16, TypeScript, Supabase (PostgREST), Vitest, Vercel Blob, sharp.

## Global Constraints

- **Deploy:** Alle Änderungen direkt auf `main` committen (User-Präferenz, kein Feature-Branch). Vercel deployt automatisch.
- **Verifikation:** Nach Deploy immer gegen Production testen: `curl https://www.synthszr.com/...` (User-Präferenz). Lokal nur `npm run build` + Vitest.
- **DB-Zugriff:** Data-Fixes/Inserts via Supabase MCP `execute_sql` oder Supabase CLI — Projekt-Ref aus `supabase/.temp` bzw. `SUPABASE_URL`. Keine Schema-Migrationen nötig (nur DML).
- **Keine neuen npm-Dependencies** — `sharp` und `@vercel/blob` sind vorhanden.
- **UI-Texte:** Deutsch als Default in `defaultTranslations` (`lib/i18n/get-translations.ts`), andere Sprachen als `ui_translations`-DB-Rows.
- **Kanonischer Host ist überall `https://www.synthszr.com`** (www, nicht apex).
- **Kein erfundenes Schema-Markup:** kein `aggregateRating`/`offers` in JSON-LD — wir haben keine Reviews/Preise als strukturierte Daten.
- **Tests:** `npx vitest run tests/lib/<datei>` für neue pure Functions. Seiten-/Metadata-Änderungen werden über `npm run build` + Prod-curl (Task 21) verifiziert.
- **Surgical changes:** Bestehenden Stil (deutsche Code-Kommentare, Tailwind-Klassen) beibehalten, keine Nachbar-Refactorings.

## Bewusst NICHT in diesem Plan (mit Begründung)

- **`<html lang>` server-seitig korrekt (Findings #15/#24):** Erfordert Route-Group-Restructure (eigene Root-Layouts für `[lang]` vs. `admin`/`login`/Legacy-Routen), da das Root-Layout keine `params` des `[lang]`-Segments bekommt und `headers()` das ISR-Caching aller Seiten zerstören würde. Client-Korrektur existiert bereits (`app/[lang]/layout.tsx:26`), Google ignoriert `html lang` weitgehend. → Separates Projekt, wenn gewünscht.
- **Site-weite `next/image`-Migration (Finding #28, Teil 2):** Task 20 fixt den konkreten Beleg (233-KB-Rankings-Banner). Eine Migration aller `<img>` ist ein eigenes Projekt.
- **4 verworfene Befunde** (getProductDetail-Doppel-Call, RSC-Payload-Größe, Wordmark-CLS): vom Verifizierer widerlegt, kein Fix.

---

### Task 1: Zentrale SITE_URL-Konstante

**Files:**
- Create: `lib/seo/site.ts`
- Modify: `lib/i18n/metadata.ts:5`

**Interfaces:**
- Produces: `SITE_URL: string` (Export aus `lib/seo/site.ts`) — wird von Tasks 3, 10, 11, 13, 19 konsumiert.

- [ ] **Step 1: Konstante anlegen**

```typescript
// lib/seo/site.ts
/** Kanonischer Host der Site (www, nie apex) — einzige Quelle für absolute URLs
 *  in Metadata, JSON-LD, Sitemap und Feeds. */
export const SITE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.synthszr.com'
```

- [ ] **Step 2: `lib/i18n/metadata.ts` auf die Konstante umstellen**

Zeile 5 ersetzen:

```typescript
// Vorher:
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.synthszr.com'
// Nachher:
import { SITE_URL } from '@/lib/seo/site'
const BASE_URL = SITE_URL
```

(Der lokale Alias `BASE_URL` bleibt, damit die restliche Datei unverändert bleibt.)

- [ ] **Step 3: Build prüfen**

Run: `npm run build`
Expected: Build erfolgreich, keine Type-Errors.

- [ ] **Step 4: Commit**

```bash
git add lib/seo/site.ts lib/i18n/metadata.ts
git commit -m "refactor(seo): zentrale SITE_URL-Konstante für kanonischen Host"
```

---

### Task 2: Root-Layout — OG/Twitter auf www + og-image-v2, Organization-JSON-LD

Fixt Findings #13 (teilw.), #20 (teilw.), #37, #39 (Organization), #42.

**Files:**
- Modify: `app/layout.tsx:35-57` (openGraph/twitter-Block) und `app/layout.tsx:74-80` (body)

- [ ] **Step 1: OG/Twitter-URLs korrigieren**

In `app/layout.tsx` den `openGraph`- und `twitter`-Block ersetzen (Zeilen 35–56). `metadataBase` (Zeile 23) bleibt:

```typescript
  openGraph: {
    title: 'Synthszr — AI is about Synthesis not Efficiency.',
    description: 'Exploring the intersection of business, design and technology in the age of AI',
    url: 'https://www.synthszr.com',
    siteName: 'Synthszr',
    images: [
      {
        url: 'https://www.synthszr.com/og-image-v2.jpg',
        width: 1200,
        height: 630,
        alt: 'Synthszr — AI is about Synthesis not Efficiency.',
      },
    ],
    locale: 'de_DE',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Synthszr — AI is about Synthesis not Efficiency.',
    description: 'Exploring the intersection of business, design and technology in the age of AI',
    images: ['https://www.synthszr.com/og-image-v2.jpg'],
  },
```

- [ ] **Step 2: Organization-JSON-LD site-weit ergänzen**

In `app/layout.tsx` vor `export default function RootLayout` einfügen:

```typescript
// Site-weite Organization-Entity — Grundlage für Publisher-Verknüpfung in
// Article-/Breadcrumb-Schemas (Posts) und Brand-Erkennung.
const orgLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Synthszr',
  url: 'https://www.synthszr.com',
  logo: 'https://www.synthszr.com/apple-touch-icon.png',
  sameAs: ['https://www.linkedin.com/in/mattes/'],
}
```

Im `<body>` (nach `{children}`, vor `<PageTracker />`) einfügen:

```tsx
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgLd) }}
        />
```

- [ ] **Step 3: Build prüfen**

Run: `npm run build`
Expected: Build erfolgreich.

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx
git commit -m "fix(seo): Root-OG auf www + og-image-v2, Organization-JSON-LD site-weit"
```

---

### Task 3: Homepage-CSR-Bailout beheben

Fixt Findings #9, #19 (+ WebSite-LD-Host aus #20). Ursache: `app/[lang]/page.tsx` wickelt die **gesamte** Seite in `<Suspense fallback={null}>`; der einzige unwrapped `useSearchParams()`-Konsument im Home-Baum ist `TiptapRenderer` (via `FeaturedArticle:135` → `PostContentView`). `AudioPlayer` (featured-article.tsx:100) und beide Language-Switcher sind bereits einzeln gewrappt.

**Files:**
- Modify: `app/[lang]/page.tsx:210-216, 218-219, 332` 
- Modify: `components/featured-article.tsx:135`

- [ ] **Step 1: Seiten-weite Suspense-Boundary entfernen**

In `app/[lang]/page.tsx`:

Zeile 218–219, aus:
```tsx
  return (
    <Suspense fallback={null}>
    <div className="min-h-screen bg-background text-foreground">
```
wird:
```tsx
  return (
    <div className="min-h-screen bg-background text-foreground">
```

Zeile 331–333 (Ende), aus:
```tsx
    </div>
    </Suspense>
  )
```
wird:
```tsx
    </div>
  )
```

- [ ] **Step 2: WebSite-JSON-LD-Host fixen (gleiche Datei)**

Zeile 210–216, `url` auf www ändern:

```typescript
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Synthszr',
    url: 'https://www.synthszr.com',
    description: t['meta.description'] || 'Exploring the intersection of business, design and technology in the age of AI',
  }
```

- [ ] **Step 3: PostContentView im FeaturedArticle in eigene Boundary wickeln**

In `components/featured-article.tsx` Zeile 135 (`Suspense` ist bereits importiert):

```tsx
        <Suspense fallback={null}>
          <PostContentView content={content} postId={postId} queueItemIds={queueItemIds} />
        </Suspense>
```

- [ ] **Step 4: Build prüfen — DAS ist der kritische Check**

Run: `npm run build`
Expected: Build erfolgreich. Kein Error `useSearchParams() should be wrapped in a suspense boundary`. In der Build-Ausgabe erscheint `/[lang]` weiterhin mit Revalidate (ISR), nicht als reine Client-Seite.

- [ ] **Step 5: Commit**

```bash
git add "app/[lang]/page.tsx" components/featured-article.tsx
git commit -m "fix(seo): Homepage-CSR-Bailout — Suspense eng um TiptapRenderer statt um die ganze Seite"
```

---

### Task 4: robots konsolidieren — /_next freigeben, /newsletter-Disallow raus

Fixt Findings #27 + Voraussetzung für #12 (robots-Disallow würde das noindex aus Task 5 unsichtbar machen — Google muss die Seite crawlen dürfen, um noindex zu sehen). Es existieren **zwei** robots-Quellen (`public/robots.txt` UND `app/robots.ts`) — `public/` wird konsolidiert gelöscht.

**Files:**
- Modify: `app/robots.ts`
- Delete: `public/robots.txt`

- [ ] **Step 1: `app/robots.ts` bereinigen**

```typescript
import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Kein /_next/-Disallow: Googlebot braucht CSS/JS zum Rendern und
        // /_next/image für Google Images. Kein /newsletter/-Disallow: die
        // Seiten tragen noindex (Layout-Metadata) — das Signal wirkt nur,
        // wenn Google die Seite crawlen darf.
        disallow: ['/admin/', '/api/', '/login'],
      },
    ],
    sitemap: 'https://www.synthszr.com/sitemap.xml',
  }
}
```

- [ ] **Step 2: Doppelte Quelle löschen**

```bash
git rm public/robots.txt
```

- [ ] **Step 3: Build prüfen**

Run: `npm run build`
Expected: Build erfolgreich (kein Konflikt public-file vs. metadata-route mehr).

- [ ] **Step 4: Commit**

```bash
git add app/robots.ts
git commit -m "fix(seo): robots — /_next und /newsletter freigeben, public/robots.txt-Duplikat entfernt"
```

---

### Task 5: Newsletter-Seiten auf noindex

Fixt Finding #12. Es gibt zwei Newsletter-Routen-Bäume: `app/[lang]/newsletter/` und (Legacy) `app/newsletter/`.

**Files:**
- Modify: `app/[lang]/newsletter/layout.tsx`
- Modify: `app/newsletter/layout.tsx` (falls vorhanden — sonst anlegen)

- [ ] **Step 1: noindex im `[lang]`-Newsletter-Layout**

`app/[lang]/newsletter/layout.tsx` — Metadata-Export ergänzen (Rest der Datei unverändert):

```typescript
import type { ReactNode } from 'react'
import type { Metadata } from 'next'

// Force dynamic rendering for all newsletter pages
// These pages use searchParams and don't need static generation
export const dynamic = 'force-dynamic'

// Funktionale Seiten (confirm/unsubscribe/preferences) — nie indexieren.
export const metadata: Metadata = { robots: { index: false, follow: false } }

interface NewsletterLayoutProps {
  children: ReactNode
}

export default function NewsletterLayout({ children }: NewsletterLayoutProps) {
  return <>{children}</>
}
```

- [ ] **Step 2: Legacy-Baum prüfen und gleich behandeln**

Run: `ls app/newsletter/`
Falls dort Seiten liegen: gleiches `metadata`-Export in `app/newsletter/layout.tsx` ergänzen (Datei ggf. mit identischem Muster anlegen).

- [ ] **Step 3: Build + Commit**

```bash
npm run build
git add "app/[lang]/newsletter/layout.tsx"
git add app/newsletter/layout.tsx  # nur falls in Step 2 angelegt/geändert
git commit -m "fix(seo): noindex für alle Newsletter-Funktionsseiten"
```

---

### Task 6: Neue Übersetzungs-Keys (Code-Defaults + DB-Rows en/cs/fr/nds)

Voraussetzung für Tasks 7, 8, 9, 16, 17, 18. Fixt außerdem Finding #38 (meta.description zu kurz + en fehlt).

**Files:**
- Modify: `lib/i18n/get-translations.ts` (defaultTranslations)
- DB: `ui_translations` (INSERTs via Supabase MCP `execute_sql`)

**Interfaces:**
- Produces: Translation-Keys `rankings.meta.title`, `rankings.meta.description`, `rankings.h1`, `rankings.intro`, `rankings.related`, `rankings.show_all`, `rankings.company_products`, `rankings.since`, `rankings.last_seen`, `post.mentioned_products` — abrufbar über `getTranslations(locale)`.

- [ ] **Step 1: Deutsche Defaults in `defaultTranslations` ergänzen/ändern**

In `lib/i18n/get-translations.ts`:

`'meta.description'` (Zeile 13) ersetzen durch:

```typescript
  'meta.description': 'Synthszr ist die tägliche News-Synthese zu KI: Business, Design und Technologie — mit Newsletter, AI-Produkt-Charts und Company-Analysen.',
```

Im bestehenden `rankings.*`-Block ergänzen:

```typescript
  'rankings.meta.title': 'Synthszr Charts — das tägliche AI-Produkt-Ranking',
  'rankings.meta.description': 'Tägliches Momentum-Ranking der AI-Produkte, automatisch aus tausenden News- und Newsletter-Quellen ausgewertet — versions-granular und nach Kategorien.',
  'rankings.h1': 'Synthszr Charts — das tägliche AI-Produkt-Ranking',
  'rankings.intro': 'Die Synthszr Charts ranken AI-Produkte nach Momentum: Erwähnungen aus tausenden News- und Newsletter-Quellen, recency-gewichtet (Halbwertszeit 14 Tage), versions-granular und täglich aktualisiert.',
  'rankings.related': 'Weitere Produkte in dieser Kategorie',
  'rankings.show_all': 'Alle anzeigen',
  'rankings.company_products': 'Produkte in den Synthszr Charts',
  'rankings.since': 'seit',
  'rankings.last_seen': 'zuletzt',
  'post.mentioned_products': 'Im Artikel erwähnte Chart-Produkte',
```

- [ ] **Step 2: DB-Rows für en/cs/fr/nds einspielen (idempotent: delete + insert)**

Zuerst Spalten prüfen (falls es Pflichtspalten jenseits von key/language_code/value gibt, INSERT entsprechend ergänzen):

```sql
select column_name, is_nullable, column_default
from information_schema.columns
where table_name = 'ui_translations';
```

Dann via Supabase MCP `execute_sql` (oder `supabase db execute`):

```sql
delete from ui_translations
where language_code in ('en','cs','fr','nds')
  and key in ('meta.description','rankings.meta.title','rankings.meta.description',
              'rankings.h1','rankings.intro','rankings.related','rankings.show_all',
              'rankings.company_products','rankings.since','rankings.last_seen',
              'post.mentioned_products');

insert into ui_translations (key, language_code, value) values
-- EN
('meta.description','en','Synthszr is the daily AI news synthesis: business, design and technology — with a newsletter, AI product charts and company analyses.'),
('rankings.meta.title','en','Synthszr Charts — the daily AI product ranking'),
('rankings.meta.description','en','Daily momentum ranking of AI products, automatically distilled from thousands of news and newsletter sources — version-granular and by category.'),
('rankings.h1','en','Synthszr Charts — the daily AI product ranking'),
('rankings.intro','en','The Synthszr Charts rank AI products by momentum: mentions from thousands of news and newsletter sources, recency-weighted (14-day half-life), version-granular and updated daily.'),
('rankings.related','en','More products in this category'),
('rankings.show_all','en','Show all'),
('rankings.company_products','en','Products in the Synthszr Charts'),
('rankings.since','en','since'),
('rankings.last_seen','en','last seen'),
('post.mentioned_products','en','Chart products mentioned in this article'),
-- CS
('meta.description','cs','Synthszr je denní syntéza zpráv o AI: byznys, design a technologie — s newsletterem, žebříčky AI produktů a analýzami firem.'),
('rankings.meta.title','cs','Synthszr Charts — denní žebříček AI produktů'),
('rankings.meta.description','cs','Denní momentum-žebříček AI produktů, automaticky vyhodnocený z tisíců zpravodajských a newsletterových zdrojů — po verzích a podle kategorií.'),
('rankings.h1','cs','Synthszr Charts — denní žebříček AI produktů'),
('rankings.intro','cs','Synthszr Charts řadí AI produkty podle momenta: zmínky z tisíců zdrojů, vážené podle aktuálnosti (poločas 14 dní), po verzích a denně aktualizované.'),
('rankings.related','cs','Další produkty v této kategorii'),
('rankings.show_all','cs','Zobrazit vše'),
('rankings.company_products','cs','Produkty v Synthszr Charts'),
('rankings.since','cs','od'),
('rankings.last_seen','cs','naposledy'),
('post.mentioned_products','cs','Produkty z žebříčku zmíněné v článku'),
-- FR
('meta.description','fr','Synthszr, la synthèse quotidienne de l''actualité IA : business, design et technologie — avec newsletter, classements de produits IA et analyses d''entreprises.'),
('rankings.meta.title','fr','Synthszr Charts — le classement quotidien des produits IA'),
('rankings.meta.description','fr','Classement quotidien du momentum des produits IA, évalué automatiquement à partir de milliers de sources — par version et par catégorie.'),
('rankings.h1','fr','Synthszr Charts — le classement quotidien des produits IA'),
('rankings.intro','fr','Les Synthszr Charts classent les produits IA selon leur momentum : mentions issues de milliers de sources, pondérées par récence (demi-vie de 14 jours), par version et mises à jour chaque jour.'),
('rankings.related','fr','Plus de produits dans cette catégorie'),
('rankings.show_all','fr','Tout afficher'),
('rankings.company_products','fr','Produits dans les Synthszr Charts'),
('rankings.since','fr','depuis'),
('rankings.last_seen','fr','vu le'),
('post.mentioned_products','fr','Produits du classement mentionnés dans cet article'),
-- NDS
('meta.description','nds','Synthszr is de dääglich Nachrichten-Synthees to KI: Business, Design un Technologie — mit Newsletter, AI-Produkt-Charts un Firmen-Analysen.'),
('rankings.meta.title','nds','Synthszr Charts — dat dääglich AI-Produkt-Ranking'),
('rankings.meta.description','nds','Dääglich Momentum-Ranking vun de AI-Produkten, automaatsch ut dusende News- un Newsletter-Borns utweert — na Verschonen un Kategorien.'),
('rankings.h1','nds','Synthszr Charts — dat dääglich AI-Produkt-Ranking'),
('rankings.intro','nds','De Synthszr Charts ranken AI-Produkten na Momentum: Nöömen ut dusende Borns, na Aktualität wichtet (Halfweertstiet 14 Daag), na Verschonen un elk Dag nee.'),
('rankings.related','nds','Mehr Produkten in disse Kategorie'),
('rankings.show_all','nds','All wiesen'),
('rankings.company_products','nds','Produkten in de Synthszr Charts'),
('rankings.since','nds','siet'),
('rankings.last_seen','nds','tolest'),
('post.mentioned_products','nds','Chart-Produkten, de in dissen Artikel nöömt warrt');
```

- [ ] **Step 3: Verifizieren**

```sql
select language_code, count(*) from ui_translations
where key like 'rankings.meta%' or key = 'post.mentioned_products'
group by language_code;
```
Expected: je 3 Zeilen für en, cs, fr, nds.

- [ ] **Step 4: Commit**

```bash
git add lib/i18n/get-translations.ts
git commit -m "feat(i18n): Keys für Rankings-SEO (Meta, H1, Intro, Module) in 5 Sprachen"
```

---

### Task 7: Rankings-Liste — generateMetadata, H1+Intro, Facetten, „Alle anzeigen", fmtDate

Fixt Findings #2 (teilw.), #3, #5, #17, #23, #26, #29, #30, #33 (fmtDate) + Teil von #10 (Linkpfad zu allen Kategorie-Produkten).

**Files:**
- Modify: `app/[lang]/rankings/page.tsx`

**Interfaces:**
- Consumes: Translation-Keys aus Task 6, `generateLocalizedMetadata` aus `lib/i18n/metadata.ts`.

- [ ] **Step 1: Imports + PageProps erweitern**

```typescript
import type { Metadata } from 'next'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
import { LOCALE_STRINGS } from '@/lib/i18n/config'
```

`PageProps.searchParams` erweitern:

```typescript
  searchParams: Promise<{ category?: string; group?: string; sort?: string; all?: string }>
```

- [ ] **Step 2: Statisches `metadata`-Export (Zeilen 24–27) durch `generateMetadata` ersetzen**

```typescript
export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { lang } = await params
  const { category, group } = await searchParams
  const locale = lang as LanguageCode
  const translations = await getTranslations(locale)
  const t = (key: string) => translations[key] ?? key

  // Facetten (?category/?group) sind eigenständige Ansichten: eigener Title +
  // self-canonical auf die Facetten-URL. ?sort und ?all sind reine Duplikat-/
  // Vollansichten und tauchen bewusst NICHT im canonical auf.
  let path = '/rankings'
  let title = t('rankings.meta.title')
  if (category) {
    path = `/rankings?category=${category}`
    title = `${translations[`rankings.cat.${category}`] ?? category} — Synthszr Charts`
  } else if (group) {
    path = `/rankings?group=${group}`
    title = `${translations[`rankings.group.${group}`] ?? group} — Synthszr Charts`
  }

  return generateLocalizedMetadata({
    title,
    description: t('rankings.meta.description'),
    path,
    locale,
  })
}
```

- [ ] **Step 3: `fmtDate` locale-fähig machen**

```typescript
function fmtDate(d: string | null, lang: string): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString(LOCALE_STRINGS[lang as LanguageCode] ?? 'de-DE', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return '—'
  }
}
```

Call-Site (Zeile 169) anpassen: `{fmtDate(p.lastSeen, lang)}`.

- [ ] **Step 4: `all`-Param lesen + Limit anheben**

In der Komponente:

```typescript
  const { category, group, sort, all } = await searchParams
```

`getRankedProducts`-Aufruf (Zeile 48):

```typescript
      // Kategorie-Ansicht: 50 als Default, per ?all=1 die komplette Kategorie
      // (crawlbarer Linkpfad zu allen chartbaren Produkten, canonical bleibt
      // auf der 50er-Ansicht).
      limit: category ? (all === '1' ? 1000 : 50) : 100,
```

- [ ] **Step 5: H1 + Intro nach dem Banner einfügen**

Direkt nach `<RankingsBanner />` (Zeile 88):

```tsx
      <header className="mb-5">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
          {category
            ? `${catName(category, nameBySlug.get(category) ?? category)} — Synthszr Charts`
            : t('rankings.h1')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 leading-relaxed">{t('rankings.intro')}</p>
      </header>
```

**Achtung Reihenfolge:** `catName`/`nameBySlug` werden erst nach dem Daten-Load definiert (Zeile 61–62) — der Header muss im JSX **nach** deren Definition stehen; das ist er (JSX beginnt Zeile 82). Keine Umstellung nötig.

- [ ] **Step 6: „Alle anzeigen"-Link unter der Liste (nur Kategorie-Ansicht)**

Nach dem schließenden `</ol>` (Zeile 179), vor dem `<footer>`:

```tsx
      {category && all !== '1' && products.length === 50 && (
        <div className="mt-3">
          <Link
            href={`${tabBase}?category=${category}&all=1`}
            className="inline-block rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:border-black hover:text-black"
          >
            {t('rankings.show_all')} →
          </Link>
        </div>
      )}
```

- [ ] **Step 7: Build + Commit**

Run: `npm run build`
Expected: Build erfolgreich.

```bash
git add "app/[lang]/rankings/page.tsx"
git commit -m "feat(seo): Rankings-Liste — lokalisierte Meta + canonical/hreflang, H1+Intro, Facetten-Titles, Alle-anzeigen-Link"
```

---

### Task 8: Produkt-Detailseite — generateMetadata lokalisiert + ISR + lokalisierte Labels

Fixt Findings #2 (teilw.), #7, #8, #22, #25, #33, #35.

**Files:**
- Modify: `app/[lang]/rankings/[slug]/page.tsx`

- [ ] **Step 1: `force-dynamic` durch ISR ersetzen**

Zeilen 15–17, aus:
```typescript
export const dynamic = 'force-dynamic'
```
wird:
```typescript
// ISR statt force-dynamic: Daten ändern sich nur per täglichem Cron. Kein
// generateStaticParams → kein Build-time-Prerender (das war der Grund für das
// alte force-dynamic), Seiten rendern on-demand und cachen 5 min am Edge.
// Bei ~5000 Produktseiten ist das der Unterschied zwischen crawlbar und nicht.
export const revalidate = 300
```

- [ ] **Step 2: `generateMetadata` auf `generateLocalizedMetadata` umstellen**

Imports ergänzen:

```typescript
import type { Metadata } from 'next'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
import { LOCALE_STRINGS } from '@/lib/i18n/config'
```

Zeilen 39–47 ersetzen:

```typescript
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang, slug } = await params
  const locale = lang as LanguageCode
  const p = await getProductDetail(slug, lang)
  if (!p) return { title: 'Produkt nicht gefunden | Synthszr Charts', robots: { index: false, follow: false } }

  const description = locale === 'de'
    ? `${p.canonicalName} (${p.vendor}): Momentum-Score, Belege und Erwähnungen aus der Tech-Berichterstattung — täglich aktualisiert in den Synthszr Charts.`
    : `${p.canonicalName} (${p.vendor}): momentum score, evidence and mentions from tech coverage — updated daily in the Synthszr Charts.`

  return generateLocalizedMetadata({
    title: locale === 'de'
      ? `${p.canonicalName} — AI-Produkt-Ranking | Synthszr Charts`
      : `${p.canonicalName} — AI Product Ranking | Synthszr Charts`,
    description,
    path: `/rankings/${slug}`,
    locale,
    // Produkt-Content existiert nur de/en — cs/fr/nds zeigen EN-Fallback und
    // gehören nicht in den hreflang-Cluster (sonst Thin-Duplicate-Signale).
    availableLocales: ['de', 'en'],
  })
}
```

- [ ] **Step 3: Hartkodierte deutsche Labels + fmtDate lokalisieren**

`fmtDate` wie in Task 7 auf `(d, lang)` umstellen; Call-Site Zeile 92: `{fmtDate(p.lastSeen, lang)}`.

Zeile 91–92, aus:
```tsx
            {p.releasedAt && <> · seit {p.releasedAt}</>}
            {' · '}{p.mentionCount}× · zuletzt {fmtDate(p.lastSeen)}
```
wird:
```tsx
            {p.releasedAt && <> · {t('rankings.since')} {p.releasedAt}</>}
            {' · '}{p.mentionCount}× · {t('rankings.last_seen')} {fmtDate(p.lastSeen, lang)}
```

**Hinweis:** `t` ist erst nach dem Daten-Load in der Komponente definiert (Zeile 54) — die Labels liegen im JSX danach, passt.

- [ ] **Step 4: Build + Commit**

Run: `npm run build`
Expected: Build erfolgreich; `/[lang]/rankings/[slug]` erscheint in der Build-Ausgabe als ISR/on-demand, nicht `ƒ (Dynamic)` erzwungen.

```bash
git add "app/[lang]/rankings/[slug]/page.tsx"
git commit -m "feat(seo): Produktseiten — canonical/hreflang, lokalisierte Meta, ISR 300s statt force-dynamic"
```

---

### Task 9: Compare-Seite — noindex + lokalisierter Title

Fixt Findings #14, #40, #44 + Teil von #26.

**Files:**
- Modify: `app/[lang]/rankings/compare/page.tsx:19`

- [ ] **Step 1: Statisches metadata durch generateMetadata mit noIndex ersetzen**

Imports ergänzen:

```typescript
import type { Metadata } from 'next'
import { generateLocalizedMetadata } from '@/lib/i18n/metadata'
```

Zeile 19 ersetzen:

```typescript
// Reine Tool-Seite: Pin-State liegt im localStorage, die nackte URL ist für
// Crawler leer → noindex. Der Title bleibt für Tab/History nützlich.
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params
  const locale = lang as LanguageCode
  const translations = await getTranslations(locale)
  return generateLocalizedMetadata({
    title: `${translations['rankings.compare_title'] ?? 'Produktvergleich'} — Synthszr Charts`,
    path: '/rankings/compare',
    locale,
    noIndex: true,
  })
}
```

- [ ] **Step 2: Build + Commit**

```bash
npm run build
git add "app/[lang]/rankings/compare/page.tsx"
git commit -m "fix(seo): Compare-Seite auf noindex (Thin/Tool-Page) + lokalisierter Title"
```

---

### Task 10: Sitemap — Rankings-URLs + lastmod-Fix

Fixt Findings #1, #6, #36 + Sitemap-Teil von #4/#10.

**Files:**
- Modify: `app/sitemap.ts`

**Interfaces:**
- Consumes: `getRankedProducts({ limit, minMentions })` aus `lib/rankings/leaderboard.ts` (liefert `{ slug, lastSeen }`; paginiert intern über das PostgREST-1000er-Cap).

- [ ] **Step 1: Import ergänzen**

```typescript
import { getRankedProducts } from '@/lib/rankings/leaderboard'
```

- [ ] **Step 2: `lastModified: new Date()` bei Static Pages entfernen**

Im Static-Pages-Block (Zeile 64–72) die Zeile `lastModified: new Date(),` ersatzlos streichen — ein lastmod, das bei jedem Abruf „jetzt" ist, entwertet das Signal domainweit. Google nutzt dann changefreq/priority bzw. eigene Heuristiken.

- [ ] **Step 3: Rankings-Übersicht + Produktseiten anhängen**

Vor `return sitemap` (Zeile 107) einfügen:

```typescript
  // Rankings-Übersicht: alle Public-Locales (UI ist übersetzt).
  const rankingsAlternates: Record<string, string> = {
    'x-default': `${BASE_URL}/${DEFAULT_LOCALE}/rankings`,
  }
  for (const locale of activeLocales) {
    rankingsAlternates[locale] = `${BASE_URL}/${locale}/rankings`
  }
  for (const locale of activeLocales) {
    sitemap.push({
      url: `${BASE_URL}/${locale}/rankings`,
      changeFrequency: 'daily',
      priority: locale === DEFAULT_LOCALE ? 0.9 : 0.7,
      alternates: { languages: rankingsAlternates },
    })
  }

  // Produkt-Detailseiten: nur chartbare Produkte mit ≥2 Mentions (gleiches
  // Kriterium wie das Leaderboard) — dünnere Seiten bleiben draußen. Nur
  // de/en: andere Locales liefern EN-Fallback-Content (kein hreflang-Cluster).
  try {
    const products = await getRankedProducts({ limit: 10_000, minMentions: 2 })
    const PRODUCT_LOCALES = ['de', 'en'] as const
    for (const p of products) {
      const alternates: Record<string, string> = {
        'x-default': `${BASE_URL}/de/rankings/${p.slug}`,
        de: `${BASE_URL}/de/rankings/${p.slug}`,
        en: `${BASE_URL}/en/rankings/${p.slug}`,
      }
      for (const loc of PRODUCT_LOCALES) {
        sitemap.push({
          url: `${BASE_URL}/${loc}/rankings/${p.slug}`,
          ...(p.lastSeen ? { lastModified: new Date(p.lastSeen) } : {}),
          changeFrequency: 'daily',
          priority: loc === 'de' ? 0.7 : 0.5,
          alternates: { languages: alternates },
        })
      }
    }
  } catch (e) {
    // Sitemap darf bei DB-Hickup nicht komplett ausfallen — Posts/Static bleiben.
    console.error('sitemap: rankings section failed', e)
  }
```

- [ ] **Step 4: Build + Commit**

Run: `npm run build`
Expected: Build erfolgreich. (~4.200 zusätzliche URLs: 5×Übersicht + 2×~2.085 Produkte — weit unter dem 50k-Limit.)

```bash
git add app/sitemap.ts
git commit -m "feat(seo): Sitemap — Rankings-Übersicht + alle chartbaren Produktseiten (de/en), lastmod-Fix"
```

---

### Task 11: JSON-LD für Rankings (ItemList, SoftwareApplication, BreadcrumbList)

Fixt Findings #18, #41.

**Files:**
- Modify: `app/[lang]/rankings/page.tsx`
- Modify: `app/[lang]/rankings/[slug]/page.tsx`

**Interfaces:**
- Consumes: `SITE_URL` aus `lib/seo/site.ts` (Task 1).

- [ ] **Step 1: ItemList auf der Liste**

In `app/[lang]/rankings/page.tsx`: Import `import { SITE_URL } from '@/lib/seo/site'`. In der Komponente nach der `products`-Berechnung (Zeile 59):

```typescript
  // ItemList = Rich-Result-Chance für "AI Ranking"-Queries. Top 25 reicht —
  // Google braucht die Struktur, nicht die volle Liste.
  const itemListLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Synthszr Charts',
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    numberOfItems: products.length,
    itemListElement: products.slice(0, 25).map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: p.canonicalName,
      url: `${SITE_URL}/${lang}/rankings/${p.slug}`,
    })),
  }
```

Im JSX direkt nach `<main ...>` (Zeile 84):

```tsx
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }}
      />
```

- [ ] **Step 2: SoftwareApplication + BreadcrumbList auf der Produktseite**

In `app/[lang]/rankings/[slug]/page.tsx`: Import `SITE_URL`. In der Komponente nach dem Daten-Load (nach Zeile 54):

```typescript
  // Kein aggregateRating/offers: Momentum-Score ist kein Review — erfundene
  // Rating-Markups riskieren Manual Actions.
  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: p.canonicalName,
    url: `${SITE_URL}/${lang}/rankings/${p.slug}`,
    ...(p.description ? { description: p.description } : {}),
    ...(p.category ? { applicationCategory: p.category.name } : {}),
    publisher: { '@type': 'Organization', name: p.vendor },
  }
  const crumbs = [
    { '@type': 'ListItem', position: 1, name: 'Synthszr', item: `${SITE_URL}/${lang}` },
    { '@type': 'ListItem', position: 2, name: 'Synthszr Charts', item: `${SITE_URL}/${lang}/rankings` },
    ...(p.category
      ? [{ '@type': 'ListItem', position: 3, name: p.category.name, item: `${SITE_URL}/${lang}/rankings?category=${p.category.slug}` }]
      : []),
  ]
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [...crumbs, { '@type': 'ListItem', position: crumbs.length + 1, name: p.canonicalName }],
  }
```

Im JSX direkt nach `<main ...>` (Zeile 58):

```tsx
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
```

- [ ] **Step 3: Build + Commit**

```bash
npm run build
git add "app/[lang]/rankings/page.tsx" "app/[lang]/rankings/[slug]/page.tsx"
git commit -m "feat(seo): JSON-LD für Rankings — ItemList (Liste) + SoftwareApplication/Breadcrumb (Produktseiten)"
```

---

### Task 12: Meta-Description-Cleaner für Posts

Fixt Finding #16 (Bullets/Newlines/235 Zeichen in Meta-Descriptions).

**Files:**
- Modify: `lib/i18n/metadata.ts` (Helper-Export)
- Modify: `app/[lang]/posts/[slug]/page.tsx:136` (generateMetadata-Description)
- Test: `tests/lib/meta-description.test.ts`

**Interfaces:**
- Produces: `cleanMetaDescription(raw: string, maxLength?: number): string` — auch von Task 19 (Feed) konsumiert.

- [ ] **Step 1: Failing Test schreiben**

```typescript
// tests/lib/meta-description.test.ts
import { describe, it, expect } from 'vitest'
import { cleanMetaDescription } from '@/lib/i18n/metadata'

describe('cleanMetaDescription', () => {
  it('entfernt Bullets und Zeilenumbrüche und kollabiert Whitespace', () => {
    const raw = 'Intro-Satz.\n• Erster Punkt\n• Zweiter  Punkt'
    expect(cleanMetaDescription(raw)).toBe('Intro-Satz. Erster Punkt Zweiter Punkt')
  })

  it('kürzt auf ~155 Zeichen an einer Wortgrenze mit Ellipse', () => {
    const raw = 'Wort '.repeat(60) // 300 Zeichen
    const out = cleanMetaDescription(raw)
    expect(out.length).toBeLessThanOrEqual(156)
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toMatch(/\sWor…$/) // kein mitten-im-Wort-Schnitt
  })

  it('lässt kurze saubere Texte unverändert', () => {
    expect(cleanMetaDescription('Kurz und sauber.')).toBe('Kurz und sauber.')
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/lib/meta-description.test.ts`
Expected: FAIL — `cleanMetaDescription` existiert nicht.

- [ ] **Step 3: Helper implementieren**

In `lib/i18n/metadata.ts` (ans Dateiende):

```typescript
/** Bereinigt einen Roh-Excerpt für Meta-/OG-Descriptions: Bullet-Zeichen und
 *  Zeilenumbrüche raus, Whitespace kollabieren, an Wortgrenze auf ~155 Zeichen
 *  kürzen (Google schneidet sonst mitten im ersten Bullet ab). */
export function cleanMetaDescription(raw: string, maxLength = 155): string {
  // Nur Bullet-Zeichen strippen — Gedankenstriche (–/—) sind legitimer Fließtext.
  const cleaned = raw.replace(/[•·▪‣]\s*/g, '').replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLength) return cleaned
  const cut = cleaned.slice(0, maxLength)
  const lastSpace = cut.lastIndexOf(' ')
  const base = lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut
  return `${base.replace(/[,;:.]$/, '')}…`
}
```

**Achtung:** Zeichenset bewusst NUR Bullets (`[•·▪‣]`) — keine Gedankenstriche, die sind legitimer Fließtext.

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npx vitest run tests/lib/meta-description.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: In der Posts-generateMetadata verwenden**

In `app/[lang]/posts/[slug]/page.tsx` (Zeile ~136), aus:
```typescript
    description: post.excerpt || undefined,
```
wird:
```typescript
    description: post.excerpt ? cleanMetaDescription(post.excerpt) : undefined,
```
Import ergänzen: `cleanMetaDescription` aus `@/lib/i18n/metadata` (dort wird bereits `generateLocalizedMetadata` importiert — gleiche Import-Zeile erweitern).

- [ ] **Step 6: Build + Commit**

```bash
npm run build
git add lib/i18n/metadata.ts "app/[lang]/posts/[slug]/page.tsx" tests/lib/meta-description.test.ts
git commit -m "fix(seo): Meta-Descriptions der Posts bereinigen (Bullets/Newlines raus, 155-Zeichen-Wortgrenze)"
```

---

### Task 13: Posts — Article-Schema anreichern, Breadcrumbs lokalisieren, Hosts auf www

Fixt Findings #20 (Rest), #39.

**Files:**
- Modify: `app/[lang]/posts/[slug]/page.tsx:307-327`

- [ ] **Step 1: Schemas ersetzen**

Import ergänzen: `import { SITE_URL } from '@/lib/seo/site'`.

Die beiden LD-Objekte (Zeilen ~307–327) ersetzen. Voraussetzung: In der Komponente sind `locale`, `slug`, `post` und die Translations verfügbar — falls die Komponente noch kein `translations`-Objekt lädt, `const translations = await getTranslations(locale)` ergänzen (Import existiert bereits):

```typescript
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    mainEntityOfPage: `${SITE_URL}/${locale}/posts/${slug}`,
    datePublished: post.created_at,
    ...(post.updated_at && { dateModified: post.updated_at }),
    author: { '@type': 'Organization', name: 'Synthszr', url: `${SITE_URL}/de` },
    publisher: {
      '@type': 'Organization',
      name: 'Synthszr',
      url: `${SITE_URL}/de`,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/apple-touch-icon.png` },
    },
    ...(post.excerpt && { description: post.excerpt }),
    ...(post.cover_image_url && { image: post.cover_image_url }),
  }

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: translations['nav.home'] ?? 'Home', item: `${SITE_URL}/${locale}` },
      { '@type': 'ListItem', position: 2, name: translations['nav.archive'] ?? 'Archiv', item: `${SITE_URL}/${locale}/archive` },
      { '@type': 'ListItem', position: 3, name: post.title },
    ],
  }
```

- [ ] **Step 2: Build + Commit**

```bash
npm run build
git add "app/[lang]/posts/[slug]/page.tsx"
git commit -m "fix(seo): Article-Schema mit mainEntityOfPage/publisher.logo, Breadcrumbs lokalisiert, Hosts auf www"
```

---

### Task 14: Tool-Call-Leak — Parser-Guard + DB-Cleanup

Fixt Finding #21 (geleaktes `</description> <parameter …>`-Markup sichtbar auf Produktseiten; 93+38 betroffene Zeilen in `product_features_current`).

**Files:**
- Modify: `lib/rankings/research.ts:36-39` (stripCite → sanitizeText)
- Test: `tests/lib/rankings-research-sanitize.test.ts`
- DB: `product_features_current` (UPDATE)

- [ ] **Step 1: Failing Test schreiben**

```typescript
// tests/lib/rankings-research-sanitize.test.ts
import { describe, it, expect } from 'vitest'
import { parseResearchResponse } from '@/lib/rankings/research'

describe('parseResearchResponse — Tool-Call-Leak-Guard', () => {
  it('kappt geleaktes </description>/<parameter>-Markup aus der Description', () => {
    const res = parseResearchResponse(
      {
        description: 'Ein KI-Modell für Coding.</description> <parameter name="description_en">An AI model',
        description_en: 'An AI coding model.',
        features: [],
      },
      new Set(),
    )
    expect(res.description).toBe('Ein KI-Modell für Coding.')
    expect(res.descriptionEn).toBe('An AI coding model.')
  })

  it('kappt Leak in Feature-Values', () => {
    const res = parseResearchResponse(
      {
        description: 'x',
        description_en: 'y',
        features: [{ dimension: 'Preis', value: '10 $/Monat</description><parameter name="x">Rest', source_url: 'https://example.com' }],
      },
      new Set(['Preis']),
    )
    expect(res.features[0].value).toBe('10 $/Monat')
  })

  it('lässt saubere Texte mit <cite> weiterhin korrekt durch', () => {
    const res = parseResearchResponse(
      { description: 'Text <cite index="1">Quelle</cite> Ende.', description_en: 'x', features: [] },
      new Set(),
    )
    expect(res.description).toBe('Text Quelle Ende.')
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/lib/rankings-research-sanitize.test.ts`
Expected: FAIL (Tests 1 und 2 — der Leak bleibt im Text).

- [ ] **Step 3: Guard implementieren**

In `lib/rankings/research.ts` die Funktion `stripCite` (Zeilen 36–39) ersetzen:

```typescript
/** Entfernt web_search-Citation-Markup (<cite …>…</cite>) und kappt geleaktes
 *  Tool-Call-Markup (</description>, <parameter …> …) — Claude schreibt bei
 *  Tool-Fehlern gelegentlich das rohe Call-XML in die Feldwerte. */
function stripCite(s: string): string {
  return s
    .replace(/<\/?cite[^>]*>/g, '')
    .replace(/<\/?(?:description(?:_en)?|parameter)\b[^>]*>[\s\S]*/i, '')
    .trim()
}
```

(Funktionsname bleibt `stripCite` — alle 6 Call-Sites bleiben unverändert; der JSDoc dokumentiert die Erweiterung.)

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**

Run: `npx vitest run tests/lib/rankings-research-sanitize.test.ts && npx vitest run tests/lib/ranking-parse.test.ts`
Expected: PASS (neue + bestehende Parse-Tests grün — Regression ausgeschlossen).

- [ ] **Step 5: DB-Cleanup der bereits gespeicherten Leaks**

Via Supabase MCP `execute_sql` — erst zählen, dann fixen, dann verifizieren:

```sql
-- Vorher: erwartete Treffer ~93 (value_text) / ~38 (value_text_en)
select
  count(*) filter (where value_text like '%</description>%' or value_text like '%<parameter%') as de_leaks,
  count(*) filter (where value_text_en like '%</description>%' or value_text_en like '%<parameter%') as en_leaks
from product_features_current;

update product_features_current
set value_text = trim(split_part(split_part(value_text, '</description>', 1), '<parameter', 1))
where value_text like '%</description>%' or value_text like '%<parameter%';

update product_features_current
set value_text_en = trim(split_part(split_part(value_text_en, '</description>', 1), '<parameter', 1))
where value_text_en like '%</description>%' or value_text_en like '%<parameter%';

-- Nachher: beide Zähler müssen 0 sein
select
  count(*) filter (where value_text like '%</description>%' or value_text like '%<parameter%') as de_leaks,
  count(*) filter (where value_text_en like '%</description>%' or value_text_en like '%<parameter%') as en_leaks
from product_features_current;
```

- [ ] **Step 6: Commit**

```bash
git add lib/rankings/research.ts tests/lib/rankings-research-sanitize.test.ts
git commit -m "fix(rankings): Tool-Call-Leak-Guard im Research-Parser + DB-Cleanup der 131 betroffenen Zeilen"
```

---

### Task 15: Interne Links — Hero-Fix + Footer-Links

Fixt Findings #31 (Hero-Redirect-Hop), #45.

**Files:**
- Modify: `components/home-hero.tsx:23`
- Modify: `components/site-footer.tsx`
- Modify: `app/[lang]/page.tsx` (Inline-Footer der Homepage)

- [ ] **Step 1: Hero-Link ohne Redirect-Hop**

`components/home-hero.tsx` Zeile 23, aus:
```typescript
  const href = !locale || locale === 'de' ? '/rankings' : `/${locale}/rankings`
```
wird:
```typescript
  // Immer locale-präfixiert — /rankings ohne Präfix kostet einen 307-Hop.
  const href = `/${locale || 'de'}/rankings`
```

- [ ] **Step 2: Footer-Links in `components/site-footer.tsx`**

Vor dem LinkedIn-`<a>` einfügen:

```tsx
              <Link href={`/${locale}/rankings`} className="hover:text-accent transition-colors">
                Charts
              </Link>
              <Link href={`/${locale}/companies`} className="hover:text-accent transition-colors">
                Companies
              </Link>
```

- [ ] **Step 3: Gleiche zwei Links im Inline-Footer der Homepage**

In `app/[lang]/page.tsx` im `<footer>`-Block (vor dem LinkedIn-`<a>`, Zeile ~314):

```tsx
              <Link href={`/${locale}/rankings`} className="hover:text-accent transition-colors">
                Charts
              </Link>
              <Link href={`/${locale}/companies`} className="hover:text-accent transition-colors">
                Companies
              </Link>
```

- [ ] **Step 4: Build + Commit**

```bash
npm run build
git add components/home-hero.tsx components/site-footer.tsx "app/[lang]/page.tsx"
git commit -m "feat(seo): sitewide Footer-Links auf Charts/Companies, Hero-Link ohne 307-Hop"
```

---

### Task 16: Related-Products-Modul auf Produktseiten

Fixt Finding #4/#10 (Link-Mesh zwischen Produktseiten — Orphan-Reduktion).

**Files:**
- Create: `components/rankings/related-products.tsx`
- Modify: `app/[lang]/rankings/[slug]/page.tsx` (Einbindung)

**Interfaces:**
- Consumes: `getRankedProducts({ category, limit, minMentions })` (Task-übergreifend bekannt), `VendorAvatar`, Translation-Key `rankings.related` (Task 6).
- Produces: `RelatedProducts({ lang, categorySlug, categoryName, excludeSlug, heading })` — async Server Component.

- [ ] **Step 1: Komponente anlegen**

```tsx
// components/rankings/related-products.tsx
import Link from 'next/link'
import { getRankedProducts } from '@/lib/rankings/leaderboard'
import { VendorAvatar } from './vendor-avatar'

/** Server-gerendertes "Weitere Produkte in dieser Kategorie"-Modul: verlinkt
 *  Kategorie-Nachbarn im Ranking als echte <a href> — Crawl-Mesh gegen die
 *  ~3.300 Orphan-Produktseiten. */
export async function RelatedProducts({
  lang,
  categorySlug,
  categoryName,
  excludeSlug,
  heading,
}: {
  lang: string
  categorySlug: string
  categoryName: string
  excludeSlug: string
  heading: string
}) {
  let items: Awaited<ReturnType<typeof getRankedProducts>>
  try {
    items = await getRankedProducts({ category: categorySlug, limit: 13, minMentions: 2 })
  } catch {
    return null // nicht essenziell — Seite darf ohne das Modul rendern
  }
  const related = items.filter((x) => x.slug !== excludeSlug).slice(0, 12)
  if (related.length === 0) return null

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold mb-3">
        {heading}: {categoryName}
      </h2>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {related.map((x) => (
          <li key={x.slug}>
            <Link
              href={`/${lang}/rankings/${x.slug}`}
              className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm transition-colors hover:border-black"
            >
              <VendorAvatar vendor={x.vendor} size={22} />
              <span className="font-medium truncate">{x.canonicalName}</span>
              <span className="ml-auto shrink-0 tabular-nums font-bold">{x.score}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 2: Auf der Produktseite einbinden**

In `app/[lang]/rankings/[slug]/page.tsx`: Import ergänzen, dann nach dem `<PremarketSynthesisBlock>`-Ausdruck (Zeile 146), vor dem `<footer>`:

```tsx
      {p.category && (
        <RelatedProducts
          lang={lang}
          categorySlug={p.category.slug}
          categoryName={translations[`rankings.cat.${p.category.slug}`] ?? p.category.name}
          excludeSlug={p.slug}
          heading={t('rankings.related')}
        />
      )}
```

- [ ] **Step 3: Build + Commit**

```bash
npm run build
git add components/rankings/related-products.tsx "app/[lang]/rankings/[slug]/page.tsx"
git commit -m "feat(seo): Related-Products-Modul — Kategorie-Nachbarn als crawlbares Link-Mesh"
```

---

### Task 17: Companies → Rankings Rückverlinkung

Fixt Finding #32 (einseitiges Silo).

**Files:**
- Create: `components/rankings/vendor-products.tsx`
- Modify: `app/[lang]/companies/[slug]/page.tsx` (Einbindung)

**Interfaces:**
- Produces: `VendorProducts({ lang, vendor, heading })` — async Server Component. `vendor` = Company-Slug (== `products.vendor_namespace`, so verlinkt die Produktseite zur Company).

- [ ] **Step 1: Komponente anlegen**

```tsx
// components/rankings/vendor-products.tsx
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { VendorAvatar } from './vendor-avatar'

/** "Produkte in den Synthszr Charts" auf Company-Seiten — schließt das
 *  bisher einseitige Silo (Produktseite → Company, aber nie zurück). */
export async function VendorProducts({
  lang,
  vendor,
  heading,
}: {
  lang: string
  vendor: string
  heading: string
}) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_metrics')
    .select('momentum, mention_count, products!inner(canonical_name, vendor_namespace, slug)')
    .eq('chartable', true)
    .eq('products.vendor_namespace', vendor)
    .gte('mention_count', 2)
    .order('momentum', { ascending: false })
    .limit(12)
  if (error || !data?.length) return null

  const items = data.map((r) => {
    const p = (Array.isArray(r.products) ? r.products[0] : r.products) as {
      canonical_name: string
      vendor_namespace: string
      slug: string
    }
    return { name: p.canonical_name, vendor: p.vendor_namespace, slug: p.slug }
  })

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold mb-3">{heading}</h2>
      <ul className="flex flex-wrap gap-2">
        {items.map((x) => (
          <li key={x.slug}>
            <Link
              href={`/${lang}/rankings/${x.slug}`}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm transition-colors hover:border-black"
            >
              <VendorAvatar vendor={x.vendor} size={20} />
              <span className="font-medium">{x.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 2: Auf der Company-Seite einbinden**

`app/[lang]/companies/[slug]/page.tsx` lesen (Read), den Company-Slug-Parameter identifizieren (`slug` aus params) und die Komponente **im server-gerenderten Teil** vor dem Footer/Ende von `<main>` einbinden:

```tsx
      <VendorProducts
        lang={lang}
        vendor={slug}
        heading={translations['rankings.company_products'] ?? 'Produkte in den Synthszr Charts'}
      />
```

(Import ergänzen; falls die Seite `translations` noch nicht lädt: `const translations = await getTranslations(locale)` — Import existiert dort bereits. Falls die Seite die Company unter einem anderen Variablennamen führt, den tatsächlichen Slug-Wert verwenden — Maßstab: derselbe Wert, auf den `app/[lang]/rankings/[slug]/page.tsx:88` mit `/${lang}/companies/${p.vendor}` verlinkt.)

- [ ] **Step 3: Build + Commit**

```bash
npm run build
git add components/rankings/vendor-products.tsx "app/[lang]/companies/[slug]/page.tsx"
git commit -m "feat(seo): Company-Seiten verlinken zurück auf ihre Chart-Produkte (Silo geschlossen)"
```

---

### Task 18: Posts — server-gerenderte „Erwähnte Chart-Produkte"-Box

Fixt Finding #31 (Kern). Hinweis: Inline-Produkt-Links existieren bereits **client-seitig** (`injectProductLinks` im TiptapRenderer + `/api/rankings/products`) — für Crawler unsichtbar, da TipTap client-only rendert. Diese Box liefert die crawlbare Server-Variante.

**Files:**
- Create: `lib/posts/product-mentions.ts`
- Create: `components/post-product-links.tsx`
- Modify: `app/[lang]/posts/[slug]/page.tsx` (Einbindung nach dem Artikel-Content)
- Test: `tests/lib/product-mentions.test.ts`

**Interfaces:**
- Produces: `findMentionedProducts<T extends { canonicalName: string }>(contentText: string, products: T[], max?: number): T[]` und `PostProductLinks({ content, locale })` (async Server Component).

- [ ] **Step 1: Failing Test für den Matcher**

```typescript
// tests/lib/product-mentions.test.ts
import { describe, it, expect } from 'vitest'
import { findMentionedProducts } from '@/lib/posts/product-mentions'

const products = [
  { canonicalName: 'Claude Code' },
  { canonicalName: 'Gemini 3 Pro' },
  { canonicalName: 'Grok' },
  { canonicalName: 'Vim' }, // < 4 Zeichen → nie matchen
]

describe('findMentionedProducts', () => {
  it('findet Produktnamen mit Wortgrenzen (case-insensitive)', () => {
    const text = 'Heute hat CLAUDE CODE ein Update bekommen, Gemini 3 Pro zieht nach.'
    const hits = findMentionedProducts(text, products)
    expect(hits.map((h) => h.canonicalName)).toEqual(['Claude Code', 'Gemini 3 Pro'])
  })

  it('matcht nicht innerhalb anderer Wörter', () => {
    expect(findMentionedProducts('Das Grokking-Phänomen', products)).toEqual([])
  })

  it('ignoriert zu kurze Namen und respektiert das Max-Limit', () => {
    expect(findMentionedProducts('Vim Vim Vim', products)).toEqual([])
    const many = Array.from({ length: 20 }, (_, i) => ({ canonicalName: `Produktname${i}` }))
    const text = many.map((p) => p.canonicalName).join(' ')
    expect(findMentionedProducts(text, many, 8)).toHaveLength(8)
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/lib/product-mentions.test.ts`
Expected: FAIL — Modul existiert nicht.

- [ ] **Step 3: Matcher implementieren**

```typescript
// lib/posts/product-mentions.ts
/** Findet Chart-Produkte, deren Name im Text vorkommt — mit Wortgrenzen
 *  (Unicode-aware), case-insensitive. Namen < 4 Zeichen werden übersprungen
 *  (zu viele False Positives bei Kurznamen). */
export function findMentionedProducts<T extends { canonicalName: string }>(
  contentText: string,
  products: T[],
  max = 8,
): T[] {
  const text = contentText.toLowerCase()
  const hits: T[] = []
  for (const p of products) {
    if (hits.length >= max) break
    const name = p.canonicalName.toLowerCase()
    if (name.length < 4) continue
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u')
    if (re.test(text)) hits.push(p)
  }
  return hits
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npx vitest run tests/lib/product-mentions.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Server-Komponente anlegen**

```tsx
// components/post-product-links.tsx
import Link from 'next/link'
import { getRankedProducts } from '@/lib/rankings/leaderboard'
import { getTranslations } from '@/lib/i18n/get-translations'
import { findMentionedProducts } from '@/lib/posts/product-mentions'
import type { LanguageCode } from '@/lib/types'

/** Server-gerenderte, crawlbare Links auf Chart-Produkte, die im Post
 *  namentlich vorkommen — Ergänzung zu den client-seitigen Inline-Links des
 *  TiptapRenderers (die stehen nicht im initialen HTML). */
export async function PostProductLinks({
  content,
  locale,
}: {
  content: Record<string, unknown>
  locale: LanguageCode
}) {
  let products: Awaited<ReturnType<typeof getRankedProducts>>
  try {
    products = await getRankedProducts({ limit: 1000, minMentions: 2 })
  } catch {
    return null
  }
  const mentioned = findMentionedProducts(JSON.stringify(content), products, 8)
  if (mentioned.length === 0) return null

  const t = await getTranslations(locale)
  return (
    <nav className="mt-8 border-t border-border pt-4">
      <h3 className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {t['post.mentioned_products'] ?? 'Im Artikel erwähnte Chart-Produkte'}
      </h3>
      <ul className="flex flex-wrap gap-2">
        {mentioned.map((p) => (
          <li key={p.slug}>
            <Link
              href={`/${locale}/rankings/${p.slug}`}
              className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs transition-colors hover:bg-secondary"
            >
              {p.canonicalName}
              {p.rank && <span className="text-muted-foreground">#{p.rank}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
```

- [ ] **Step 6: In der Post-Seite einbinden**

In `app/[lang]/posts/[slug]/page.tsx`: Import ergänzen, dann direkt nach dem Artikel-Content-Block (nach dem Element mit `id="post-article"` bzw. nach der `PostContentView`-Suspense, Zeile ~356) einfügen:

```tsx
        <PostProductLinks content={post.content as Record<string, unknown>} locale={locale} />
```

(Exakte Insertion: die Stelle, an der der Artikel-Body endet und vor Share/Navigation — beim Ausführen per Read verifizieren.)

- [ ] **Step 7: Build + Commit**

```bash
npm run build
git add lib/posts/product-mentions.ts components/post-product-links.tsx "app/[lang]/posts/[slug]/page.tsx" tests/lib/product-mentions.test.ts
git commit -m "feat(seo): server-gerenderte Produkt-Link-Box unter Posts (800+ Posts als Linkgeber für die Charts)"
```

---

### Task 19: RSS-Feed + llms.txt

Fixt Finding #46.

**Files:**
- Create: `app/feed.xml/route.ts`
- Create: `public/llms.txt`
- Modify: `app/layout.tsx` (rel=alternate-Link)
- Check/Modify: `middleware.ts` (Matcher darf `/feed.xml` nicht auf `/de/feed.xml` redirecten)

- [ ] **Step 1: Feed-Route anlegen**

```typescript
// app/feed.xml/route.ts
import { createAnonClient } from '@/lib/supabase/admin'
import { SITE_URL } from '@/lib/seo/site'
import { cleanMetaDescription } from '@/lib/i18n/metadata'

export const revalidate = 600

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** RSS 2.0 der letzten 50 veröffentlichten Posts (de) — Crawl-Frische-Signal
 *  für Google und Kanal für Feedreader/Aggregatoren. */
export async function GET() {
  const supabase = createAnonClient()
  const { data: posts } = await supabase
    .from('generated_posts')
    .select('title, slug, excerpt, created_at')
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(50)

  const items = (posts ?? [])
    .map(
      (p) => `
    <item>
      <title>${esc(p.title)}</title>
      <link>${SITE_URL}/de/posts/${p.slug}</link>
      <guid isPermaLink="true">${SITE_URL}/de/posts/${p.slug}</guid>
      <pubDate>${new Date(p.created_at).toUTCString()}</pubDate>${
        p.excerpt ? `\n      <description>${esc(cleanMetaDescription(p.excerpt, 300))}</description>` : ''
      }
    </item>`,
    )
    .join('')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Synthszr</title>
    <link>${SITE_URL}/de</link>
    <description>Die tägliche News-Synthese zu KI: Business, Design und Technologie.</description>
    <language>de</language>${items}
  </channel>
</rss>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
    },
  })
}
```

- [ ] **Step 2: Middleware-Matcher prüfen**

Run: `grep -n "matcher" middleware.ts`
Der Matcher muss Pfade mit Datei-Endung (Punkt) ausnehmen — Muster wie `'/((?!api|_next|.*\\..*).*)'`. Wenn `/feed.xml` NICHT ausgenommen ist (kein `.*\\..*`-Ausschluss), den Matcher entsprechend erweitern, sonst redirectet die Locale-Middleware den Feed auf `/de/feed.xml` (404).

- [ ] **Step 3: rel=alternate im Root-Layout**

In `app/layout.tsx` im `<head>` (nach den preconnect-Links):

```tsx
        <link rel="alternate" type="application/rss+xml" title="Synthszr RSS" href="https://www.synthszr.com/feed.xml" />
```

- [ ] **Step 4: llms.txt anlegen**

```
# public/llms.txt
# Synthszr — https://www.synthszr.com

> Synthszr ist die tägliche News-Synthese zu KI: Business, Design und Technologie.
> AI-generierte Tagesposts, die Synthszr Charts (tägliches Momentum-Ranking von
> AI-Produkten aus tausenden News-Quellen) und Company-Analysen.

## Wichtige Seiten
- Startseite (de): https://www.synthszr.com/de
- Synthszr Charts (AI-Produkt-Ranking): https://www.synthszr.com/de/rankings
- Archiv aller Posts: https://www.synthszr.com/de/archive
- Companies: https://www.synthszr.com/de/companies

## Feeds & Daten
- RSS: https://www.synthszr.com/feed.xml
- Sitemap: https://www.synthszr.com/sitemap.xml

## Sprachen
Deutsch (Original), Englisch, Tschechisch, Französisch, Plattdeutsch —
unter /{de,en,cs,fr,nds}/.
```

- [ ] **Step 5: Build + lokale Prüfung + Commit**

Run: `npm run build`
Expected: Route `/feed.xml` erscheint in der Build-Ausgabe.

```bash
git add app/feed.xml/route.ts public/llms.txt app/layout.tsx middleware.ts
git commit -m "feat(seo): RSS-Feed (/feed.xml) + llms.txt + rel=alternate im Head"
```

---

### Task 20: Rankings-Banner als WebP + Favicon-Preconnect

Fixt Findings #28 (konkreter Beleg), #43.

**Files:**
- Create: `scripts/convert-rankings-banner.ts` (Einmal-Script)
- Modify: `components/rankings/rankings-banner.tsx`
- Modify: `app/[lang]/rankings/page.tsx` + `app/[lang]/rankings/[slug]/page.tsx` (preconnect)

- [ ] **Step 1: Konvertierungs-Script (einmalig ausführen)**

```typescript
// scripts/convert-rankings-banner.ts
// Einmal-Script: PNG-Banner/Wordmark aus Vercel Blob laden, als WebP
// (lossless — Dithering-Art verliert bei lossy sichtbar) wieder hochladen.
// Benötigt BLOB_READ_WRITE_TOKEN (vercel env pull --environment=production).
import sharp from 'sharp'
import { put } from '@vercel/blob'

const ASSETS = [
  {
    src: 'https://lbrzdn804nhy3kox.public.blob.vercel-storage.com/rankings/synthszr-charts-banner-2x.png',
    dest: 'rankings/synthszr-charts-banner-2x.webp',
  },
  {
    src: 'https://lbrzdn804nhy3kox.public.blob.vercel-storage.com/rankings/synthszr-charts-wordmark-white.png',
    dest: 'rankings/synthszr-charts-wordmark-white.webp',
  },
]

for (const a of ASSETS) {
  const res = await fetch(a.src)
  if (!res.ok) throw new Error(`fetch ${a.src}: ${res.status}`)
  const png = Buffer.from(await res.arrayBuffer())
  const webp = await sharp(png).webp({ lossless: true }).toBuffer()
  const { url } = await put(a.dest, webp, { access: 'public', addRandomSuffix: false, contentType: 'image/webp' })
  console.log(`${a.dest}: ${png.length} B PNG → ${webp.length} B WebP → ${url}`)
}
```

Run: `vercel env pull .env.production.local --environment=production && npx tsx --env-file=.env.production.local scripts/convert-rankings-banner.ts`
Expected: Beide WebP-URLs geloggt, WebP deutlich kleiner als PNG. **Falls lossless kaum spart** (Dithering!), mit `{ quality: 90 }` (lossy) gegentesten und die kleinere, visuell saubere Variante nehmen.

- [ ] **Step 2: Banner-Komponente auf `<picture>` umstellen**

In `components/rankings/rankings-banner.tsx` — WebP-URLs ergänzen und beide `<img>` in `<picture>` wickeln:

```tsx
const BANNER_WEBP =
  'https://lbrzdn804nhy3kox.public.blob.vercel-storage.com/rankings/synthszr-charts-banner-2x.webp'
const WORDMARK_WEBP =
  'https://lbrzdn804nhy3kox.public.blob.vercel-storage.com/rankings/synthszr-charts-wordmark-white.webp'
```

Banner-img (bestehende Attribute unverändert übernehmen):

```tsx
      <picture>
        <source srcSet={BANNER_WEBP} type="image/webp" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={BANNER_URL}
          alt="Synthszr Charts — die großen AI-Marken im Wettkampf ums Podium"
          width={880}
          height={400}
          loading="eager"
          className="block w-full max-w-[880px] mx-auto h-auto"
        />
      </picture>
```

Wordmark-img analog mit `WORDMARK_WEBP`/`WORDMARK_URL`.

- [ ] **Step 3: Preconnect für den Google-Favicon-Service**

In `app/[lang]/rankings/page.tsx` und `app/[lang]/rankings/[slug]/page.tsx` (jeweils am Anfang der Page-Komponenten-Funktion, Muster wie `ReactDOM.preload` in der Posts-Seite):

```typescript
import ReactDOM from 'react-dom'
```

```typescript
  // 98 Vendor-Logos laden von google.com/s2/favicons (301 → t1.gstatic.com) —
  // Preconnect spart DNS+TLS für beide Origins vor dem ersten Icon-Fetch.
  ReactDOM.preconnect('https://www.google.com')
  ReactDOM.preconnect('https://t1.gstatic.com')
```

- [ ] **Step 4: Build + Commit**

```bash
npm run build
git add scripts/convert-rankings-banner.ts components/rankings/rankings-banner.tsx "app/[lang]/rankings/page.tsx" "app/[lang]/rankings/[slug]/page.tsx"
git commit -m "perf(rankings): Banner/Wordmark als WebP via picture-Fallback + Favicon-Preconnect"
```

---

### Task 21: Deploy, manuelle Schritte, Prod-Verifikation

Fixt Finding #34 (Apex-308, manuell) und verifiziert alles Vorherige auf Production.

- [ ] **Step 1: Push + Deploy abwarten**

```bash
git push origin main
```

Warten bis Vercel deployt hat (`vercel ls` oder Dashboard), dann verifizieren.

- [ ] **Step 2: Manuell — Vercel Domain-Redirect auf 308**

Vercel Dashboard → Projekt → Settings → Domains → `synthszr.com` → Redirect-Typ von 307 (Temporary) auf **308 (Permanent)** stellen. (Der `/`→`/de`-307 aus der Middleware bleibt bewusst — er ist geo-/cookie-variabel und semantisch korrekt.)

- [ ] **Step 3: Prod-Verifikations-Checkliste (curl)**

Jede Zeile muss das erwartete Ergebnis liefern:

```bash
# 1. Canonical + hreflang auf Rankings-Liste (Task 7)
curl -s https://www.synthszr.com/de/rankings | grep -o '<link rel="canonical"[^>]*>'
# → canonical auf https://www.synthszr.com/de/rankings
curl -s https://www.synthszr.com/de/rankings | grep -c 'hrefLang'
# → ≥ 6 (5 Sprachen + x-default)

# 2. Lokalisierter Title auf /en/rankings (Task 7)
curl -s https://www.synthszr.com/en/rankings | grep -o '<title>[^<]*</title>'
# → "Synthszr Charts — the daily AI product ranking"

# 3. H1 vorhanden (Task 7)
curl -s https://www.synthszr.com/de/rankings | grep -c '<h1'
# → 1

# 4. Produktseite: canonical, hreflang de/en, ISR-Cache (Task 8)
curl -s https://www.synthszr.com/de/rankings/openai-codex | grep -o '<link rel="canonical"[^>]*>'
# → canonical auf https://www.synthszr.com/de/rankings/openai-codex
curl -sI https://www.synthszr.com/de/rankings/openai-codex | grep -i 'x-vercel-cache\|cache-control'
curl -sI https://www.synthszr.com/de/rankings/openai-codex | grep -i 'x-vercel-cache'
# → kein "no-store" mehr; der 2. Request (zweite Zeile) liefert HIT oder STALE

# 5. Compare: noindex (Task 9)
curl -s https://www.synthszr.com/de/rankings/compare | grep -o '<meta name="robots"[^>]*>'
# → noindex

# 6. Sitemap enthält Rankings (Task 10)
curl -s https://www.synthszr.com/sitemap.xml | grep -c '/rankings'
# → > 4000

# 7. robots.txt ohne /_next und /newsletter (Task 4)
curl -s https://www.synthszr.com/robots.txt
# → nur /admin/, /api/, /login als Disallow

# 8. Newsletter noindex (Task 5)
curl -s https://www.synthszr.com/de/newsletter/preferences | grep -o '<meta name="robots"[^>]*>'
# → noindex

# 9. Homepage server-gerendert (Task 3)
# Hinweis: einzelne BAILOUT-Marker kleiner Suspense-Inseln (Language-Switcher,
# TipTap-Body) sind OK — entscheidend ist, dass der Seiten-Shell echtes HTML hat:
curl -s https://www.synthszr.com/de | grep -c 'href="/de/rankings"'
# → ≥ 1 (Hero + Footer)
curl -s https://www.synthszr.com/de | grep -c 'href="/de/posts/'
# → ≥ 1 (Last-7-Days-Links im HTML)

# 10. JSON-LD auf Rankings (Task 11)
curl -s https://www.synthszr.com/de/rankings | grep -c 'application/ld+json'
# → ≥ 1 (ItemList)
curl -s https://www.synthszr.com/de/rankings/openai-codex | grep -c 'application/ld+json'
# → ≥ 2 (SoftwareApplication + Breadcrumb)

# 11. Kein Tool-Call-Leak mehr sichtbar (Task 14)
curl -s https://www.synthszr.com/de/rankings/anthropic-claude-4-5-opus | grep -c '</description>'
# → 0

# 12. Feed + llms.txt (Task 19)
curl -s -o /dev/null -w '%{http_code}' https://www.synthszr.com/feed.xml   # → 200
curl -s -o /dev/null -w '%{http_code}' https://www.synthszr.com/llms.txt   # → 200

# 13. OG-Tags der Rankings auf www + v2 (Tasks 2/7)
curl -s https://www.synthszr.com/de/rankings | grep -o '<meta property="og:url"[^>]*>'
# → https://www.synthszr.com/de/rankings

# 14. Apex-Redirect nach Dashboard-Umstellung (Step 2)
curl -sI https://synthszr.com/ | head -1
# → HTTP/2 308

# 15. Posts: bereinigte Description (Task 12) — Stichprobe
curl -s "$(curl -s https://www.synthszr.com/sitemap.xml | grep -o '<loc>https://www.synthszr.com/de/posts/[^<]*' | head -1 | sed 's/<loc>//')" | grep -o '<meta name="description"[^>]*>'
# → ohne •, ≤ ~160 Zeichen
```

- [ ] **Step 4: Google Search Console (manuell)**

1. Sitemap neu einreichen (`https://www.synthszr.com/sitemap.xml`).
2. URL-Prüfung für `https://www.synthszr.com/de/rankings` → „Indexierung beantragen".
3. In 1–2 Wochen: Abdeckungsbericht auf die neuen ~4.200 Rankings-URLs prüfen.

---

## Findings-Abdeckungsmatrix

| Finding | Task | | Finding | Task |
|---|---|---|---|---|
| #1 Sitemap ohne Rankings | 10 | | #24 html lang SSR | deferred |
| #2 Kein canonical/hreflang Rankings | 7, 8, 9 | | #25 force-dynamic | 8 |
| #3 Meta nicht lokalisiert | 6, 7, 8 | | #26 Parameter-URLs unkanonisier | 7, 9 |
| #4 Orphan Pages | 10, 16, 17, 18 | | #27 robots /_next | 4 |
| #5 Facetten ohne canonical | 7 | | #28 Bild-Optimierung | 20 (+ deferred) |
| #6 sitemap.ts generiert nichts | 10 | | #29 kein H1/Intro | 7 |
| #7 generateLocalizedMetadata ungenutzt | 7, 8, 9 | | #30 Facetten-Duplikate | 7 |
| #8 force-dynamic TTFB | 8 | | #31 Posts ohne Produktlinks | 15, 18 |
| #9 Homepage leeres HTML | 3 | | #32 Companies-Silo | 17 |
| #10 1647/5000 verlinkt | 7 (all=1), 10, 16 | | #33 EN mit deutscher Meta | 6, 7, 8 |
| #11 hreflang fehlt | 7, 8, 10 | | #34 307-Redirects | 21 (Apex manuell) |
| #12 Newsletter indexierbar | 4, 5 | | #35 no-store Crawl-Budget | 8 |
| #13 OG-Fallback generisch | 2, 7, 8 | | #36 lastmod new Date() | 10 |
| #14 Compare-Meta | 9 | | #37 og-image v1/apex | 2 |
| #15 html lang="de" | deferred | | #38 Homepage-Description | 6 |
| #16 Description-Bullets | 12 | | #39 Article-Schema dünn | 2, 13 |
| #17 Title keyword-schwach | 6, 7 | | #40 Compare Thin Page | 9 |
| #18 Kein JSON-LD Rankings | 11 | | #41 JSON-LD-Potenzial | 11 |
| #19 WebSite-LD im Bailout | 3 | | #42 Root-OG non-www | 2 |
| #20 JSON-LD Apex-Host | 3, 13 | | #43 Favicon-Origins | 20 |
| #21 Tool-Call-Leak | 14 | | #44 Compare unverlinkt/Thin | 9 |
| #22 no-store Rankings | 8 | | #45 Footer ohne Charts-Link | 15 |
| #23 Sprach-Duplikate Rankings | 7, 8 | | #46 Kein RSS/llms.txt | 19 |
