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
| `components/tiptap-renderer/tiptap-renderer.tsx` | Mark rendern |
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
  embedding vector(768),
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
  for t in select unnest(array[
    'glossary_terms', 'glossary_term_translations',
    'glossary_term_products', 'glossary_term_news'
  ])
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

/** Schwelle, ab der ein Begriffsname als „lang" gilt. Kurze Namen werden nicht
 *  verworfen, sondern strenger gematcht: sie brauchen eine Wortgrenze auf
 *  beiden Seiten, lange nur davor (siehe boundaryRegex in
 *  lib/glossary/mentions.ts). Ohne diese Unterscheidung würde der 2-Zeichen-
 *  Alias „AI" das Wort „Aida" treffen, oder die Abkürzungen MoE/RAG/LLM wären
 *  gar nicht verlinkbar. Gleicher Wert wie bei Chart-Produkten. */
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

  it('findet kurze Abkürzungen als eigenständiges Wort', () => {
    // RAG ist 3 Zeichen, braucht also eine Grenze auf beiden Seiten — hier
    // durch Leerzeichen erfüllt.
    expect(findGlossaryMentions('Wir nutzen RAG dafür.', terms).map(h => h.slug)).toEqual(['rag'])
  })

  it('matcht einen kurzen Namen nicht als Wortpräfix', () => {
    const ai = [{ slug: 'ai', canonicalName: 'Artificial Intelligence', aliases: ['AI'] }]
    expect(findGlossaryMentions('Aida singt.', ai)).toEqual([])
  })

  it('matcht einen kurzen Namen nicht mit angehängtem Buchstaben', () => {
    expect(findGlossaryMentions('MoEs skalieren gut.', terms)).toEqual([])
  })

  it('trifft ein Kompositum über den Substring-Pfad, nicht nur als gelisteten Alias', () => {
    // Bewusst OHNE Alias 'Inferenzkosten': der Treffer muss über die fehlende
    // Trailing-Grenze bei langen Namen entstehen.
    const only = [{ slug: 'inferenz', canonicalName: 'Inferenz', aliases: [] }]
    expect(findGlossaryMentions('Die Inferenzkosten sinken.', only).map(h => h.slug))
      .toEqual(['inferenz'])
  })

  it('behandelt Regex-Sonderzeichen im Namen als Literal', () => {
    const gpt = [{ slug: 'gpt-4-turbo', canonicalName: 'GPT-4 (Turbo)', aliases: [] }]
    expect(findGlossaryMentions('Wir nutzen GPT-4 (Turbo) dafür.', gpt).map(h => h.slug))
      .toEqual(['gpt-4-turbo'])
    // Ohne Escaping würde '(Turbo)' als Gruppe interpretiert und 'GPT-4 Turbo'
    // fälschlich treffen.
    expect(findGlossaryMentions('Wir nutzen GPT-4 Turbo dafür.', gpt)).toEqual([])
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

/**
 * Wortgrenzen über Unicode-Klassen statt \b: \b bricht bei Umlauten und
 * deutschen Komposita.
 *
 * Die Grenze hinter dem Namen ist LÄNGENABHÄNGIG, und das ist der Kern der
 * Regel:
 *
 * - Ab GLOSSARY_MIN_NAME_LENGTH nur eine Grenze davor. Damit trifft
 *   „Inferenzkosten" den Begriff „Inferenz" — deutsche Komposita sind in
 *   Fachtexten der Normalfall.
 * - Darunter zusätzlich eine Grenze dahinter. Kurze Abkürzungen (MoE, RAG,
 *   LLM, AI) sind legitime Aliasse, würden ohne diese Grenze aber jedes Wort
 *   treffen, das so anfängt: „AI" als Alias von „Artificial Intelligence"
 *   matchte sonst „Aida". „MoE-Modell" trifft weiterhin, weil der Bindestrich
 *   eine Grenze ist; „MoEs" trifft nicht.
 */
function boundaryRegex(name: string): RegExp {
  const head = `(^|[^\\p{L}\\p{N}])(${escapeRegex(name)})`
  return name.length < GLOSSARY_MIN_NAME_LENGTH
    ? new RegExp(`${head}($|[^\\p{L}\\p{N}])`, 'iu')
    : new RegExp(head, 'iu')
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
    // Kein Längenfilter: kurze Namen werden nicht verworfen, sondern von
    // boundaryRegex strenger behandelt. Ein Filter hier würde legitime
    // Abkürzungen (MoE, RAG, LLM) unauffindbar machen.
    const names = [term.canonicalName, ...term.aliases]
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

export interface GlossaryLinkOptions {
  /** Sprachpräfix für den href. Ein Artikel verlinkt auf die Lexikonseite
   *  seiner eigenen Sprache. Ein sprachneutraler Pfad wäre keine Alternative:
   *  die Middleware beantwortet Pfade ohne Präfix mit einem 307, dessen Ziel
   *  von Cookie und Geo-Erkennung abhängt (middleware.ts:243-257) — Crawler
   *  landen dann je nach Herkunft auf verschiedenen Sprachen. */
  lang: string
}

/**
 * Mark für Lexikon-Verlinkungen. Wird serverseitig injiziert
 * (lib/glossary/inject-marks.ts), nicht vom Nutzer gesetzt — muss aber im
 * Editor registriert sein, sonst verwirft TipTap sie beim Laden und der Link
 * verschwindet beim nächsten Speichern.
 *
 * Dieses renderHTML ist die einzige Stelle, die das Link-HTML für den
 * crawlbaren SSR-Pfad erzeugt: render-static-html.ts rendert über
 * generateHTML(json, extensions) und hat keine eigene Mark-Behandlung.
 */
export const GlossaryLinkMark = Mark.create<GlossaryLinkOptions>({
  name: 'glossaryLink',

  addOptions() {
    return { lang: 'de' }
  },

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
      href: `/${this.options.lang}/glossary/${slug}`,
      class: 'glossary-link',
    }), 0]
  },
})
```

- [ ] **Step 4: Injektion implementieren**

`lib/glossary/inject-marks.ts`:

**Zuerst: `matchNameInText` aus Task 2 exportieren.** Der Injektor darf seine
Trefferlogik nicht selbst bauen. Sonst entscheiden zwei Module unabhängig, was
ein Treffer ist — der Editor zeigt Kandidaten, die nicht verlinkt werden, oder
der Injektor verlinkt Wörter, die als Kandidat nie auftauchten. Und der
Injektor würde die längenabhängige Grenze aus Task 2 verlieren, also `AI` wieder
auf „Aida" matchen.

In `lib/glossary/mentions.ts` die bereits vorhandene Logik als Funktion
herausziehen und exportieren:

```ts
/**
 * Findet die erste Erwähnung eines Namens im Text und gibt ihre Position
 * zurück. Einzige Stelle im System, die entscheidet, was als Treffer gilt —
 * Matcher und Mark-Injektor müssen dieselbe Antwort bekommen.
 */
export function matchNameInText(
  text: string,
  name: string,
): { start: number; end: number; matched: string } | null {
  const re = name.length < GLOSSARY_MIN_NAME_LENGTH
    ? boundaryRegexShort(name)
    : boundaryRegex(name)
  const m = re.exec(text)
  if (!m) return null
  const start = m.index + m[1].length
  return { start, end: start + m[2].length, matched: m[2] }
}
```

`findGlossaryMentions` nutzt fortan dieselbe Funktion, statt die Regex selbst
zu wählen — die 19 bestehenden Tests müssen unverändert bestehen bleiben.

```ts
import { GLOSSARY_MAX_PER_ARTICLE } from '@/lib/glossary/types'
import { matchNameInText } from '@/lib/glossary/mentions'
import type { GlossaryMatcherTerm } from '@/lib/glossary/types'

const MARK_TYPE = 'glossaryLink'

type Node = Record<string, unknown>

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
          const pos = matchNameInText(o.text as string, name)
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

> **Pflicht für diesen Task: jede `.configure()`-Stelle muss `lang` explizit
> setzen.** `GlossaryLinkMark.addOptions()` liefert den Default `'de'`, und der
> ist keine neutrale Vorbelegung, sondern eine inhaltliche Sprachentscheidung.
> Ein vergessenes `configure({ lang })` erzeugt lautlos deutsche Links in jedem
> englischen Artikel — ohne Fehler, ohne Testausschlag. Ein Pflichtparameter ist
> im TipTap-Extension-Modell nicht durchsetzbar: `addOptions()` muss einen
> konkreten Wert liefern, `.configure()` ist per Design optional. Die Absicherung
> kann deshalb nur hier stattfinden. Der Review dieses Tasks muss **jede**
> Registrierungsstelle einzeln daraufhin prüfen.
>
> Präzedenzfall im Projekt: die Podcast-INTERMEZZO-Sprachdrift entstand genauso —
> ein separater Call mit hart deutschem Prompt, der englische Podcasts
> mittendrin ins Deutsche kippen ließ.

**Files:**
- Modify: `lib/tiptap/render-static-html.ts`
- Modify: `lib/email/tiptap-to-html.ts`
- Modify: `components/tiptap-renderer/tiptap-renderer.tsx`
- Modify: `components/tiptap-editor.tsx`, `components/tiptap-editor-with-patterns.tsx`
- Test: `tests/lib/glossary-render-paths.test.ts`

**Interfaces:**
- Consumes: `GlossaryLinkMark` aus Task 3

- [ ] **Step 1: Failing Test schreiben**

`tests/lib/glossary-render-paths.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { renderStaticArticleHtml } from '@/lib/tiptap/render-static-html'

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
    const html = renderStaticArticleHtml(withGlossary)
    expect(html).toContain('/glossary/inferenz')
    expect(html).toContain('Inferenz')
  })

  it('verliert den umgebenden Text nicht', () => {
    const html = renderStaticArticleHtml(withGlossary)
    expect(html).toContain('ist teuer')
  })

  it('entfernt {lex:}-Direktiven', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ein {lex:Inferenz}-Problem.' }] }],
    }
    const html = renderStaticArticleHtml(doc)
    expect(html).not.toContain('{lex:')
    expect(html).toContain('Inferenz')
  })

  it('rendert einen Artikel ohne Glossarbegriffe unverändert', () => {
    const plain = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nur Text.' }] }],
    }
    expect(renderStaticArticleHtml(plain)).toContain('Nur Text.')
  })
})
```

> Den tatsächlichen Export-Namen aus `lib/tiptap/render-static-html.ts` vor dem
> Schreiben prüfen und im Test verwenden — die Datei existiert bereits.

- [ ] **Step 2: Test laufen lassen — muss fehlschlagen**

Run: `npx vitest run tests/lib/glossary-render-paths.test.ts`
Expected: FAIL — der Link fehlt im HTML, weil die Mark unbekannt ist.

- [ ] **Step 3: SSR-Fallback erweitern**

`lib/tiptap/render-static-html.ts` hat **keine Mark-Schleife** — es rendert über
`generateHTML(json, extensions)` aus `@tiptap/html` (Zeile 20-38). Der Fix ist
also die Extension-Liste, nicht ein manueller HTML-Zweig. Der Doc-Kommentar der
Datei sagt warum: „Die Extension-Liste MUSS mit dem Client-Editor deckungsgleich
sein, sonst wirft generateHTML bei unbekannten Node-Typen" — und der `catch` in
Zeile 46-48 macht daraus einen leeren String, also den lautlosen Totalverlust
des Artikels.

Die Funktion braucht dafür die Sprache. Sie hat genau **einen** Aufrufer
(`components/post-content-view.tsx:26`), der Wechsel ist also billig:

```ts
export function renderStaticArticleHtml(
  content: Record<string, unknown> | string,
  lang = 'de',
): string {
  // ...
  const html = generateHTML(json as Parameters<typeof generateHTML>[0], [
    StarterKit.configure({ heading: false, link: false }),
    HeadingWithQueueId.configure({ levels: [1, 2, 3, 4, 5, 6] }),
    Link.configure({ /* unverändert */ }),
    // Ohne diesen Eintrag wirft generateHTML bei der glossaryLink-Mark, der
    // catch schluckt es, und der komplette Artikel fehlt im Prerender-HTML.
    GlossaryLinkMark.configure({ lang }),
  ])
```

`post-content-view.tsx` muss die Sprache durchreichen — sie liegt dort als Prop
oder über den Locale-Kontext an.

Zusätzlich `stripLexTags` aus Task 2 **vor** dem generischen Strip in Zeile 44
anwenden. Der Strip dort lautet `/\{[^{}<>\n]{1,80}\}/g` und ersetzt durch den
**Leerstring** — ohne die Vorbehandlung verschwindet `{lex:Inferenz}` samt
Begriff aus dem Text, nicht nur die Klammern.

- [ ] **Step 4: E-Mail-Pfad erweitern**

`lib/email/tiptap-to-html.ts` hat — anders als der SSR-Fallback — eine **eigene
Mark-Behandlung**: die Funktion `applyMarks` (Zeile 1133) ist ein
`switch (mark.type)` mit den Fällen `bold`, `italic` und `link`. Dort kommt ein
neuer Fall dazu:

```ts
case 'glossaryLink': {
  const slug = mark.attrs?.slug
  if (!slug) break
  // Absolute URL: relative Pfade funktionieren in E-Mail-Clients nicht.
  // SITE_URL kommt aus lib/seo/site.ts.
  result = `<a href="${SITE_URL}/${lang}/glossary/${slug}">${result}</a>`
  break
}
```

Zwei Dinge, die dieser Fall vom SSR-Pfad unterscheiden:

- **Kein Style-Attribut.** Der bestehende `link`-Fall rendert schlicht
  `<a href="...">` ohne Styles. Nicht abweichen, sonst sehen Glossar-Links im
  Newsletter anders aus als Quellenlinks.
- **`lang` muss bis hierher durchgereicht werden.** Prüfen, ob `applyMarks` die
  Sprache über einen Parameter oder aus dem umgebenden Modulzustand erreichen
  kann; falls nicht, den Parameter ergänzen — `applyMarks` hat mehrere
  Aufrufer (u. a. Zeile 1103, 1118, 1119, 1122).

`sanitizeHtmlForEmail` muss nicht erweitert werden — `a` ist erlaubt. Den
`{lex:}`-Strip in Zeile 174 ebenfalls ergänzen (`stripLexTags` davor).

- [ ] **Step 5: Web-Renderer und Editor**

`components/tiptap-renderer/tiptap-renderer.tsx` — beachte das
Unterverzeichnis; eine Datei `components/tiptap-renderer.tsx` existiert nicht
(CLAUDE.md nennt sie falsch). Verifiziert: die Komponente nutzt
`useEditor({ extensions: [...] })` mit `EditorContent` (Zeile 138-139, 279), der
Fix ist also ein Eintrag in dieser Liste — `GlossaryLinkMark.configure({ lang })`
mit der Sprache aus den Props.

`components/tiptap-editor.tsx` und `components/tiptap-editor-with-patterns.tsx`:
`GlossaryLinkMark` in das `extensions`-Array aufnehmen. Ohne das verwirft der
Editor die Marks beim Laden, und sie verschwinden beim nächsten Speichern.

**Die Sprachverdrahtung — hier schlägt der `'de'`-Default sonst zu.**

Verifizierter Stand: `components/post-content-view.tsx` hat bereits ein
`locale?: string`-Prop (Zeile 11/25) und reicht es an ein Kind weiter (Zeile 45),
übergibt es aber **nicht** an `renderStaticArticleHtml` (Zeile 26). Von den fünf
Aufrufern setzen nur der Artikel-Pfad das Prop:

| Aufrufer | `locale` gesetzt | Glossar-Marks möglich |
|---|---|---|
| `app/[lang]/posts/[slug]/page.tsx:508` | ja | ja — Hauptpfad |
| `components/featured-article.tsx:149` | **nein** | **ja** — rendert Artikel-Content |
| `app/[lang]/why/page.tsx:95` | nein | nein (statische Seite) |
| `app/[lang]/datenschutz/page.tsx:88` | nein | nein |
| `app/[lang]/impressum/page.tsx:87` | nein | nein |

`featured-article.tsx` ist die scharfe Stelle: die Komponente **hat** `locale`
(Zeile 23/38, verwendet es für `postUrl`, `AudioPlayer` und `formatUpdateDate`),
gibt es nur nicht weiter. Ohne diese eine Zeile bekommt ein englischer Artikel
auf der Homepage deutsche Glossar-Links — lautlos.

Zu tun: `renderStaticArticleHtml(content, locale)` und `locale={locale}` in
`featured-article.tsx:149`. Die drei statischen Seiten dürfen es
mitbekommen — es kostet nichts und verhindert Überraschungen, falls dort später
Glossarbegriffe auftauchen —, sind aber nicht zwingend.

**Für den E-Mail-Pfad ist die Sprache schon vorhanden:**
`convertTiptapToHtml(doc, locale = 'de')` (Zeile 1227) hat sie als Parameter. Sie
muss nur bis `applyMarks` durchgereicht werden. `generateEmailContent`
(Zeile 386) hat sie dagegen **nicht** — dort prüfen, woher sie kommt, statt
einen zweiten `'de'`-Default einzuführen.

- [ ] **Step 6: Tests laufen lassen — müssen bestehen**

Run: `npx vitest run tests/lib/glossary-render-paths.test.ts`
Expected: PASS, 4 Tests

- [ ] **Step 7: Gesamte Suite laufen lassen**

Run: `npx vitest run`
Expected: PASS. Besonders auf E-Mail- und Renderer-Tests achten — sie decken die
geänderten Dateien ab.

- [ ] **Step 8: Commit**

```bash
git add lib/tiptap/render-static-html.ts lib/email/tiptap-to-html.ts components/tiptap-renderer/tiptap-renderer.tsx components/tiptap-editor.tsx components/tiptap-editor-with-patterns.tsx tests/lib/glossary-render-paths.test.ts
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

`tests/lib/glossary-terms.test.ts` — dem etablierten Mock-Muster des Projekts
folgen (`tests/lib/newsletter-access-tokens.test.ts:20-32`): ein generischer
Chain-Stub, bei dem jede Filtermethode die Chain zurückgibt und die Filter
`vi.fn()`s sind. Damit prüfen die Tests, **welche Constraints** die Query
angewendet hat — nicht den Rückgabewert. Das ist die Eigenschaft, um die es hier
geht.

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  result: { data: [] as unknown, error: null as unknown },
  chains: [] as any[],
}))

function makeChain() {
  const chain: any = {}
  // 'in' ist nötig, weil applyTranslations .in('term_id', ids) nutzt.
  for (const m of ['select', 'eq', 'in', 'is', 'gt', 'order', 'limit', 'update', 'insert', 'delete']) {
    chain[m] = vi.fn(() => chain)
  }
  chain.single = vi.fn(async () => state.result)
  chain.maybeSingle = vi.fn(async () => state.result)
  chain.then = (res: (v: unknown) => void) => res(state.result)  // await auf die Chain
  state.chains.push(chain)
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: vi.fn(() => makeChain()) }),
}))

describe('getPublishedTermList', () => {
  beforeEach(() => { state.chains.length = 0 })

  it('selektiert kein body-JSONB', async () => {
    const { getPublishedTermList } = await import('@/lib/glossary/terms')
    await getPublishedTermList('de')
    const cols = state.chains[0].select.mock.calls[0][0] as string
    expect(cols).not.toContain('body')
    expect(cols).toContain('slug')
  })

  it('filtert auf status=published', async () => {
    const { getPublishedTermList } = await import('@/lib/glossary/terms')
    await getPublishedTermList('de')
    expect(state.chains[0].eq).toHaveBeenCalledWith('status', 'published')
  })

  it('übergibt term_ids an die Übersetzungsabfrage statt nur die Sprache', async () => {
    // Der PK ist (term_id, language) — ein Filter nur auf language nutzt den
    // Präfix nicht und läuft als Seq-Scan über alle Sprachen.
    state.result = { data: [{ id: 't1', slug: 's', canonical_name: 'N', summary: 'S' }], error: null }
    const { getPublishedTermList } = await import('@/lib/glossary/terms')
    await getPublishedTermList('en')
    const t9nChain = state.chains[1]
    expect(t9nChain.in).toHaveBeenCalledWith('term_id', ['t1'])
    expect(t9nChain.eq).toHaveBeenCalledWith('language', 'en')
  })
})
```

Die genaue Terminal-Mechanik (`then` vs. `await` auf die Chain) am Vorbild
abgleichen — entscheidend ist, dass die Filter-Aufrufe prüfbar bleiben.

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

interface TranslatableRow {
  id: string
  slug: string
  canonicalName: string
  summary: string
}

/**
 * Überschreibt Name und Summary mit der Übersetzung, wo eine existiert.
 * Fehlt sie, bleibt die deutsche Fassung stehen — besser als eine Lücke.
 *
 * Die `term_id`s werden bewusst mitgegeben statt nur auf `language` zu
 * filtern: der Primary Key ist `(term_id, language)`, ein language-only-Filter
 * nutzt dessen Präfix nicht und läuft als Seq-Scan über alle Sprachen. Mit den
 * IDs greift der PK, und es werden nur die tatsächlich benötigten Zeilen
 * übertragen — in diesem Projekt hat genau dieser Reflex 109 GB Egress
 * gekostet.
 */
async function applyTranslations<T extends TranslatableRow>(
  rows: T[],
  lang: string,
): Promise<T[]> {
  if (rows.length === 0) return rows
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('glossary_term_translations')
    .select('term_id, canonical_name, summary')
    .in('term_id', rows.map((r) => r.id))
    .eq('language', lang)
  if (error) {
    // Fehlende Übersetzungen sind kein Grund, die Seite leer zu rendern.
    console.error('[Glossary] applyTranslations:', error.message)
    return rows
  }
  const byId = new Map(
    (data ?? []).map((t) => [
      t.term_id as string,
      { canonicalName: t.canonical_name as string | null, summary: t.summary as string | null },
    ]),
  )
  return rows.map((r) => {
    const t9n = byId.get(r.id)
    if (!t9n) return r
    return {
      ...r,
      canonicalName: t9n.canonicalName ?? r.canonicalName,
      summary: t9n.summary ?? r.summary,
    }
  })
}
```

`getPublishedTermList` muss dafür `id` mitselektieren und intern durchreichen —
nach außen bleibt `{ slug, canonicalName, summary }`, die `id` wird vor der
Rückgabe verworfen. `LIST_COLUMNS` lautet also
`'id, slug, canonical_name, summary'`.

**Querverlinkung: `relatedTerms` hat keine eigene Datenquelle — und braucht keine.**

Das Schema kennt keine Relationstabelle zwischen Begriffen, und kein Task
erzeugt eine. Die Verwandtschaft entsteht stattdessen aus dem Text: der Loader
lässt `findGlossaryMentions` über den Klartext des eigenen `body` laufen, mit
allen veröffentlichten Begriffen außer dem eigenen als Kandidaten. Was die
Erklärung erwähnt, ist verwandt.

Im selben Durchlauf werden die Marks in den Body injiziert — das ist die
eigentliche Anforderung („das Lexikon ist untereinander verlinkt"), nicht bloß
ein Block darunter:

```ts
const candidates = (await getMatcherTerms(lang)).filter((t) => t.slug !== slug)
const mentions = findGlossaryMentions(extractVisibleText(term.body), candidates)
const relatedSlugs = mentions.map((m) => m.slug)
const linkedBody = injectGlossaryMarks(term.body, relatedSlugs, candidates)
```

Warum im Loader und nicht bei der Anzeige oder der Generierung: der Loader hat
die Kandidatenliste schon geladen (ein zweiter Satz Queries pro Seitenaufruf
wäre der falsche Reflex in diesem Projekt), und die Injektion wirkt hier
**rückwirkend** — ein neuer Begriff erscheint beim nächsten Revalidate in allen
älteren Erklärtexten, die ihn erwähnen. Beim Generieren injiziert (Task 8) wären
alte Texte für immer unverlinkt.

Bewusste Grenzen: kein `reserved` (der Erklärtext ist keine Nachrichtenmeldung
voller Firmennamen, die Liste zu laden kostet mehr als sie bringt);
asymmetrische Verwandtschaft ist in Ordnung und wird nicht symmetrisiert.

`lib/glossary/detail.ts`:

```ts
import { cache } from 'react'

/** cache() verhindert, dass generateMetadata und die Page dieselbe Query
 *  zweimal absetzen — das verdoppelt sonst den Egress pro Seitenaufruf. */
export const getGlossaryTerm = cache(async (slug: string, lang: string) => {
  // Begriff + verwandte Begriffe + Produkte + News in vier schmalen Queries
})
```

> **Hinweis:** React `cache()` wird im Projekt bislang **nirgends** verwendet —
> es gibt kein Vorbild, nach dem sich suchen ließe. Das ist kein Versehen im
> Plan, sondern der Grund, warum die Spec diesen Egress-Punkt aufführt:
> `app/[lang]/rankings/[slug]/page.tsx` ruft `getProductDetail` sowohl in
> `generateMetadata` als auch im Seitenkörper auf, also zwei Queries pro
> Aufruf. Bei rund 5000 Produktseiten ist das die Hälfte des Egress dieser
> Route. Hier wird es von Anfang an richtig gemacht.
>
> **Die Memoisierung ist nicht unit-testbar, und das ist keine Lücke.**
> `cache()` memoisiert nur innerhalb eines aktiven RSC-Renders. Außerhalb —
> also in jedem Vitest-Lauf mit `environment: 'node'` — ist der Dispatcher ein
> No-Op und jeder Aufruf führt die Funktion frisch aus (empirisch geprüft,
> React 19.2.0). Ein Test „zweiter Aufruf trifft die DB nicht erneut" schlägt
> deshalb fehl, obwohl der Code korrekt ist. Auch gegen Produktion ist die
> Query-Anzahl für einen einzelnen Aufruf nicht sinnvoll zählbar; die
> Verdoppelung zeigt sich erst verzögert in den Egress-Metriken.
>
> Statt eines Tests, der nur Zeremonie wäre: ein Kommentar am Loader, der
> festhält **warum** `cache()` dort steht und **warum kein Test es deckt** —
> sonst verschwindet die Zeile beim nächsten Aufräumen als „unnötiger Wrapper".
> Der Review darf den fehlenden Test nicht als Lücke werten.

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
    // Die Dither-Illustration als OG-Bild, wenn es eine gibt — geteilte Links
    // zeigen sonst nichts. `pathByLocale` ist nicht nötig: der Slug entsteht aus
    // dem deutschen Begriff und ist damit sprachunabhängig.
    ogImage: term.illustrationUrl ?? undefined,
  })
}
```

Verfügbare Parameter von `generateLocalizedMetadata` (verifiziert,
`lib/i18n/metadata.ts:30-40`): `title`, `description`, `path`,
`availableLocales`, `noIndex`, `locale`, `ogImage`, `ogType`, `pathByLocale`.
`safeJsonLd(x: unknown): string` (`lib/seo/site.ts:7`) escapt `<` und ist für
`dangerouslySetInnerHTML` gedacht.

- [ ] **Step 2: HTML-Reihenfolge und visuelle Hierarchie**

Reihenfolge im **HTML**, nicht nur optisch: H1 → `summary` als Lead →
Illustration → Erklärungstext (volle Breite) → Trennung → arrondierende Blöcke.
LLMs zitieren den ersten substanziellen Textblock; steht dort eine Produktliste,
verwässert das genau die Passage, für die die Seite existiert.

Die Hierarchie ist die Kernanforderung des Auftrags („der Erklärungstext ist der
Hauptfokus"), also konkret:

| Zone | Gestaltung |
|---|---|
| H1 + Lead | größte Typo der Seite, Lead deutlich größer als Fließtext |
| Erklärungstext | volle Spaltenbreite, Lesetypografie (`prose`-Klassen wie im Artikel-Renderer), keine Konkurrenz daneben |
| Trennung | sichtbare Grenze — Linie oder deutlicher Abstand |
| Arrondierung | kleinere Typo, gedämpfte Farben, kompakt; nie mehrspaltig neben dem Text |

Kein Sidebar-Layout: der Text bekommt die Seite, die Zusatzblöcke kommen
darunter. Ein zweispaltiges Layout mit News neben dem Erklärtext wäre die
naheliegende, aber falsche Wahl — es stellt Arrondierung auf Augenhöhe mit dem
Inhalt.

**Seitenrahmen:** `app/[lang]/layout.tsx` liefert nur `{children}`, keinen
Header oder Footer. Die Seite bringt ihren Rahmen selbst mit, nach dem Muster
von `app/[lang]/rankings/[slug]/page.tsx`: `BloomLanguageSwitcher` und
`SiteFooter` importieren und einbinden.

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

Drei Server-Komponenten in `components/glossary/`, jede rendert **`null`** bei
leeren Daten — kein leerer Kasten, keine Überschrift ohne Inhalt. Das ist heute
der Normalfall: `glossary_term_products` und `glossary_term_news` werden erst
von Task 14/15 gefüllt.

| Komponente | Props | Inhalt |
|---|---|---|
| `related-terms.tsx` | `terms: Array<{ slug, canonicalName }>`, `lang` | Liste von Links auf `/${lang}/glossary/${slug}` |
| `term-products.tsx` | `products: Array<{ slug, canonicalName }>`, `lang` | Liste von Links auf `/${lang}/rankings/${slug}` |
| `term-news.tsx` | `news: Array<{ title, sourceName, sourceUrl, publishedAt, contextSentence }>`, `lang` | Titel als externer Link, Quelle und Datum klein, Einordnungssatz darunter |

News-Links sind extern: `target="_blank"` mit `rel="noopener noreferrer"`, wie
`Link.configure` es im Renderer für Quellenlinks macht. Die anderen beiden sind
interne `next/link`.

Labels kommen über `getTranslations` — keine deutschen Strings hartcodieren, das
holt Task 18 nicht nachträglich ein.

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
  query_embedding vector(768),
  since timestamptz,
  match_limit int default 5
)
returns table (id uuid, title text, source_url text,
               published_at timestamptz, similarity numeric)
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select r.id, r.title, r.source_url, r.collected_at,
         1 - (r.embedding <=> query_embedding) as similarity
  from public.daily_repo r
  where r.embedding is not null
    -- Nur Artikel und Webcrawl: Newsletter-Rows enthalten den gesamten
    -- Newsletter-Plaintext über mehrere Themen, ein Embedding-Treffer sagt
    -- dort nichts über den Begriff aus, und source_url ist unzuverlässig
    -- (lib/newsletter/fetcher.ts:473-478). source_type kennt außerdem
    -- 'newsletter' und 'email_note' — beide sind hier ungeeignet.
    and r.source_type in ('article', 'webcrawl')
    and r.collected_at >= since
  order by r.embedding <=> query_embedding
  limit match_limit;
$$;

revoke all on function public.match_glossary_news(vector, timestamptz, int) from public;
revoke all on function public.match_glossary_news(vector, timestamptz, int) from anon;
revoke all on function public.match_glossary_news(vector, timestamptz, int) from authenticated;
grant execute on function public.match_glossary_news(vector, timestamptz, int) to service_role;
```

> Verifiziert: `daily_repo` führt `id, title, content, source_type,
> source_email, source_url, collected_at, embedding` — die Datumsspalte heißt
> `collected_at`, und eine Spalte `source_name` existiert **nicht**. Der
> Quellenname wird im Cron aus der Host-Komponente von `source_url` abgeleitet
> und nach `glossary_term_news.source_name` geschrieben.

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

Kandidatenliste laden (schmal: `id, canonical_name, vendor`), LLM ordnet zu und
liefert `relevance`. Upsert nach `glossary_term_products` mit `source = 'llm'`,
aber nur für Zeilen ohne `source = 'manual'`.

**Achtung, die beiden Filter liegen auf verschiedenen Tabellen:**
`visibility_status` ist eine Spalte von `products` (Werte `visible` | `hidden` |
`suppressed`, `supabase/migrations/20260628150000_rankings_schema.sql:22`),
`chartable` dagegen von `product_metrics`
(`20260701150000_product_metrics_chartable.sql:3`). Die Kandidaten-Query braucht
also einen Join:

```ts
const { data } = await supabase
  .from('products')
  .select('id, canonical_name, vendor, product_metrics!inner(chartable)')
  .eq('visibility_status', 'visible')
  .eq('product_metrics.chartable', true)
```

Den genauen Beziehungsnamen an einer bestehenden Query prüfen — `lib/rankings/`
enthält Vorbilder für den Join zwischen `products` und `product_metrics`.

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

**Vor Umsetzungsbeginn am Bestandscode verifiziert** (2026-08-03) — diese Werte
sind keine Annahmen mehr:

- Embedding-Dimension ist projektweit **`vector(768)`** (17 Vorkommen in den
  Migrationen, kein einziges 1536). Bei pgvector ist eine Abweichung ein harter
  Insert-Fehler, keine Warnung.
- Der Export in `lib/tiptap/render-static-html.ts` heißt
  **`renderStaticArticleHtml`**.
- `daily_repo` führt `id, title, content, source_type, source_email, source_url,
  collected_at, embedding`. Datumsspalte ist `collected_at`; `source_name`
  existiert nicht. `source_type` kennt `article`, `webcrawl`, `newsletter`,
  `email_note`.
- `visibility_status` liegt auf `products`, `chartable` auf `product_metrics` —
  der Filter braucht einen Join (Task 15).
- Es gibt genau **zwei** generische `{...}`-Strips, nicht drei:
  `lib/tiptap/render-static-html.ts:44` (`/\{[^{}<>\n]{1,80}\}/g`) und
  `lib/email/tiptap-to-html.ts:174` (`/\{([^}]+)\}/g`). **Beide ersetzen durch
  den Leerstring**, nicht durch `$1` — eine `{lex:Begriff}`-Direktive würde
  also samt Begriff aus dem Text verschwinden. `stripLexTags` muss vor beiden
  laufen.
- `renderStaticArticleHtml` endet auf `catch { return '' }`
  (`render-static-html.ts:48-49`) — der stille Totalverlust bei unbekannten
  Node-/Mark-Typen ist damit im Code bestätigt.

**Noch offen, bei der Umsetzung zu klären:**

1. `ditheringCoarseness: 3` für Illustrationen ist eine begründete Annahme, kein
   Messergebnis (Task 9, Step 5).
2. Ob eine Funktion für die Chart-Produktnamen existiert oder eine schmale Query
   nötig ist (Task 11, Step 3).
3. Der `PATCH`-Export-Name und die Body-Struktur in
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
