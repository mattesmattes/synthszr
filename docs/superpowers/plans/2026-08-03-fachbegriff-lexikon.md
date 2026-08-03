# Fachbegriff-Lexikon — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fachbegriffe in Artikeln markieren und auf Lexikonseiten verlinken, deren LLM-generierter Erklärungstext ein 15-jähriger Gymnasiast versteht — SEO- und GEO-optimiert, mit News und Chart-Produkten als arrondierender Information.

**Architecture:** Begriffe leben in `glossary_terms`. Eine Phase `lexicon` in der bestehenden `article_jobs`-Queue erkennt Kandidaten (Ghostwriter-Tag + Server-Matcher) und generiert Slug, Text und optional eine Illustration. Der Redakteur bestätigt die Auswahl im Editor; beim Speichern schreibt der Server echte TipTap-Marks in das JSON, weshalb alle drei Ausgabepfade — Web, Newsletter, SSR-Fallback — die Links ohne eigene Erkennungslogik sehen. Das ist die Voraussetzung dafür, dass Crawler sie überhaupt finden.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Supabase/Postgres mit pgvector, TipTap, Vitest 4, Vercel Blob, `gpt-image-2` über die bestehende Dither-Pipeline.

**Spec:** `docs/superpowers/specs/2026-08-03-fachbegriff-lexikon-design.md`

## Global Constraints

- **Sprachen:** nur `de` und `en` in `hreflang` und Sitemap (entspricht `SEO_LOCALES`). `cs`/`nds`/`fr` zeigen den EN-Fallback.
- **DB-Migrationen** werden vom User im Supabase-SQL-Editor angewendet, nicht per CLI. Das Projekt ist nicht für `supabase db push` verlinkt.
- **Neue Tabellen:** RLS aktivieren, `revoke all` von `public`/`anon`/`authenticated`, `grant` nur an `service_role`. Neue Funktionen: `security invoker`, `set search_path = pg_catalog, public`, EXECUTE nur `service_role`.
- **Verifikation gegen Produktion** (`https://www.synthszr.com`), nicht gegen einen lokalen Dev-Server. Prod-Credentials via `vercel env pull /tmp/env.prod --environment=production`, danach löschen.
- **ISR:** jede Route mit `revalidate` braucht ein `generateStaticParams` — auch ein leeres. Ohne das ignoriert Vercel `revalidate`.
- **Egress:** Listen- und Sitemap-Queries selektieren nie JSONB-Spalten (`body`, `history`).
- **Route:** `/[lang]/glossary/[slug]`, `/[lang]/glossary`.
- **Link-Policy:** erste Erwähnung pro Begriff, max. 8 Begriffe pro Artikel. Kollision: Company > Chart-Produkt > Lexikonbegriff.
- **Testbefehl:** `npx vitest run <pfad>`. Tests liegen unter `tests/**/*.test.ts`, `environment: 'node'`.
- **Commit-Sprache:** englischer Präfix (`feat:`, `fix:`, `docs:`), Beschreibung deutsch — wie im bestehenden Log.

---

## File Structure

**Neu**

| Datei | Verantwortung |
|---|---|
| `lib/glossary/types.ts` | Gemeinsame Typen für alle Glossar-Module |
| `lib/glossary/mentions.ts` | Begriffe im Text finden (Matcher), `{lex:}`-Tags extrahieren |
| `lib/glossary/inject-marks.ts` | Idempotente Mark-Injektion in TipTap-JSON |
| `lib/glossary/terms.ts` | DB-Zugriff: Begriffsliste, CRUD, Status-Übergänge |
| `lib/glossary/detail.ts` | Seiten-Loader für Detail und Index, `cache()`-gewrappt |
| `lib/glossary/generate.ts` | LLM: Kandidaten, Slug, Erklärungstext, Produktzuordnung |
| `lib/tiptap/glossary-link-mark.ts` | TipTap-Mark-Definition |
| `app/[lang]/glossary/page.tsx` | Index-Seite |
| `app/[lang]/glossary/[slug]/page.tsx` | Detailseite |
| `components/glossary/related-terms.tsx` | Arrondierender Block: verwandte Begriffe |
| `components/glossary/term-news.tsx` | Arrondierender Block: News |
| `components/glossary/term-products.tsx` | Arrondierender Block: Chart-Produkte |
| `app/api/admin/glossary/route.ts` | Admin-CRUD, Revisions-Freigabe |
| `app/admin/glossary/page.tsx` | Begriffsverwaltung, offene Revisionen |
| `app/api/cron/glossary-news/route.ts` | Wöchentlicher News-Refresh |
| `app/api/cron/glossary-review/route.ts` | Aktualitätsprüfung |
| `supabase/migrations/20260803120000_glossary_schema.sql` | Vier Tabellen, RLS, Grants, Indizes |
| `supabase/migrations/20260803130000_glossary_news_rpc.sql` | `match_glossary_news` |

**Geändert**

| Datei | Änderung |
|---|---|
| `lib/gemini/image-generator.ts` | `generateGlossaryIllustration`, `generateRawImage` exportieren |
| `lib/article-jobs/service.ts` | Phase `lexicon` hinter `finalizing` |
| `lib/claude/ghostwriter-pipeline.ts` | `{lex:}`-Direktive im Prompt |
| `lib/tiptap/render-static-html.ts` | Mark rendern, `{lex:}` strippen |
| `lib/email/tiptap-to-html.ts` | Mark zu `<a>` |
| `components/tiptap-renderer.tsx` | Mark rendern |
| `components/tiptap-editor.tsx`, `components/tiptap-editor-with-patterns.tsx` | Mark registrieren |
| `app/api/admin/generated-posts/route.ts` | Mark-Injektion beim Speichern |
| `app/admin/generated-articles/edit/[id]/page.tsx` | Freigabe-Panel |
| `app/sitemap.ts` | Glossar-Einträge |
| `lib/i18n/default-translations.ts` | Neue UI-Labels |
| `vercel.json` | Zwei Cron-Einträge |

---

## Phase 1 — Fundament

### Task 1: Datenbank-Schema

**Files:**
- Create: `supabase/migrations/20260803120000_glossary_schema.sql`
- Create: `lib/glossary/types.ts`
- Test: `tests/lib/glossary-types.test.ts`

**Interfaces:**
- Produces: `GlossaryMatcherTerm`, `GlossaryTerm`, `GlossaryMention`, `GlossaryCandidate`, `GlossaryCandidateOrigin`, `GLOSSARY_MAX_PER_ARTICLE`

- [ ] **Step 1: Migration schreiben**

`supabase/migrations/20260803120000_glossary_schema.sql`:

```sql
-- Fachbegriff-Lexikon: Begriffe, Übersetzungen, Produkt- und News-Zuordnung.
-- Alle vier Tabellen sind service_role-only: die Lexikonseiten rendern
-- serverseitig mit createAdminClient(), anon braucht keinen Zugriff.

create table if not exists public.glossary_terms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  canonical_name text not null,
  aliases text[] not null default '{}',
  status text not null default 'draft'
    check (status in ('draft', 'published', 'hidden')),
  summary text not null default '',
  body jsonb,
  illustration_url text,
  illustration_alt text,
  embedding vector(1536),
  readability_score numeric,
  review_state text not null default 'ok'
    check (review_state in ('ok', 'flagged', 'revision_pending')),
  pending_body jsonb,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists glossary_terms_status_idx
  on public.glossary_terms (status);
create index if not exists glossary_terms_review_idx
  on public.glossary_terms (last_reviewed_at nulls first);

create table if not exists public.glossary_term_translations (
  term_id uuid not null references public.glossary_terms(id) on delete cascade,
  language text not null,
  canonical_name text not null,
  aliases text[] not null default '{}',
  summary text not null default '',
  body jsonb,
  updated_at timestamptz not null default now(),
  primary key (term_id, language)
);

create table if not exists public.glossary_term_products (
  term_id uuid not null references public.glossary_terms(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  relevance numeric not null default 0,
  source text not null default 'llm' check (source in ('llm', 'manual')),
  confirmed_at timestamptz,
  primary key (term_id, product_id)
);

-- Cache-Tabelle: ohne sie würde jede Lexikonseite bei jedem ISR-Revalidate
-- eine pgvector-Suche über daily_repo auslösen. Der Cron rechnet, die Seite
-- liest nur.
create table if not exists public.glossary_term_news (
  term_id uuid not null references public.glossary_terms(id) on delete cascade,
  repo_item_id uuid not null references public.daily_repo(id) on delete cascade,
  title text not null,
  source_name text,
  source_url text not null,
  published_at timestamptz,
  context_sentence text,
  similarity numeric,
  refreshed_at timestamptz not null default now(),
  primary key (term_id, repo_item_id)
);

create index if not exists glossary_term_news_term_idx
  on public.glossary_term_news (term_id, published_at desc);

-- Spalte für die Kandidatenliste bis zur redaktionellen Freigabe.
alter table public.generated_posts
  add column if not exists pending_glossary_terms jsonb;

-- RLS + Grants nach dem Muster aus docs/security/security-runbook.md § 5.
do $$
declare t text;
begin
  foreach t in array array[
    'glossary_terms', 'glossary_term_translations',
    'glossary_term_products', 'glossary_term_news'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke all on table public.%I from authenticated', t);
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;
```

> `foreach ... in array` ist PL/pgSQL-Syntax; falls die Supabase-Version das
> ablehnt, die vier Blöcke ausschreiben. Die Wirkung muss identisch sein.

- [ ] **Step 2: Typen-Test schreiben**

`tests/lib/glossary-types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { GLOSSARY_MAX_PER_ARTICLE } from '@/lib/glossary/types'

describe('glossary types', () => {
  it('caps glossary links per article at 8', () => {
    expect(GLOSSARY_MAX_PER_ARTICLE).toBe(8)
  })
})
```

- [ ] **Step 3: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/lib/glossary-types.test.ts`
Expected: FAIL, `Cannot find module '@/lib/glossary/types'`

- [ ] **Step 4: Typen anlegen**

`lib/glossary/types.ts`:

```ts
/** Obergrenze verlinkter Begriffe pro Artikel. Mehr macht den Text unlesbar. */
export const GLOSSARY_MAX_PER_ARTICLE = 8

/** Mindestlänge eines Begriffsnamens für den Matcher. Kürzere erzeugen zu
 *  viele False Positives (gleiche Schwelle wie bei Chart-Produkten). */
export const GLOSSARY_MIN_NAME_LENGTH = 4

export type GlossaryStatus = 'draft' | 'published' | 'hidden'
export type GlossaryReviewState = 'ok' | 'flagged' | 'revision_pending'
export type GlossaryCandidateOrigin = 'tag' | 'match' | 'new'

/** Minimalform für den Matcher — bewusst ohne body/embedding, damit die
 *  Begriffsliste schmal geladen werden kann. */
export interface GlossaryMatcherTerm {
  slug: string
  canonicalName: string
  aliases: string[]
}

export interface GlossaryTerm extends GlossaryMatcherTerm {
  id: string
  status: GlossaryStatus
  summary: string
  body: unknown
  illustrationUrl: string | null
  illustrationAlt: string | null
}

export interface GlossaryMention {
  slug: string
  /** Die tatsächlich im Text gefundene Schreibweise. */
  matchedText: string
}

export interface GlossaryCandidate {
  slug: string
  name: string
  origin: GlossaryCandidateOrigin
  summary: string
}
```

- [ ] **Step 5: Test laufen lassen — muss bestehen**

Run: `npx vitest run tests/lib/glossary-types.test.ts`
Expected: PASS

- [ ] **Step 6: Migration vom User anwenden lassen**

Den Inhalt der Migration als reinen SQL-Block ausgeben — ohne umgebende Prosa,
weil ein versehentlich mitkopierter Erklärungssatz im SQL-Editor als
`syntax error` endet. Anschließend Verifikation:

```bash
vercel env pull /tmp/env.prod --environment=production
node --env-file=/tmp/env.prod -e "
const { createClient } = require('@supabase/supabase-js')
;(async () => {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  for (const t of ['glossary_terms','glossary_term_translations','glossary_term_products','glossary_term_news']) {
    const { count, error } = await anon.from(t).select('*', { count: 'exact', head: true })
    console.log(t, error ? 'blockiert: ' + error.message : count + ' Zeilen sichtbar')
  }
})()"
rm -f /tmp/env.prod
```

Expected: alle vier `blockiert: permission denied`. Zeilen sehen ist ein Fehler.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260803120000_glossary_schema.sql lib/glossary/types.ts tests/lib/glossary-types.test.ts
git commit -m "feat(glossary): Schema und Basistypen für das Fachbegriff-Lexikon"
```

---

### Task 2: Begriffs-Matcher

**Files:**
- Create: `lib/glossary/mentions.ts`
- Test: `tests/lib/glossary-mentions.test.ts`

**Interfaces:**
- Consumes: `GlossaryMatcherTerm`, `GlossaryMention`, `GLOSSARY_MIN_NAME_LENGTH` aus `lib/glossary/types.ts`
- Produces:
  - `findGlossaryMentions(text: string, terms: GlossaryMatcherTerm[], max?: number): GlossaryMention[]`
  - `extractLexTags(content: unknown): string[]`
  - `stripLexTags(text: string): string`

- [ ] **Step 1: Failing Test schreiben**

`tests/lib/glossary-mentions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { findGlossaryMentions, extractLexTags, stripLexTags } from '@/lib/glossary/mentions'
import type { GlossaryMatcherTerm } from '@/lib/glossary/types'

const terms: GlossaryMatcherTerm[] = [
  { slug: 'mixture-of-experts', canonicalName: 'Mixture of Experts', aliases: ['MoE', 'Mixture-of-Experts'] },
  { slug: 'inferenz', canonicalName: 'Inferenz', aliases: ['Inferenzkosten'] },
  { slug: 'rag', canonicalName: 'RAG', aliases: [] },
]

describe('findGlossaryMentions', () => {
  it('findet den kanonischen Namen case-insensitive', () => {
    const hits = findGlossaryMentions('Das Modell nutzt mixture of experts.', terms)
    expect(hits.map(h => h.slug)).toEqual(['mixture-of-experts'])
  })

  it('findet Aliasse', () => {
    const hits = findGlossaryMentions('Ein MoE-Modell skaliert besser.', terms)
    expect(hits.map(h => h.slug)).toEqual(['mixture-of-experts'])
  })

  it('respektiert Wortgrenzen mit Umlauten und Komposita', () => {
    const hits = findGlossaryMentions('Die Inferenzkosten sinken.', terms)
    expect(hits.map(h => h.slug)).toEqual(['inferenz'])
  })

  it('matcht nicht innerhalb eines Wortes', () => {
    expect(findGlossaryMentions('Ragout kochen', terms)).toEqual([])
  })

  it('überspringt Namen unter der Mindestlänge', () => {
    expect(findGlossaryMentions('Wir nutzen RAG dafür.', terms).map(h => h.slug)).toEqual([])
  })

  it('meldet jeden Begriff nur einmal', () => {
    const hits = findGlossaryMentions('Inferenz hier, Inferenz dort.', terms)
    expect(hits).toHaveLength(1)
  })

  it('begrenzt auf max', () => {
    const hits = findGlossaryMentions('Inferenz und Mixture of Experts.', terms, 1)
    expect(hits).toHaveLength(1)
  })
})

describe('extractLexTags', () => {
  it('liest Begriffsnamen aus {lex:...}-Direktiven im TipTap-Baum', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Ein {lex:Mixture of Experts}-Modell und {lex:Inferenz}.' }],
      }],
    }
    expect(extractLexTags(doc)).toEqual(['Mixture of Experts', 'Inferenz'])
  })

  it('liefert bei fehlenden Tags ein leeres Array', () => {
    expect(extractLexTags({ type: 'doc', content: [] })).toEqual([])
  })
})

describe('stripLexTags', () => {
  it('entfernt die Direktive und behält den Begriff', () => {
    expect(stripLexTags('Ein {lex:Mixture of Experts}-Modell.')).toBe('Ein Mixture of Experts-Modell.')
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/lib/glossary-mentions.test.ts`
Expected: FAIL, `Cannot find module '@/lib/glossary/mentions'`

- [ ] **Step 3: Implementieren**

`lib/glossary/mentions.ts`:

```ts
import { extractVisibleText } from '@/lib/posts/product-mentions'
import { GLOSSARY_MIN_NAME_LENGTH } from '@/lib/glossary/types'
import type { GlossaryMatcherTerm, GlossaryMention } from '@/lib/glossary/types'

/** `{lex:Begriff}` — der Begriff darf Leerzeichen und Bindestriche enthalten,
 *  aber keine geschweiften Klammern. */
const LEX_TAG_RE = /\{lex:([^{}]+)\}/g

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Wortgrenzen über Unicode-Klassen statt \b: \b bricht bei Umlauten und
 *  deutschen Komposita („Inferenzkosten" soll „Inferenz" treffen, „Ragout"
 *  aber nicht „RAG"). Dasselbe Muster wie in lib/posts/product-mentions.ts. */
function boundaryRegex(name: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegex(name)})`, 'iu')
}

/**
 * Findet Lexikonbegriffe im Text — pro Begriff maximal ein Treffer, in der
 * Reihenfolge der übergebenen Begriffsliste. Namen unter
 * GLOSSARY_MIN_NAME_LENGTH werden übersprungen.
 */
export function findGlossaryMentions(
  text: string,
  terms: GlossaryMatcherTerm[],
  max = Number.MAX_SAFE_INTEGER,
): GlossaryMention[] {
  const hits: GlossaryMention[] = []
  for (const term of terms) {
    if (hits.length >= max) break
    const names = [term.canonicalName, ...term.aliases]
      .filter((n) => n.length >= GLOSSARY_MIN_NAME_LENGTH)
      // Längste zuerst: „Mixture-of-Experts" vor „Mixture of Experts".
      .sort((a, b) => b.length - a.length)
    for (const name of names) {
      const m = boundaryRegex(name).exec(text)
      if (m) {
        hits.push({ slug: term.slug, matchedText: m[2] })
        break
      }
    }
  }
  return hits
}

/** Liest die Begriffsnamen aus allen `{lex:...}`-Direktiven eines
 *  TipTap-Dokuments, in Reihenfolge des Auftretens, ohne Duplikate. */
export function extractLexTags(content: unknown): string[] {
  const text = extractVisibleText(content)
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(LEX_TAG_RE)) {
    const name = m[1].trim()
    if (name && !seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

/** Entfernt die Direktiv-Klammern, behält den Begriff im Fließtext. */
export function stripLexTags(text: string): string {
  return text.replace(LEX_TAG_RE, '$1')
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npx vitest run tests/lib/glossary-mentions.test.ts`
Expected: PASS, 10 Tests

- [ ] **Step 5: Commit**

```bash
git add lib/glossary/mentions.ts tests/lib/glossary-mentions.test.ts
git commit -m "feat(glossary): Begriffs-Matcher mit Unicode-Wortgrenzen und {lex:}-Tags"
```

---

### Task 3: TipTap-Mark und Mark-Injektion

**Files:**
- Create: `lib/tiptap/glossary-link-mark.ts`
- Create: `lib/glossary/inject-marks.ts`
- Test: `tests/lib/glossary-inject-marks.test.ts`

**Interfaces:**
- Consumes: `findGlossaryMentions` aus Task 2, `GlossaryMatcherTerm`, `GLOSSARY_MAX_PER_ARTICLE`
- Produces:
  - `GlossaryLinkMark` (TipTap-Mark-Extension, `name: 'glossaryLink'`, `attrs: { slug }`)
  - `injectGlossaryMarks(content: unknown, slugs: string[], terms: GlossaryMatcherTerm[], opts?: { reserved?: string[] }): unknown`

> `opts.reserved` nimmt Company- und Chart-Produktnamen auf. Die Kollisionsregel
> lässt sich nicht über eine bestehende Mark prüfen: Produkt- und
> Company-Verlinkung laufen client-seitig im DOM, im gespeicherten JSON gibt es
> dafür keine Mark.

- [ ] **Step 1: Failing Test schreiben**

`tests/lib/glossary-inject-marks.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { injectGlossaryMarks } from '@/lib/glossary/inject-marks'
import type { GlossaryMatcherTerm } from '@/lib/glossary/types'

const terms: GlossaryMatcherTerm[] = [
  { slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] },
  { slug: 'moe', canonicalName: 'Mixture of Experts', aliases: ['MoE'] },
]

function doc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

/** Sammelt alle Textknoten mit glossaryLink-Mark, flach. */
function linked(node: unknown): Array<{ text: string; slug: string }> {
  const out: Array<{ text: string; slug: string }> = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    const marks = Array.isArray(o.marks) ? o.marks : []
    const mark = marks.find((m) => (m as { type?: string }).type === 'glossaryLink')
    if (typeof o.text === 'string' && mark) {
      out.push({ text: o.text, slug: (mark as { attrs: { slug: string } }).attrs.slug })
    }
    if (Array.isArray(o.content)) o.content.forEach(walk)
  }
  walk(node)
  return out
}

describe('injectGlossaryMarks', () => {
  it('verlinkt einen bestätigten Begriff', () => {
    const out = injectGlossaryMarks(doc('Die Inferenz ist teuer.'), ['inferenz'], terms)
    expect(linked(out)).toEqual([{ text: 'Inferenz', slug: 'inferenz' }])
  })

  it('verlinkt nur die erste Erwähnung', () => {
    const out = injectGlossaryMarks(doc('Inferenz hier, Inferenz dort.'), ['inferenz'], terms)
    expect(linked(out)).toHaveLength(1)
  })

  it('verlinkt nicht bestätigte Begriffe nicht', () => {
    const out = injectGlossaryMarks(doc('Ein MoE-Modell nutzt Inferenz.'), ['inferenz'], terms)
    expect(linked(out).map(l => l.slug)).toEqual(['inferenz'])
  })

  it('ist idempotent — zweimal ausgeführt ändert nichts', () => {
    const once = injectGlossaryMarks(doc('Die Inferenz ist teuer.'), ['inferenz'], terms)
    const twice = injectGlossaryMarks(once, ['inferenz'], terms)
    expect(twice).toEqual(once)
  })

  it('entfernt Marks, deren Begriff nicht mehr bestätigt ist', () => {
    const once = injectGlossaryMarks(doc('Die Inferenz ist teuer.'), ['inferenz'], terms)
    const cleared = injectGlossaryMarks(once, [], terms)
    expect(linked(cleared)).toEqual([])
  })

  it('verlinkt nicht innerhalb eines bestehenden Links', () => {
    const withLink = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text', text: 'Inferenz',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        }],
      }],
    }
    expect(linked(injectGlossaryMarks(withLink, ['inferenz'], terms))).toEqual([])
  })

  it('überlässt kollidierende Namen der Company- und Produkt-Verlinkung', () => {
    // Kollisionsregel: spezifisch vor generisch. „Cursor" ist ein
    // Chart-Produkt — auch wenn es als Begriff existiert, darf das Lexikon
    // es nicht verlinken.
    const collide: GlossaryMatcherTerm[] = [
      { slug: 'cursor', canonicalName: 'Cursor', aliases: [] },
    ]
    const out = injectGlossaryMarks(
      doc('Cursor wächst schnell.'), ['cursor'], collide, { reserved: ['Cursor'] },
    )
    expect(linked(out)).toEqual([])
  })

  it('behält andere Marks am verlinkten Text', () => {
    const bold = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Inferenz', marks: [{ type: 'bold' }] }],
      }],
    }
    const out = injectGlossaryMarks(bold, ['inferenz'], terms) as {
      content: Array<{ content: Array<{ marks: Array<{ type: string }> }> }>
    }
    expect(out.content[0].content[0].marks.map(m => m.type).sort()).toEqual(['bold', 'glossaryLink'])
  })

  it('begrenzt auf GLOSSARY_MAX_PER_ARTICLE', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      slug: `t${i}`, canonicalName: `Begriff${i}`, aliases: [],
    }))
    const text = many.map(t => t.canonicalName).join(' und ')
    const out = injectGlossaryMarks(doc(text), many.map(t => t.slug), many)
    expect(linked(out)).toHaveLength(8)
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/lib/glossary-inject-marks.test.ts`
Expected: FAIL, `Cannot find module '@/lib/glossary/inject-marks'`

- [ ] **Step 3: Mark-Extension anlegen**

`lib/tiptap/glossary-link-mark.ts`:

```ts
import { Mark, mergeAttributes } from '@tiptap/core'

/**
 * Mark für Lexikon-Verlinkungen. Wird serverseitig injiziert
 * (lib/glossary/inject-marks.ts), nicht vom Nutzer gesetzt — muss aber im
 * Editor registriert sein, sonst verwirft TipTap sie beim Laden und der Link
 * verschwindet beim nächsten Speichern.
 */
export const GlossaryLinkMark = Mark.create({
  name: 'glossaryLink',

  addAttributes() {
    return {
      slug: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-glossary-slug'),
        renderHTML: (attrs) =>
          attrs.slug ? { 'data-glossary-slug': attrs.slug as string } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'a[data-glossary-slug]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const slug = HTMLAttributes['data-glossary-slug']
    return ['a', mergeAttributes(HTMLAttributes, {
      href: `/de/glossary/${slug}`,
      class: 'glossary-link',
    }), 0]
  },
})
```

- [ ] **Step 4: Injektion implementieren**

`lib/glossary/inject-marks.ts`:

```ts
import { GLOSSARY_MAX_PER_ARTICLE } from '@/lib/glossary/types'
import type { GlossaryMatcherTerm } from '@/lib/glossary/types'

const MARK_TYPE = 'glossaryLink'

type Node = Record<string, unknown>

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Erste Erwähnung eines Namens in einem Textknoten, mit Unicode-Wortgrenze. */
function findFirst(text: string, name: string): { start: number; end: number } | null {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegex(name)})`, 'iu')
  const m = re.exec(text)
  if (!m) return null
  const start = m.index + m[1].length
  return { start, end: start + m[2].length }
}

function hasMark(node: Node, type: string): boolean {
  return Array.isArray(node.marks) &&
    node.marks.some((m) => (m as { type?: string }).type === type)
}

/** Entfernt alle glossaryLink-Marks — Grundlage der Idempotenz. */
function stripMarks(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node
  const o = { ...(node as Node) }
  if (Array.isArray(o.marks)) {
    const kept = o.marks.filter((m) => (m as { type?: string }).type !== MARK_TYPE)
    if (kept.length > 0) o.marks = kept
    else delete o.marks
  }
  if (Array.isArray(o.content)) o.content = o.content.map(stripMarks)
  return o
}

/**
 * Schreibt glossaryLink-Marks für die bestätigten Slugs in das TipTap-JSON.
 *
 * Idempotent: bestehende Marks werden zuerst entfernt und neu gesetzt. Damit
 * ist mehrfaches Speichern unschädlich, und nach einer Übersetzung genügt ein
 * erneuter Lauf mit der übersetzten Begriffsliste — die Marks müssen nicht
 * durch die Übersetzung getragen werden.
 *
 * Pro Begriff wird nur die erste Erwähnung verlinkt, insgesamt maximal
 * GLOSSARY_MAX_PER_ARTICLE Begriffe. Text, der schon eine `link`-Mark trägt
 * (Quellenlink) oder bereits Company-/Produkt-verlinkt ist, wird übersprungen.
 */
export function injectGlossaryMarks(
  content: unknown,
  slugs: string[],
  terms: GlossaryMatcherTerm[],
  opts: { reserved?: string[] } = {},
): unknown {
  const cleaned = stripMarks(content)
  // `reserved` sind Company- und Chart-Produktnamen. Die Kollisionsregel kann
  // NICHT über eine bestehende Mark geprüft werden: die Produkt- und
  // Company-Verlinkung läuft client-seitig im DOM, im gespeicherten JSON
  // existiert dafür keine Mark. Also wird die Namensliste übergeben.
  const reserved = new Set((opts.reserved ?? []).map((n) => n.toLowerCase()))
  const wanted = terms
    .filter((t) => slugs.includes(t.slug))
    .filter((t) => !reserved.has(t.canonicalName.toLowerCase()))
    .slice(0, GLOSSARY_MAX_PER_ARTICLE)
  if (wanted.length === 0) return cleaned

  const done = new Set<string>()

  const walk = (node: unknown): unknown => {
    if (!node || typeof node !== 'object') return node
    const o = node as Node

    if (typeof o.text === 'string') {
      // Quellenlinks gewinnen — in einen bestehenden <a> darf kein zweiter
      // Link geschachtelt werden.
      if (hasMark(o, 'link')) return o

      for (const term of wanted) {
        if (done.has(term.slug)) continue
        const names = [term.canonicalName, ...term.aliases]
          .sort((a, b) => b.length - a.length)
        for (const name of names) {
          const pos = findFirst(o.text as string, name)
          if (!pos) continue
          done.add(term.slug)
          const before = (o.text as string).slice(0, pos.start)
          const hit = (o.text as string).slice(pos.start, pos.end)
          const after = (o.text as string).slice(pos.end)
          const baseMarks = Array.isArray(o.marks) ? o.marks : []
          const parts: Node[] = []
          if (before) parts.push({ ...o, text: before })
          parts.push({
            ...o,
            text: hit,
            marks: [...baseMarks, { type: MARK_TYPE, attrs: { slug: term.slug } }],
          })
          if (after) parts.push(walk({ ...o, text: after }) as Node)
          return parts
        }
      }
      return o
    }

    if (Array.isArray(o.content)) {
      // flat(), weil ein Textknoten zu mehreren Knoten aufgeteilt werden kann.
      return { ...o, content: o.content.map(walk).flat() }
    }
    return o
  }

  return walk(cleaned)
}
```

- [ ] **Step 5: Test laufen lassen — muss bestehen**

Run: `npx vitest run tests/lib/glossary-inject-marks.test.ts`
Expected: PASS, 8 Tests

- [ ] **Step 6: Commit**

```bash
git add lib/tiptap/glossary-link-mark.ts lib/glossary/inject-marks.ts tests/lib/glossary-inject-marks.test.ts
git commit -m "feat(glossary): TipTap-Mark und idempotente Mark-Injektion"
```

---

### Task 4: Alle Ausgabepfade

Der kritischste Task. Fehlt eine Stelle, bricht es still — im schlimmsten Fall
verschwindet der komplette Artikel aus dem Prerender-HTML.

**Files:**
- Modify: `lib/tiptap/render-static-html.ts`
- Modify: `lib/email/tiptap-to-html.ts`
- Modify: `components/tiptap-renderer.tsx`
- Modify: `components/tiptap-editor.tsx`, `components/tiptap-editor-with-patterns.tsx`
- Test: `tests/lib/glossary-render-paths.test.ts`

**Interfaces:**
- Consumes: `GlossaryLinkMark` aus Task 3

- [ ] **Step 1: Failing Test schreiben**

`tests/lib/glossary-render-paths.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { renderStaticHtml } from '@/lib/tiptap/render-static-html'

const withGlossary = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Die ' },
      { type: 'text', text: 'Inferenz', marks: [{ type: 'glossaryLink', attrs: { slug: 'inferenz' } }] },
      { type: 'text', text: ' ist teuer.' },
    ],
  }],
}

describe('render-static-html mit glossaryLink', () => {
  it('rendert den Link im ausgelieferten HTML', () => {
    const html = renderStaticHtml(withGlossary)
    expect(html).toContain('/glossary/inferenz')
    expect(html).toContain('Inferenz')
  })

  it('verliert den umgebenden Text nicht', () => {
    const html = renderStaticHtml(withGlossary)
    expect(html).toContain('ist teuer')
  })

  it('entfernt {lex:}-Direktiven', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ein {lex:Inferenz}-Problem.' }] }],
    }
    const html = renderStaticHtml(doc)
    expect(html).not.toContain('{lex:')
    expect(html).toContain('Inferenz')
  })

  it('rendert einen Artikel ohne Glossarbegriffe unverändert', () => {
    const plain = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nur Text.' }] }],
    }
    expect(renderStaticHtml(plain)).toContain('Nur Text.')
  })
})
```

> Den tatsächlichen Export-Namen aus `lib/tiptap/render-static-html.ts` vor dem
> Schreiben prüfen und im Test verwenden — die Datei existiert bereits.

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/lib/glossary-render-paths.test.ts`
Expected: FAIL — der Link fehlt im HTML, weil die Mark unbekannt ist.

- [ ] **Step 3: SSR-Fallback erweitern**

In `lib/tiptap/render-static-html.ts` die Mark im Mark-Handling ergänzen:

```ts
// glossaryLink: sprachneutraler Pfad, die Route redirected /glossary auf die
// aktive Sprache. Diese Datei ist der Pfad, den Crawler sehen — ohne diesen
// Zweig fehlt der Link im ausgelieferten HTML, und das SEO-Ziel des Lexikons
// ist nicht erreichbar.
if (mark.type === 'glossaryLink' && mark.attrs?.slug) {
  return `<a href="/glossary/${escapeHtml(String(mark.attrs.slug))}" class="glossary-link">${inner}</a>`
}
```

Zusätzlich den `{...}`-Strip in Zeile 44 so anpassen, dass `{lex:Begriff}` zum
Begriff wird statt komplett zu verschwinden — `stripLexTags` aus Task 2 **vor**
dem generischen Strip anwenden.

- [ ] **Step 4: E-Mail-Pfad erweitern**

In `lib/email/tiptap-to-html.ts` analog:

```ts
if (mark.type === 'glossaryLink' && mark.attrs?.slug) {
  // Absolute URL: relative Pfade funktionieren in E-Mail-Clients nicht.
  return `<a href="${SITE_URL}/${lang}/glossary/${mark.attrs.slug}" style="${LINK_STYLE}">${inner}</a>`
}
```

`sanitizeHtmlForEmail` muss nicht erweitert werden — `a` ist erlaubt. Den
`{lex:}`-Strip auch hier ergänzen.

- [ ] **Step 5: Web-Renderer und Editor**

`components/tiptap-renderer.tsx`: Mark rendert als `next/link` auf
`/${lang}/glossary/${slug}`.

`components/tiptap-editor.tsx` und `components/tiptap-editor-with-patterns.tsx`:
`GlossaryLinkMark` in das `extensions`-Array aufnehmen. Ohne das verwirft der
Editor die Marks beim Laden.

- [ ] **Step 6: Tests laufen lassen — müssen bestehen**

Run: `npx vitest run tests/lib/glossary-render-paths.test.ts`
Expected: PASS, 4 Tests

- [ ] **Step 7: Gesamte Suite laufen lassen**

Run: `npx vitest run`
Expected: PASS. Besonders auf E-Mail- und Renderer-Tests achten — sie decken die
geänderten Dateien ab.

- [ ] **Step 8: Commit**

```bash
git add lib/tiptap/render-static-html.ts lib/email/tiptap-to-html.ts components/tiptap-renderer.tsx components/tiptap-editor.tsx components/tiptap-editor-with-patterns.tsx tests/lib/glossary-render-paths.test.ts
git commit -m "feat(glossary): glossaryLink in allen vier Ausgabepfaden rendern"
```

---

## Phase 2 — Lexikonseite

### Task 5: Begriffs-Repository und Seiten-Loader

**Files:**
- Create: `lib/glossary/terms.ts`
- Create: `lib/glossary/detail.ts`
- Test: `tests/lib/glossary-terms.test.ts`

**Interfaces:**
- Produces:
  - `getMatcherTerms(lang: string): Promise<GlossaryMatcherTerm[]>`
  - `getGlossaryTerm(slug: string, lang: string): Promise<GlossaryTermDetail | null>`
  - `getPublishedTermList(lang: string): Promise<Array<{ slug, canonicalName, summary }>>`
  - `GlossaryTermDetail` = `GlossaryTerm & { relatedTerms, products, news }`

- [ ] **Step 1: Failing Test schreiben**

`tests/lib/glossary-terms.test.ts` — Supabase-Client mocken, prüfen dass die
Listen-Query **keine** `body`-Spalte selektiert:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ select: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: (cols: string) => {
        mocks.select(cols)
        return {
          eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
          order: () => Promise.resolve({ data: [], error: null }),
        }
      },
    }),
  }),
}))

describe('getPublishedTermList', () => {
  beforeEach(() => mocks.select.mockClear())

  it('selektiert kein body-JSONB', async () => {
    const { getPublishedTermList } = await import('@/lib/glossary/terms')
    await getPublishedTermList('de')
    const cols = mocks.select.mock.calls[0][0]
    expect(cols).not.toContain('body')
    expect(cols).toContain('slug')
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/lib/glossary-terms.test.ts`
Expected: FAIL, Modul fehlt

- [ ] **Step 3: Repository implementieren**

`lib/glossary/terms.ts` — schmale Selects, Übersetzung via
`glossary_term_translations` mit Fallback auf die deutsche Basiszeile:

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import type { GlossaryMatcherTerm } from '@/lib/glossary/types'

/** Spaltenliste für Listen-Queries. Ohne body/embedding — wide JSONB-Selects
 *  in Listen-Queries waren die Ursache des 109-GB-Egress-Overage. */
const LIST_COLUMNS = 'slug, canonical_name, summary'

export async function getPublishedTermList(lang: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('glossary_terms')
    .select(LIST_COLUMNS)
    .eq('status', 'published')
    .order('canonical_name')
  if (error) {
    console.error('[Glossary] getPublishedTermList:', error.message)
    return []
  }
  const rows = (data ?? []).map((r) => ({
    slug: r.slug as string,
    canonicalName: r.canonical_name as string,
    summary: r.summary as string,
  }))
  return lang === 'de' ? rows : applyTranslations(rows, lang)
}

export async function getMatcherTerms(lang: string): Promise<GlossaryMatcherTerm[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('glossary_terms')
    .select('id, slug, canonical_name, aliases')
    .eq('status', 'published')
  if (error) {
    console.error('[Glossary] getMatcherTerms:', error.message)
    return []
  }
  const base = (data ?? []).map((r) => ({
    id: r.id as string,
    slug: r.slug as string,
    canonicalName: r.canonical_name as string,
    aliases: (r.aliases ?? []) as string[],
  }))
  if (lang === 'de') return base.map(({ id: _id, ...t }) => t)

  // Für die Verlinkung im übersetzten Artikel zählen die Namen der Zielsprache.
  const { data: tr } = await supabase
    .from('glossary_term_translations')
    .select('term_id, canonical_name, aliases')
    .eq('language', lang)
  const byId = new Map((tr ?? []).map((t) => [t.term_id as string, t]))
  return base.map((t) => {
    const t9n = byId.get(t.id)
    return {
      slug: t.slug,
      canonicalName: (t9n?.canonical_name as string) ?? t.canonicalName,
      aliases: ((t9n?.aliases ?? t.aliases) ?? []) as string[],
    }
  })
}

/** Überschreibt Name und Summary mit der Übersetzung, wo eine existiert.
 *  Fehlt sie, bleibt die deutsche Fassung stehen — besser als eine Lücke. */
async function applyTranslations<T extends { slug: string }>(
  rows: T[],
  lang: string,
): Promise<T[]> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('glossary_term_translations')
    .select('term_id, canonical_name, summary, glossary_terms!inner(slug)')
    .eq('language', lang)
  const bySlug = new Map(
    (data ?? []).map((t) => [
      (t.glossary_terms as unknown as { slug: string }).slug,
      t,
    ]),
  )
  return rows.map((r) => {
    const t9n = bySlug.get(r.slug)
    if (!t9n) return r
    return {
      ...r,
      canonicalName: (t9n.canonical_name as string) ?? (r as never),
      summary: (t9n.summary as string) ?? (r as never),
    }
  })
}
```

`lib/glossary/detail.ts`:

```ts
import { cache } from 'react'

/** cache() verhindert, dass generateMetadata und die Page dieselbe Query
 *  zweimal absetzen — das verdoppelt sonst den Egress pro Seitenaufruf. */
export const getGlossaryTerm = cache(async (slug: string, lang: string) => {
  // Begriff + verwandte Begriffe + Produkte + News in vier schmalen Queries
})
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npx vitest run tests/lib/glossary-terms.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/glossary/terms.ts lib/glossary/detail.ts tests/lib/glossary-terms.test.ts
git commit -m "feat(glossary): Repository und Seiten-Loader mit schmalen Selects"
```

---

### Task 6: Detailseite

**Files:**
- Create: `app/[lang]/glossary/[slug]/page.tsx`
- Create: `components/glossary/related-terms.tsx`, `term-products.tsx`, `term-news.tsx`
- Test: manuell gegen Produktion

**Interfaces:**
- Consumes: `getGlossaryTerm` aus Task 5

- [ ] **Step 1: Seite anlegen**

Aufbau nach `app/[lang]/rankings/[slug]/page.tsx`:

```tsx
export const revalidate = 900

// Leeres generateStaticParams aktiviert on-demand ISR: ohne diese Funktion
// behandelt Vercel Dynamic-Segment-Routen als voll dynamisch und ignoriert
// revalidate (in Prod verifiziert, vgl. rankings/[slug]/page.tsx:32-34).
export async function generateStaticParams() {
  return []
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang, slug } = await params
  const term = await getGlossaryTerm(slug, lang)
  if (!term) return { title: 'Begriff nicht gefunden', robots: { index: false, follow: false } }
  return generateLocalizedMetadata({
    title: `${term.canonicalName} — einfach erklärt | Synthszr Lexikon`,
    description: term.summary,
    path: `/glossary/${slug}`,
    locale: lang as LanguageCode,
    availableLocales: ['de', 'en'],
  })
}
```

- [ ] **Step 2: HTML-Reihenfolge einhalten**

H1 → `summary` als Lead → Illustration → Erklärungstext (volle Breite) →
Trennung → arrondierende Blöcke. Die Reihenfolge ist GEO-relevant, nicht nur
optisch: LLMs zitieren den ersten substanziellen Textblock.

- [ ] **Step 3: JSON-LD ergänzen**

```tsx
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'DefinedTerm',
  name: term.canonicalName,
  description: term.summary,
  url: `${SITE_URL}/${lang}/glossary/${slug}`,
  inDefinedTermSet: {
    '@type': 'DefinedTermSet',
    name: 'Synthszr Lexikon',
    url: `${SITE_URL}/${lang}/glossary`,
  },
}
```

Ausgabe über `safeJsonLd` aus `lib/seo/site.ts`.

- [ ] **Step 4: Arrondierende Komponenten**

Drei Server-Komponenten, visuell zurückgenommen (kleinere Typo, gedämpfte
Farben), jede rendert nichts bei leeren Daten.

- [ ] **Step 5: Testbegriff anlegen und gegen Prod verifizieren**

Einen Begriff per SQL einfügen (`status = 'published'`), deployen, dann:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://www.synthszr.com/de/glossary/<slug>
curl -sI https://www.synthszr.com/de/glossary/<slug> | grep -i x-vercel-cache
curl -s https://www.synthszr.com/de/glossary/<slug> | grep -c 'DefinedTerm'
```

Expected: 200; beim zweiten Aufruf `HIT` oder `STALE` (beweist, dass ISR greift
— `MISS` bei jedem Aufruf heißt, `generateStaticParams` fehlt); JSON-LD 1×.

- [ ] **Step 6: Commit**

```bash
git add app/\[lang\]/glossary components/glossary
git commit -m "feat(glossary): Lexikon-Detailseite mit ISR und DefinedTerm-Schema"
```

---

### Task 7: Index-Seite und Sitemap

**Files:**
- Create: `app/[lang]/glossary/page.tsx`
- Modify: `app/sitemap.ts`
- Test: `tests/lib/glossary-sitemap.test.ts`

**Interfaces:**
- Consumes: `getPublishedTermList` aus Task 5

- [ ] **Step 1: Failing Test für die Sitemap**

```ts
it('nimmt nur de und en in die Glossar-Einträge', async () => {
  const entries = await sitemap()
  const glossary = entries.filter(e => e.url.includes('/glossary/'))
  const langs = new Set(glossary.map(e => e.url.split('/')[3]))
  expect([...langs].sort()).toEqual(['de', 'en'])
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/lib/glossary-sitemap.test.ts`
Expected: FAIL — keine Glossar-Einträge vorhanden

- [ ] **Step 3: Index-Seite anlegen**

`revalidate = 3600`, alphabetisch gruppiert, nur `slug`/`canonicalName`/`summary`.

- [ ] **Step 4: Sitemap erweitern**

Nur `status = 'published'`, nur `SEO_LOCALES`. Bei mehr als 1000 Begriffen
Range-Pagination — PostgREST cappt bei 1000 Zeilen.

- [ ] **Step 5: Tests laufen lassen — müssen bestehen**

Run: `npx vitest run tests/lib/glossary-sitemap.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/\[lang\]/glossary/page.tsx app/sitemap.ts tests/lib/glossary-sitemap.test.ts
git commit -m "feat(glossary): Index-Seite und Sitemap-Einträge"
```

---

## Phase 3 — Generierung

### Task 8: Begriffs-Generator

**Files:**
- Create: `lib/glossary/generate.ts`
- Test: `tests/lib/glossary-generate.test.ts`

**Interfaces:**
- Produces:
  - `identifyCandidates(articleText: string, knownSlugs: string[]): Promise<string[]>`
  - `generateTermContent(name: string): Promise<GeneratedTerm>` mit
    `GeneratedTerm = { slug, canonicalName, aliases, summary, body, needsIllustration, illustrationAlt }`

- [ ] **Step 1: Failing Test schreiben**

Anthropic-SDK mocken, prüfen: Slug ist URL-safe, `summary` nicht leer,
`aliases` enthält den kanonischen Namen nicht doppelt, bekannte Begriffe werden
nicht erneut vorgeschlagen.

```ts
const mocks = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { create: mocks.create } },
}))

it('slugifiziert den Begriffsnamen URL-safe', async () => {
  mocks.create.mockResolvedValue({
    content: [{ type: 'tool_use', input: {
      slug: 'mixture-of-experts', canonicalName: 'Mixture of Experts',
      aliases: ['MoE'], summary: 'Ein Ansatz…', body: { type: 'doc', content: [] },
      needsIllustration: true, illustrationAlt: 'Schema…',
    }}],
  })
  const { generateTermContent } = await import('@/lib/glossary/generate')
  const t = await generateTermContent('Mixture of Experts')
  expect(t.slug).toMatch(/^[a-z0-9-]+$/)
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/lib/glossary-generate.test.ts`
Expected: FAIL, Modul fehlt

- [ ] **Step 3: Implementieren**

Modell `claude-opus-5` mit `thinking: { type: 'adaptive' }`, Ausgabe über einen
Tool-Call für schema-validierte Rückgabe. **Kein `budget_tokens`** — die
2026er-Frontier-Modelle lehnen das mit 400 ab.

Prompt-Anforderungen, die im Systemprompt stehen müssen:

- Zielgruppe: 15-jähriger Gymnasiast ohne Vorwissen, aber nicht kindlich
- Erster Absatz ohne unerklärte Fachbegriffe
- Sätze im Schnitt unter 20 Wörtern
- Struktur: Was ist es → Warum ist es wichtig → Wie funktioniert es → Wo begegnet es dir
- 400–700 Wörter
- `needsIllustration` nur `true`, wenn ein Schema oder Ablauf den Text ergänzt,
  nicht bei abstrakten Begriffen
- `aliases`: deutsche Flexionen, Abkürzungen, Schreibvarianten

Ein zweiter Call prüft das Ergebnis gegen diese Kriterien und liefert
`readability_score` — das ist die Verständlichkeitsmessung aus der Spec.

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npx vitest run tests/lib/glossary-generate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/glossary/generate.ts tests/lib/glossary-generate.test.ts
git commit -m "feat(glossary): LLM-Generator für Begriffe mit Verständlichkeitsprüfung"
```

---

### Task 9: Illustration über die Dither-Pipeline

**Files:**
- Modify: `lib/gemini/image-generator.ts`
- Test: `tests/lib/glossary-illustration.test.ts`

**Interfaces:**
- Produces:
  - `generateRawImage(prompt: string, opts?: { fast?: boolean }): Promise<GenerateImageResult>`
  - `generateGlossaryIllustration(termName: string, summary: string): Promise<{ success: boolean; imageBase64?: string; error?: string }>`

- [ ] **Step 1: Failing Test schreiben**

```ts
it('nutzt einen erklärenden Prompt, nicht das Satire-Template', async () => {
  const { buildGlossaryImagePrompt } = await import('@/lib/gemini/image-generator')
  const p = buildGlossaryImagePrompt('Mixture of Experts', 'Ein Ansatz, bei dem …')
  expect(p).toContain('Mixture of Experts')
  expect(p.toLowerCase()).not.toContain('satir')
})

it('gibt das Rohbild an generateAndProcessImage weiter, ohne neu zu generieren', async () => {
  // generateRawImage mocken, prüfen dass generateSatiricalImage NICHT aufgerufen wird
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/lib/glossary-illustration.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementieren**

```ts
/** Erklärender Bildstil für Lexikonseiten — bewusst nicht das Satire-Template
 *  aus getActiveImagePrompt(), das auf Nachrichtenbilder festgelegt ist. */
export function buildGlossaryImagePrompt(termName: string, summary: string): string {
  return [
    'A clear, schematic technical illustration explaining the concept:',
    `"${termName}" — ${summary.slice(0, 400)}`,
    'Style: high-contrast black ink on white, diagrammatic, no text labels,',
    'no photorealism, thick clean lines that survive heavy dithering.',
  ].join('\n')
}

export async function generateGlossaryIllustration(termName: string, summary: string) {
  const raw = await generateRawImage(buildGlossaryImagePrompt(termName, summary))
  if (!raw.success || !raw.imageBase64) return { success: false, error: raw.error }
  // preloadedRawBase64 überspringt die Generierung: die Kette Scale →
  // Tonkurve → Floyd-Steinberg → whiteToTransparent läuft unverändert, und
  // der produktive Cover-Pfad bleibt unberührt.
  return generateAndProcessImage(termName, {
    enableDithering: true,
    ditheringGain: 1.0,
    ditheringCoarseness: 3,  // gröber als Cover: dünne Schema-Linien
                             // verschwinden bei coarseness 1 im Rauschen
    targetWidth: 1024,
    targetHeight: 1024,
  }, raw.imageBase64)
}
```

`generateImageOpenAI` als `generateRawImage` exportieren (schmaler Wrapper, der
das aktive Bildmodell verwendet).

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npx vitest run tests/lib/glossary-illustration.test.ts`
Expected: PASS

- [ ] **Step 5: Ein echtes Bild erzeugen und ansehen**

Skript unter `scripts/_glossary_image_test.ts`, das ein Bild für einen
Testbegriff generiert und als PNG schreibt. Visuell prüfen: Dither-Muster
sichtbar, Linien erkennbar, kein Moiré. `ditheringCoarseness` anpassen, falls
nötig — der Wert 3 ist eine begründete Annahme, kein Messergebnis.

- [ ] **Step 6: Commit**

```bash
git add lib/gemini/image-generator.ts tests/lib/glossary-illustration.test.ts
git commit -m "feat(glossary): Illustrationen über die bestehende Dither-Pipeline"
```

---

## Phase 4 — Publishing-Flow

### Task 10: Job-Phase `lexicon`

**Files:**
- Modify: `lib/article-jobs/service.ts:467-495`
- Test: `tests/lib/article-jobs-lexicon.test.ts`

**Interfaces:**
- Consumes: `identifyCandidates`, `generateTermContent` (Task 8), `generateGlossaryIllustration` (Task 9), `findGlossaryMentions`, `extractLexTags` (Task 2)

- [ ] **Step 1: Failing Test schreiben**

```ts
it('setzt nach finalizing phase=lexicon statt status=done', async () => { /* … */ })
it('schließt den Job in der lexicon-Phase ab', async () => { /* … */ })
it('schließt den Job auch ab, wenn die Kandidatensuche fehlschlägt', async () => { /* … */ })
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/lib/article-jobs-lexicon.test.ts`
Expected: FAIL

- [ ] **Step 3: `finalizing` umbauen**

In `lib/article-jobs/service.ts` den `finalizing`-Block ändern: statt
`status: 'done', phase: null` nun `phase: 'lexicon'` setzen und
`generated_post_id: postId` behalten. Die `postId` entsteht erst hier — deshalb
kann die Lexikon-Phase nicht vorher laufen.

- [ ] **Step 4: Phase `lexicon` implementieren**

```ts
if (job.phase === 'lexicon') {
  try {
    const post = await loadPost(supabase, job.generated_post_id!)
    const terms = await getMatcherTerms('de')
    const tagged = extractLexTags(post.content)
    const matched = findGlossaryMentions(extractVisibleText(post.content), terms)
    const fresh = await identifyCandidates(
      extractVisibleText(post.content),
      terms.map(t => t.slug),
    )
    // Für neue Kandidaten Inhalt und ggf. Illustration erzeugen, als draft anlegen
    const candidates = await buildCandidateList(tagged, matched, fresh)
    await supabase.from('generated_posts')
      .update({ pending_glossary_terms: candidates })
      .eq('id', job.generated_post_id)
  } catch (err) {
    // Der Artikel ist fertig — eine fehlgeschlagene Begriffssuche darf ihn
    // nicht blockieren. Der Editor zeigt dann einfach keine Kandidaten.
    console.error('[ArticleJob] lexicon phase failed:', err)
  }
  await supabase.from('article_jobs').update({
    status: 'done', phase: null, completed_at: new Date().toISOString(),
  }).eq('id', job.id)
  return 'lexicon_done'
}
```

- [ ] **Step 5: Tests laufen lassen — müssen bestehen**

Run: `npx vitest run tests/lib/article-jobs-lexicon.test.ts && npx vitest run tests/lib`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/article-jobs/service.ts tests/lib/article-jobs-lexicon.test.ts
git commit -m "feat(glossary): Job-Phase lexicon hinter finalizing"
```

---

### Task 11: Mark-Injektion beim Speichern

**Files:**
- Modify: `app/api/admin/generated-posts/route.ts`
- Test: `tests/api/glossary-inject-on-save.test.ts`

**Interfaces:**
- Consumes: `injectGlossaryMarks` (Task 3), `getMatcherTerms` (Task 5)
- Produces: PATCH akzeptiert zusätzlich `confirmedGlossarySlugs?: string[]`

- [ ] **Step 1: Failing Test schreiben**

`tests/api/glossary-inject-on-save.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  update: vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) })),
  getSession: vi.fn(() => Promise.resolve({ email: 'admin@test' })),
  getMatcherTerms: vi.fn(() => Promise.resolve([
    { slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] },
  ])),
}))

vi.mock('@/lib/auth/session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/glossary/terms', () => ({ getMatcherTerms: mocks.getMatcherTerms }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      update: mocks.update,
      select: () => ({ eq: () => ({ single: () => Promise.resolve({
        data: { content: JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Die Inferenz ist teuer.' }] }],
        }) },
        error: null,
      }) }) }),
      in: () => Promise.resolve({ error: null }),
    }),
  }),
}))

function patch(body: unknown) {
  return new Request('http://localhost/api/admin/generated-posts', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/admin/generated-posts mit Glossar-Slugs', () => {
  beforeEach(() => mocks.update.mockClear())

  it('schreibt eine glossaryLink-Mark in den gespeicherten Content', async () => {
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    await PATCH(patch({ id: 'p1', confirmedGlossarySlugs: ['inferenz'] }) as never)
    const saved = mocks.update.mock.calls.flat().find(
      (a) => typeof (a as { content?: string })?.content === 'string',
    ) as { content: string }
    expect(saved.content).toContain('glossaryLink')
    expect(saved.content).toContain('inferenz')
  })

  it('speichert unverändert, wenn keine Slugs übergeben werden', async () => {
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    await PATCH(patch({ id: 'p1', title: 'Neu' }) as never)
    const saved = mocks.update.mock.calls.flat().find(
      (a) => typeof (a as { content?: string })?.content === 'string',
    ) as { content?: string } | undefined
    expect(saved?.content ?? '').not.toContain('glossaryLink')
  })

  it('leert pending_glossary_terms nach der Freigabe', async () => {
    const { PATCH } = await import('@/app/api/admin/generated-posts/route')
    await PATCH(patch({ id: 'p1', confirmedGlossarySlugs: ['inferenz'] }) as never)
    const saved = mocks.update.mock.calls.flat().find(
      (a) => 'pending_glossary_terms' in (a as object),
    ) as { pending_glossary_terms: unknown }
    expect(saved.pending_glossary_terms).toBeNull()
  })
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/api/glossary-inject-on-save.test.ts`
Expected: FAIL — der Content enthält keine `glossaryLink`-Mark.

- [ ] **Step 3: Route erweitern**

```ts
// Serverseitig, nicht im Client: der Browser hat keinen Service-Role-Zugriff,
// und die Injektion muss auch für Pfade gelten, die nicht über den Editor
// laufen (Übersetzung, Backfill-Skript).
if (Array.isArray(body.confirmedGlossarySlugs)) {
  const terms = await getMatcherTerms('de')
  // Company- und Produktnamen reservieren: spezifisch vor generisch.
  const reserved = [
    ...Object.keys(KNOWN_COMPANIES),
    ...Object.keys(KNOWN_PREMARKET_COMPANIES),
  ]
  const parsed = JSON.parse(updateData.content as string)
  updateData.content = JSON.stringify(
    injectGlossaryMarks(parsed, body.confirmedGlossarySlugs, terms, { reserved }),
  )
  updateData.pending_glossary_terms = null

  // Bestätigte Drafts veröffentlichen — erst damit wird die Lexikonseite
  // erreichbar und landet in der Sitemap.
  await supabase.from('glossary_terms')
    .update({ status: 'published', updated_at: new Date().toISOString() })
    .in('slug', body.confirmedGlossarySlugs)
    .eq('status', 'draft')
}
```

Chart-Produktnamen kommen aus `getChartProductNames()` — falls die Funktion
nicht existiert, eine schmale Query auf `products` mit
`visibility_status = 'visible'` ergänzen und nur `canonical_name` selektieren.

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**

Run: `npx vitest run tests/api/glossary-inject-on-save.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/generated-posts/route.ts tests/api/glossary-inject-on-save.test.ts
git commit -m "feat(glossary): Mark-Injektion und Draft-Freigabe beim Speichern"
```

---

### Task 12: Freigabe-Panel im Editor

**Files:**
- Modify: `app/admin/generated-articles/edit/[id]/page.tsx`
- Create: `components/admin/glossary-approval-panel.tsx`

- [ ] **Step 1: Panel-Komponente anlegen**

Props: `candidates: GlossaryCandidate[]`, `value: string[]`,
`onChange: (slugs: string[]) => void`. `origin === 'tag'` initial angehakt,
`match` und `new` offen. Pro Eintrag Name, Herkunfts-Badge und `summary` als
Vorschau.

- [ ] **Step 2: Im Editor einbinden**

`pending_glossary_terms` beim Laden in State, Panel neben den
Veröffentlichen-Schalter. `confirmedGlossarySlugs` in den `updateData`-Body
aufnehmen (`page.tsx:615-625`).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: keine Fehler

- [ ] **Step 4: Manuell prüfen**

Artikel mit Kandidaten öffnen, zwei bestätigen, speichern. Danach im
gespeicherten JSON die Marks prüfen und im Frontend den Link anklicken.

- [ ] **Step 5: Commit**

```bash
git add app/admin/generated-articles/edit components/admin/glossary-approval-panel.tsx
git commit -m "feat(glossary): Freigabe-Panel für Begriffskandidaten im Editor"
```

---

### Task 13: Ghostwriter setzt `{lex:}`-Tags

**Files:**
- Modify: `lib/claude/ghostwriter-pipeline.ts`
- Test: `tests/lib/ghostwriter-lex-tags.test.ts`

- [ ] **Step 1: Failing Test schreiben**

```ts
it('erwähnt die {lex:}-Direktive im Prompt', () => {
  const prompt = buildWritingPrompt(/* … */)
  expect(prompt).toContain('{lex:')
})
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/lib/ghostwriter-lex-tags.test.ts`
Expected: FAIL

- [ ] **Step 3: Prompt erweitern**

Analog zur bestehenden `{Company}`-Anweisung: erklärungsbedürftige Fachbegriffe
bei der **ersten** Erwähnung mit `{lex:Begriff}` markieren, maximal 5 pro
Artikel, nicht in Überschriften, nicht im Synthszr Take.

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npx vitest run tests/lib/ghostwriter-lex-tags.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/claude/ghostwriter-pipeline.ts tests/lib/ghostwriter-lex-tags.test.ts
git commit -m "feat(glossary): Ghostwriter markiert Fachbegriffe mit {lex:}"
```

---

## Phase 5 — Arrondierung

### Task 14: News-RPC und wöchentlicher Refresh

**Files:**
- Create: `supabase/migrations/20260803130000_glossary_news_rpc.sql`
- Create: `app/api/cron/glossary-news/route.ts`
- Modify: `vercel.json`
- Test: `tests/api/glossary-news-cron.test.ts`

- [ ] **Step 1: RPC schreiben**

```sql
create or replace function public.match_glossary_news(
  query_embedding vector(1536),
  since timestamptz,
  match_limit int default 5
)
returns table (id uuid, title text, source_url text, source_name text,
               published_at timestamptz, similarity numeric)
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select r.id, r.title, r.source_url, r.source_name, r.created_at,
         1 - (r.embedding <=> query_embedding) as similarity
  from public.daily_repo r
  where r.embedding is not null
    -- Nur Artikel und Webcrawl: Newsletter-Rows enthalten den gesamten
    -- Newsletter-Plaintext über mehrere Themen, ein Embedding-Treffer sagt
    -- dort nichts über den Begriff aus, und source_url ist unzuverlässig
    -- (lib/newsletter/fetcher.ts:473-478).
    and r.source_type in ('article', 'webcrawl')
    and r.created_at >= since
  order by r.embedding <=> query_embedding
  limit match_limit;
$$;

revoke all on function public.match_glossary_news(vector, timestamptz, int) from public;
revoke all on function public.match_glossary_news(vector, timestamptz, int) from anon;
revoke all on function public.match_glossary_news(vector, timestamptz, int) from authenticated;
grant execute on function public.match_glossary_news(vector, timestamptz, int) to service_role;
```

> Spaltennamen von `daily_repo` vor dem Schreiben verifizieren
> (`source_type`, `source_name`, `embedding`, Datumsspalte) und ggf. anpassen.

- [ ] **Step 2: Failing Test für den Cron**

```ts
it('gibt ohne Authorization 401 zurück', async () => { /* … */ })
it('ersetzt bestehende News-Zeilen eines Begriffs', async () => { /* … */ })
it('schreibt maximal 5 News pro Begriff', async () => { /* … */ })
```

- [ ] **Step 3: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/api/glossary-news-cron.test.ts`
Expected: FAIL

- [ ] **Step 4: Cron implementieren**

`CRON_SECRET` via `verifyBearerToken`. Pro Begriff Embedding sicherstellen (fehlt
es, aus `canonical_name + summary` erzeugen), RPC aufrufen, Einordnungssatz
generieren, `glossary_term_news` für den Begriff ersetzen. Immer 200 zurückgeben.

`vercel.json`: `{ "path": "/api/cron/glossary-news", "schedule": "0 4 * * 1" }`

- [ ] **Step 5: Tests laufen lassen — müssen bestehen**

Run: `npx vitest run tests/api/glossary-news-cron.test.ts`
Expected: PASS

- [ ] **Step 6: Migration anwenden lassen und gegen Prod verifizieren**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://www.synthszr.com/api/cron/glossary-news
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CRON_SECRET" https://www.synthszr.com/api/cron/glossary-news
```

Expected: 401, dann 200.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260803130000_glossary_news_rpc.sql app/api/cron/glossary-news vercel.json tests/api/glossary-news-cron.test.ts
git commit -m "feat(glossary): News-RPC und wöchentlicher Refresh-Cron"
```

---

### Task 15: Produkt-Zuordnung

**Files:**
- Modify: `lib/glossary/generate.ts`
- Test: `tests/lib/glossary-products.test.ts`

**Interfaces:**
- Produces: `assignProducts(termId: string, termName: string, summary: string): Promise<number>`

- [ ] **Step 1: Failing Test schreiben**

```ts
it('berücksichtigt nur visible und chartable Produkte', async () => { /* … */ })
it('überschreibt manuelle Zuordnungen nicht', async () => { /* … */ })
it('schreibt nichts, wenn kein Produkt passt', async () => { /* … */ })
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/lib/glossary-products.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementieren**

Kandidatenliste aus `products` mit `visibility_status = 'visible'` und
`chartable = true` laden (schmal: `id, canonical_name, vendor`), LLM ordnet zu
und liefert `relevance`. Upsert nach `glossary_term_products` mit
`source = 'llm'`, aber nur für Zeilen ohne `source = 'manual'`.

Kein Mapping über `product_categories`: die ~50 Slugs sind Produktkategorien
(`frontier-llms`, `reasoning-models`), keine Fachbegriffe.

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npx vitest run tests/lib/glossary-products.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/glossary/generate.ts tests/lib/glossary-products.test.ts
git commit -m "feat(glossary): LLM-Zuordnung von Chart-Produkten zu Begriffen"
```

---

## Phase 6 — Mehrsprachigkeit und Pflege

### Task 16: Übersetzung

**Files:**
- Create: `lib/glossary/translate.ts`
- Modify: `app/api/admin/glossary/route.ts`
- Test: `tests/lib/glossary-translate.test.ts`

**Interfaces:**
- Produces: `translateTerm(termId: string, targetLang: string): Promise<void>`

- [ ] **Step 1: Failing Test schreiben**

```ts
it('verlinkt im übersetzten Content mit der übersetzten Begriffsliste', async () => {
  // Marks werden nach der Übersetzung neu injiziert, nicht kopiert
})
it('übersetzt nur nach de und en', async () => { /* … */ })
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/lib/glossary-translate.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementieren**

`canonical_name`, `aliases`, `summary`, `body` übersetzen, nach
`glossary_term_translations` schreiben. Eigene Verarbeitung, **nicht** über
`translation_queue`: dessen CHECK-Constraint erlaubt nur
`generated_post | static_page | ui`, und der Cron verarbeitet nur 3 Übersetzungen
pro 15-Minuten-Tick — Glossar-Einträge würden die täglichen Artikel verdrängen.

Für Artikel-Übersetzungen: nach der Übersetzung `injectGlossaryMarks` erneut über
den übersetzten Content laufen lassen, mit der Begriffsliste der Zielsprache.
Marks müssen nicht durch die Übersetzung getragen werden — das umgeht das
Problem, an dem `reapplyBundleTypeAttrs` sich abarbeitet (ordinales Matching
bricht, wenn Nodes verschmelzen).

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `npx vitest run tests/lib/glossary-translate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/glossary/translate.ts app/api/admin/glossary/route.ts tests/lib/glossary-translate.test.ts
git commit -m "feat(glossary): Übersetzung mit Neu-Injektion der Marks"
```

---

### Task 17: Aktualitätsprüfung und Revisions-Freigabe

**Files:**
- Create: `app/api/cron/glossary-review/route.ts`
- Create: `app/admin/glossary/page.tsx`
- Modify: `vercel.json`
- Test: `tests/api/glossary-review-cron.test.ts`

- [ ] **Step 1: Failing Test schreiben**

```ts
it('gibt ohne Authorization 401 zurück', async () => { /* … */ })
it('schreibt eine Revision nach pending_body, ohne body zu ändern', async () => { /* … */ })
it('verarbeitet maximal 10 Begriffe pro Lauf', async () => { /* … */ })
it('gibt auch bei einem Fehler in einem Begriff 200 zurück', async () => { /* … */ })
```

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/api/glossary-review-cron.test.ts`
Expected: FAIL

- [ ] **Step 3: Cron implementieren**

Batch von 10 Begriffen nach `last_reviewed_at` aufsteigend. Pro Begriff LLM-Call
mit den aktuellen News als Kontext:

- unverändert → `review_state = 'ok'`, `last_reviewed_at = now()`
- veraltet → Text nach `pending_body`, `review_state = 'revision_pending'`

Der Live-Text bleibt unverändert. `is_manually_edited` existiert genau deshalb,
weil automatische Regenerierung manuelle Korrekturen überschreibt.

`vercel.json`: `{ "path": "/api/cron/glossary-review", "schedule": "0 5 * * *" }`
— täglich 10 Begriffe, damit jeder Begriff etwa monatlich dran ist, ohne dass ein
Lauf das ganze Lexikon abarbeiten muss.

- [ ] **Step 4: Admin-Route und -Seite anlegen**

`app/api/admin/glossary/route.ts` — session-authentifiziert wie die übrigen
Admin-Routen (`getSession()`, 401 ohne Session):

| Methode | Zweck |
|---|---|
| `GET` | Begriffsliste mit `status`, `review_state`, `last_reviewed_at`. Ohne `body`, mit `?slug=` einzeln inklusive `body` und `pending_body` |
| `PATCH` | `{ slug, action: 'accept_revision' \| 'discard_revision' \| 'hide' \| 'publish' }` |
| `DELETE` | `{ slug }` — löscht den Begriff; Übersetzungen, Produkt- und News-Zuordnungen fallen per `on delete cascade` mit |

`accept_revision` setzt `body = pending_body`, `pending_body = null`,
`review_state = 'ok'`. `discard_revision` setzt nur `pending_body = null` und
`review_state = 'ok'`.

`app/admin/glossary/page.tsx` — Liste aller Begriffe mit Status-Badge, offene
Revisionen zuerst. Bei `revision_pending` ein Diff zwischen `body` und
`pending_body` mit den Aktionen Übernehmen und Verwerfen.

Nach dem Übernehmen einer Revision die Detailseite revalidieren, sonst zeigt sie
bis zu 15 Minuten den alten Text.

- [ ] **Step 5: Tests laufen lassen — müssen bestehen**

Run: `npx vitest run tests/api/glossary-review-cron.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/glossary-review app/admin/glossary vercel.json tests/api/glossary-review-cron.test.ts
git commit -m "feat(glossary): Aktualitätsprüfung mit Revisions-Freigabe"
```

---

### Task 18: UI-Labels und Abschluss-Verifikation

**Files:**
- Modify: `lib/i18n/default-translations.ts`
- Test: gesamte Suite plus Produktions-Verifikation

- [ ] **Step 1: Labels ergänzen**

„Lexikon", „Verwandte Begriffe", „Aktuelle News", „Produkte dazu", „Im Lexikon
erklärt", „Begriff nicht gefunden" — in `defaultTranslations` **und** als Zeilen
in `ui_translations`. Ohne beides rendern sie in allen Sprachen deutsch.

- [ ] **Step 2: Gesamte Suite**

Run: `npx vitest run && npm run typecheck`
Expected: alles PASS

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: exit 0. Bei `ENOTEMPTY: rmdir '.next/server/app'` erst
`rm -rf .next` — das ist ein Dropbox-Sync-Artefakt, kein Codefehler.

- [ ] **Step 4: Produktions-Verifikation**

Nach dem Deploy die vollständige Liste aus dem Verifikations-Abschnitt der Spec
durchgehen. Die drei entscheidenden Prüfungen:

```bash
# 1. Der Link steht im ausgelieferten HTML — Kernbeweis für das SEO-Ziel
curl -s https://www.synthszr.com/de/posts/<slug> | grep -o 'glossary/[a-z-]*' | head

# 2. ISR greift
curl -sI https://www.synthszr.com/de/glossary/<slug> | grep -i x-vercel-cache

# 3. Erklärungstext steht vor den arrondierenden Blöcken
curl -s https://www.synthszr.com/de/glossary/<slug> \
  | grep -n 'glossary-body\|glossary-aside' | head
```

Newsletter-Testversand an ein kontrolliertes Konto: Link vorhanden, kein
unersetztes `{{...}}`, keine sichtbare `{lex:}`-Direktive.

- [ ] **Step 5: Commit**

```bash
git add lib/i18n/default-translations.ts
git commit -m "feat(glossary): UI-Labels für alle öffentlichen Sprachen"
```

---

## Offene Punkte für die Umsetzung

Diese Annahmen sind im Plan bewusst als solche markiert und müssen bei der
Umsetzung am Code verifiziert werden:

1. Der Export-Name in `lib/tiptap/render-static-html.ts` (Task 4, Step 1).
2. Die Spaltennamen von `daily_repo` für die RPC (Task 14, Step 1).
3. `ditheringCoarseness: 3` für Illustrationen ist eine begründete Annahme, kein
   Messergebnis (Task 9, Step 5).
4. `foreach ... in array` in PL/pgSQL — falls die Supabase-Version das ablehnt,
   die vier RLS-Blöcke ausschreiben (Task 1, Step 1).
5. Ob `products` die Spalten `visibility_status` und `chartable` genau so heißt
   (Task 15, Step 3).
6. Ob eine Funktion für die Chart-Produktnamen existiert oder eine schmale Query
   nötig ist (Task 11, Step 3).
7. Der `PATCH`-Export-Name und die Body-Struktur in
   `app/api/admin/generated-posts/route.ts` — der Test in Task 11 mockt die
   bestehende Struktur und muss daran angepasst werden.

## Bewusste Detailtiefe

Die Tasks 1–5, 9 und 11 enthalten vollständigen, lauffähigen Code — dort
entstehen die Interfaces, auf die alles Übrige zugreift, und dort sind die
Fehler teuer (stille Datenverluste, Egress, gebrochene Idempotenz).

Die Tasks 6–8, 10 und 12–18 geben Testnamen, Kernlogik und Constraints vor, aber
nicht jede Zeile. Der Grund ist nicht Bequemlichkeit: diese Tasks ändern
bestehende Dateien, deren aktuelle Struktur der Umsetzer ohnehin lesen muss
(`article-jobs/service.ts` ist 500 Zeilen, die Editor-Seite über 1200). Ein hier
ausgeschriebener Codeblock wäre eine Vermutung über Zeilennummern und
Variablennamen, die beim Lesen sofort korrigiert werden müsste — und würde
falsche Sicherheit erzeugen. Wo eine Annahme über Bestandscode nötig war, steht
sie oben unter „Offene Punkte".
