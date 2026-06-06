# Podcast-Tip-Promo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein neuer Tip-Promo-Typ `'podcast'`, der die auf ~50% gekürzten Show Notes der aktuellen Episode plus verlinkte Apple/Spotify-Badges in Web-Artikel und Newsletter zeigt — und solange er aktiv ist, die bestehenden Cover-Podcast-Icons ausblendet.

**Architecture:** `tip_promos.type` unterscheidet `'static'` (wie bisher) und `'podcast'`. Show Notes werden beim Podigee-Publish in `post_podcasts` persistiert; die 50%-Kürzung erzeugt Haiku einmalig beim Publish (kein LLM im Render-Pfad). `getActiveTipPromo()` reichert Podcast-Promos zur Render-Zeit mit der neuesten Episode an; Web (`TipPromoBox`) und Email (`generateEmailContentWithVotes`) rendern Show Notes + Badges.

**Tech Stack:** Next.js 16, TypeScript, Supabase (Postgres), Anthropic SDK (Haiku), React Email (resend), vitest.

**Spec:** `docs/superpowers/specs/2026-06-06-podcast-tip-promo-design.md`

---

## File Structure

| Datei | Verantwortung |
|-------|---------------|
| `supabase/migrations/20260606120000_podcast_tip_promo.sql` | DB: `tip_promos.type`, `post_podcasts.show_notes*` |
| `lib/podcast/platform-links.ts` | **neu** — geteilte Apple/Spotify-Show-URLs + Icon-Pfade |
| `lib/podcast/show-notes.ts` | **neu** — `summarizeShowNotes()` (Haiku) + `truncateToHalf()` Fallback |
| `tests/lib/show-notes.test.ts` | **neu** — Unit-Test für `truncateToHalf` |
| `lib/tip-promos/types.ts` | `type` + optionales `podcast`-Feld am `TipPromo` |
| `lib/tip-promos/get-active.ts` | Podcast-Promo mit aktueller Episode anreichern |
| `tests/lib/tip-promo-active.test.ts` | **neu** — Unit-Test für Anreicherung/Skip-Logik |
| `app/api/podcast/publish-podigee/route.ts` | Show Notes + 50%-Summary speichern |
| `components/podcast-badges.tsx` | `variant="promo"` (nur 2 Badge-Links) + Links aus platform-links |
| `components/tip-promo-box.tsx` | Podcast-Rendering (Web) |
| `lib/email/tiptap-to-html.ts` | Podcast-Rendering (Email) in `generateEmailContentWithVotes` |
| `app/api/tip-promos/active/route.ts` | angereicherte Podcast-Felder mitliefern |
| `app/admin/tip-promos/page.tsx` | Typ-Auswahl + Vorschau |
| `app/api/admin/tip-promos/route.ts`, `[id]/route.ts` | `type`-Handling |
| `app/posts/[slug]/page.tsx`, `app/[lang]/posts/[slug]/page.tsx` | Cover-Badges bei aktivem Podcast-Promo ausblenden |
| `components/featured-article.tsx` | `hidePodcastBadges`-Prop |
| `lib/resend/templates/newsletter.tsx` | Cover-Badge-Section bei aktivem Podcast-Promo überspringen |

---

## Task 1: DB-Migration

**Files:**
- Create: `supabase/migrations/20260606120000_podcast_tip_promo.sql`

- [ ] **Step 1: Migration schreiben**

```sql
-- Podcast-Tip-Promo: neuer Promo-Typ + Show-Notes-Persistenz

ALTER TABLE tip_promos
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'static';

ALTER TABLE tip_promos
  ADD CONSTRAINT tip_promos_type_check CHECK (type IN ('static', 'podcast'));

ALTER TABLE post_podcasts
  ADD COLUMN IF NOT EXISTS episode_title    TEXT,
  ADD COLUMN IF NOT EXISTS episode_subtitle TEXT,
  ADD COLUMN IF NOT EXISTS show_notes       TEXT,
  ADD COLUMN IF NOT EXISTS show_notes_short TEXT;

-- Schnell die neueste veröffentlichte Episode mit Show Notes finden (Render-Pfad).
CREATE INDEX IF NOT EXISTS idx_post_podcasts_published_shownotes
  ON post_podcasts (podigee_published_at DESC)
  WHERE podigee_episode_url IS NOT NULL AND show_notes_short IS NOT NULL;
```

- [ ] **Step 2: Migration anwenden**

Anwenden über Supabase MCP `apply_migration` (project_id `zadrjbyszvsusukajsbp`, name `podcast_tip_promo`) ODER `supabase db push`.

- [ ] **Step 3: Verifizieren**

SQL: `SELECT column_name FROM information_schema.columns WHERE table_name='post_podcasts' AND column_name LIKE 'show_notes%';`
Expected: `show_notes`, `show_notes_short`.
SQL: `SELECT column_name FROM information_schema.columns WHERE table_name='tip_promos' AND column_name='type';`
Expected: `type`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260606120000_podcast_tip_promo.sql
git commit -m "feat(tip-promo): migration — tip_promos.type + post_podcasts show_notes"
```

---

## Task 2: Geteilte Platform-Links-Konstante

**Files:**
- Create: `lib/podcast/platform-links.ts`
- Modify: `components/podcast-badges.tsx:3-13` (Konstanten durch Import ersetzen)

- [ ] **Step 1: Konstante anlegen**

```typescript
// lib/podcast/platform-links.ts
// Single source of truth for the Synthszr podcast platform links + icons.
// Show-level (not per-episode) — used by web badges, email HTML, and the
// podcast tip-promo.
export const PODCAST_APPLE = {
  name: 'Apple Podcasts',
  image: '/podcast-apple.png',
  url: 'https://podcasts.apple.com/de/podcast/synthszr/id1879733990',
} as const

export const PODCAST_SPOTIFY = {
  name: 'Spotify',
  image: '/podcast-spotify.png',
  url: 'https://open.spotify.com/show/0FJkPjKXvobgqI8U881yiF?si=wMJJ-CQxQdyuW18VXQZQOQ',
} as const
```

- [ ] **Step 2: `podcast-badges.tsx` auf die Konstante umstellen**

In `components/podcast-badges.tsx` die lokalen `APPLE`/`SPOTIFY`-Objekte (Z.3-13) entfernen und ersetzen durch:

```typescript
import { PODCAST_APPLE as APPLE, PODCAST_SPOTIFY as SPOTIFY } from '@/lib/podcast/platform-links'
```

(Rest der Datei unverändert — `APPLE`/`SPOTIFY` werden weiter verwendet.)

- [ ] **Step 3: tsc prüfen**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/podcast/platform-links.ts components/podcast-badges.tsx
git commit -m "refactor(podcast): shared platform-links constant"
```

---

## Task 3: Show-Notes-Kürzung (mit Unit-Test)

**Files:**
- Create: `lib/podcast/show-notes.ts`
- Test: `tests/lib/show-notes.test.ts`

- [ ] **Step 1: Failing Test schreiben**

```typescript
// tests/lib/show-notes.test.ts
import { describe, it, expect } from 'vitest'
import { truncateToHalf } from '@/lib/podcast/show-notes'

describe('truncateToHalf', () => {
  it('keeps roughly the first half by word count, ending on a sentence', () => {
    const text = 'One two three. Four five six. Seven eight nine. Ten eleven twelve.'
    const out = truncateToHalf(text)
    // 12 words → ~6 words target; cut on a sentence boundary, so first 1-2 sentences.
    expect(out.length).toBeLessThan(text.length)
    expect(out.startsWith('One two three.')).toBe(true)
    expect(out.endsWith('…')).toBe(true)
  })

  it('returns the text unchanged when it is a single short sentence', () => {
    const text = 'Just one sentence.'
    expect(truncateToHalf(text)).toBe('Just one sentence.')
  })

  it('handles empty input', () => {
    expect(truncateToHalf('')).toBe('')
  })
})
```

- [ ] **Step 2: Test laufen lassen → fehlschlägt**

Run: `npx vitest run tests/lib/show-notes.test.ts`
Expected: FAIL ("truncateToHalf is not a function" / module not found).

- [ ] **Step 3: Implementierung schreiben**

```typescript
// lib/podcast/show-notes.ts
import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-haiku-4-5-20251001'

/**
 * Deterministic fallback: keep whole sentences until ~50% of the word count
 * is reached, append an ellipsis. Used when the LLM summary is unavailable.
 */
export function truncateToHalf(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const sentences = trimmed.match(/[^.!?]+[.!?]+|\S+$/g) ?? [trimmed]
  if (sentences.length <= 1) return trimmed
  const totalWords = trimmed.split(/\s+/).length
  const target = Math.max(1, Math.round(totalWords / 2))
  let out = ''
  let words = 0
  for (const s of sentences) {
    const sentenceWords = s.trim().split(/\s+/).length
    if (words > 0 && words + sentenceWords > target) break
    out += s
    words += sentenceWords
  }
  out = out.trim()
  if (!out) out = sentences[0].trim()
  return out.replace(/[.!?]+$/, '') + '…'
}

/**
 * Summarize podcast show notes to ~50% of their length via Haiku.
 * Fail-soft: on any error returns truncateToHalf(text).
 */
export async function summarizeShowNotes(text: string, locale: string): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return truncateToHalf(trimmed)

  const langName = locale === 'de' ? 'German' : 'the same language as the input'
  try {
    const anthropic = new Anthropic({ apiKey })
    const targetWords = Math.max(15, Math.round(trimmed.split(/\s+/).length / 2))
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Shorten these podcast show notes to about ${targetWords} words (roughly half). `
          + `Keep the most compelling hook and concrete facts/numbers. Write in ${langName}, `
          + `coherent prose (no bullet points), no preamble — return only the shortened text.\n\n${trimmed}`,
      }],
    })
    const out = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text).join('').trim()
    return out || truncateToHalf(trimmed)
  } catch (err) {
    console.warn('[ShowNotes] summarize failed, using truncate fallback', err)
    return truncateToHalf(trimmed)
  }
}
```

- [ ] **Step 4: Test laufen lassen → besteht**

Run: `npx vitest run tests/lib/show-notes.test.ts`
Expected: PASS (3 Tests).

- [ ] **Step 5: Commit**

```bash
git add lib/podcast/show-notes.ts tests/lib/show-notes.test.ts
git commit -m "feat(podcast): show-notes summarizer + half-truncate fallback"
```

---

## Task 4: Publish-Flow speichert Show Notes + Summary

**Files:**
- Modify: `app/api/podcast/publish-podigee/route.ts:286-324` (post_podcasts update block)

- [ ] **Step 1: Summary erzeugen + Update-Objekt erweitern**

In `app/api/podcast/publish-podigee/route.ts`, oben den Import ergänzen:

```typescript
import { summarizeShowNotes } from '@/lib/podcast/show-notes'
```

Den Persistenz-Block (ab `const nowIso = new Date().toISOString()`) so anpassen, dass Show Notes + Summary mitgeschrieben werden. Locale aus der Episode ableiten — falls nicht im Body, default `'en'` (Show Notes sind EN):

```typescript
    {
      const nowIso = new Date().toISOString()
      const showNotesShort = description ? await summarizeShowNotes(description, 'en') : null
      const update = {
        podigee_episode_id: episodeId,
        podigee_episode_url: episodeUrl,
        podigee_published_at: nowIso,
        episode_title: title,
        episode_subtitle: subtitle,
        show_notes: description || null,
        show_notes_short: showNotesShort,
      }

      const { data: byAudio } = await supabase
        .from('post_podcasts')
        .update(update)
        .eq('post_id', postId)
        .eq('audio_url', audioUrl)
        .select('id')

      if (!byAudio || byAudio.length === 0) {
        const { data: latestForPost } = await supabase
          .from('post_podcasts')
          .select('id')
          .eq('post_id', postId)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (latestForPost?.id) {
          await supabase
            .from('post_podcasts')
            .update(update)
            .eq('id', latestForPost.id)
        } else {
          console.warn('[Publish Podigee] No post_podcasts row found to record podigee state', { postId, audioUrl })
        }
      }
    }
```

- [ ] **Step 2: tsc prüfen**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/api/podcast/publish-podigee/route.ts
git commit -m "feat(podcast): persist show notes + 50% summary on publish"
```

- [ ] **Step 4: Prod-Verifikation (nach Deploy)**

Eine Episode veröffentlichen (oder eine Test-Veröffentlichung) und prüfen:
SQL: `SELECT episode_title, length(show_notes) AS full_len, length(show_notes_short) AS short_len FROM post_podcasts WHERE show_notes IS NOT NULL ORDER BY podigee_published_at DESC LIMIT 1;`
Expected: `short_len` ≈ halb von `full_len`.

---

## Task 5: TipPromo-Typ + get-active Anreicherung (mit Unit-Test)

**Files:**
- Modify: `lib/tip-promos/types.ts`
- Modify: `lib/tip-promos/get-active.ts`
- Test: `tests/lib/tip-promo-active.test.ts`

- [ ] **Step 1: Typ erweitern**

`lib/tip-promos/types.ts` — `TipPromo` erweitern:

```typescript
export interface TipPromo {
  id: string
  name: string
  headline: string
  body: string
  link_url: string
  cta_label: string
  gradient_from: string
  gradient_to: string
  gradient_direction: string
  text_color: string
  active: boolean
  sort_order: number
  type: 'static' | 'podcast'
  created_at: string
  updated_at: string
  // Render-time enrichment for type='podcast' (set by getActiveTipPromo):
  podcast?: {
    showNotesShort: string
    episodeTitle: string | null
  }
}
```

- [ ] **Step 2: Failing Test für Anreicherung**

```typescript
// tests/lib/tip-promo-active.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const podcastPromo = {
  id: 'p1', name: 'Podcast', headline: 'HÖR REIN', body: '', link_url: '', cta_label: '',
  gradient_from: '#000', gradient_to: '#111', gradient_direction: 'to right', text_color: '#fff',
  active: true, sort_order: 0, type: 'podcast', created_at: '2026-01-01', updated_at: '2026-01-01',
}

function mockSupabase(opts: { promos: unknown[]; episode: unknown | null }) {
  return {
    from: (table: string) => {
      if (table === 'settings') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => ({ data: { value: { mode: 'constant', constantId: 'p1' } } }) }) }) }
      }
      if (table === 'tip_promos') {
        return { select: () => ({ eq: () => ({ order: () => ({ order: () => ({ data: opts.promos }) }) }) }) }
      }
      // post_podcasts
      return { select: () => ({ not: () => ({ not: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => ({ data: opts.episode }) }) }) }) }) }) }
    },
  }
}

describe('getActiveTipPromo — podcast enrichment', () => {
  beforeEach(() => vi.resetModules())

  it('enriches a podcast promo with the latest episode show notes', async () => {
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => mockSupabase({ promos: [podcastPromo], episode: { show_notes_short: 'Short notes…', episode_title: 'Ep 1' } }),
    }))
    const { getActiveTipPromo } = await import('@/lib/tip-promos/get-active')
    const promo = await getActiveTipPromo()
    expect(promo?.type).toBe('podcast')
    expect(promo?.podcast?.showNotesShort).toBe('Short notes…')
  })

  it('returns null for a podcast promo when no episode with show notes exists', async () => {
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => mockSupabase({ promos: [podcastPromo], episode: null }),
    }))
    const { getActiveTipPromo } = await import('@/lib/tip-promos/get-active')
    const promo = await getActiveTipPromo()
    expect(promo).toBeNull()
  })
})
```

- [ ] **Step 3: Test laufen lassen → fehlschlägt**

Run: `npx vitest run tests/lib/tip-promo-active.test.ts`
Expected: FAIL (Anreicherung fehlt; `podcast` undefined / Promo wird nicht auf null gesetzt).

- [ ] **Step 4: get-active.ts anreichern**

In `lib/tip-promos/get-active.ts` die finale Auswahl durch eine Anreicherungs-Funktion ersetzen. Vor `return` (Z.31 und Z.38) das gewählte Promo durch `enrich(selected)` schicken:

```typescript
import { createAdminClient } from '@/lib/supabase/admin'
import type { TipPromo, TipPromoConfig } from './types'

const DEFAULT_CONFIG: TipPromoConfig = { mode: 'rotate', constantId: null }

async function enrichPodcast(promo: TipPromo): Promise<TipPromo | null> {
  if (promo.type !== 'podcast') return promo
  const supabase = createAdminClient()
  const { data: ep } = await supabase
    .from('post_podcasts')
    .select('show_notes_short, episode_title')
    .not('podigee_episode_url', 'is', null)
    .not('show_notes_short', 'is', null)
    .order('podigee_published_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!ep?.show_notes_short) return null // keine Episode → Promo nicht ausspielen
  return { ...promo, podcast: { showNotesShort: ep.show_notes_short, episodeTitle: ep.episode_title ?? null } }
}

export async function getActiveTipPromo(): Promise<TipPromo | null> {
  const supabase = createAdminClient()

  const [{ data: configRow }, { data: promos }] = await Promise.all([
    supabase.from('settings').select('value').eq('key', 'tip_promo_config').maybeSingle(),
    supabase
      .from('tip_promos')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  const config: TipPromoConfig = (configRow?.value as TipPromoConfig) ?? DEFAULT_CONFIG

  if (config.mode === 'off') return null
  if (!promos || promos.length === 0) return null

  if (config.mode === 'constant' && config.constantId) {
    const pinned = promos.find(p => p.id === config.constantId)
    if (pinned) return enrichPodcast(pinned as TipPromo)
  }

  const now = new Date()
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 0)
  const dayOfYear = Math.floor((now.getTime() - startOfYear) / 86400000)
  const idx = dayOfYear % promos.length
  return enrichPodcast(promos[idx] as TipPromo)
}
```

- [ ] **Step 5: Test laufen lassen → besteht**

Run: `npx vitest run tests/lib/tip-promo-active.test.ts`
Expected: PASS (2 Tests).

- [ ] **Step 6: Commit**

```bash
git add lib/tip-promos/types.ts lib/tip-promos/get-active.ts tests/lib/tip-promo-active.test.ts
git commit -m "feat(tip-promo): type field + podcast enrichment in get-active"
```

---

## Task 6: Web-Rendering (TipPromoBox + Badge-Variante)

**Files:**
- Modify: `components/podcast-badges.tsx` (kompakte `variant`)
- Modify: `components/tip-promo-box.tsx`

- [ ] **Step 1: Kompakte Badge-Variante**

In `components/podcast-badges.tsx` eine eigenständige, exportierte Komponente ergänzen, die nur die zwei verlinkten Badges zentriert rendert (ohne Player):

```typescript
import { PODCAST_APPLE as APPLE, PODCAST_SPOTIFY as SPOTIFY } from '@/lib/podcast/platform-links'

export function PodcastPromoBadges() {
  return (
    <div className="mt-3 flex items-center justify-center gap-4">
      {[APPLE, SPOTIFY].map((b) => (
        <a key={b.name} href={b.url} target="_blank" rel="noopener noreferrer"
           className="inline-block hover:opacity-80 transition-opacity">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={b.image} alt={b.name} style={{ height: 28, width: 'auto' }} />
        </a>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: TipPromoBox um Podcast-Zweig erweitern**

`components/tip-promo-box.tsx` — Import + Podcast-Zweig:

```typescript
import type { TipPromo } from '@/lib/tip-promos/types'
import { sanitizeAdminHtml } from '@/lib/security/sanitize-html'
import { PodcastPromoBadges } from '@/components/podcast-badges'

interface TipPromoBoxProps {
  promo: TipPromo
  inline?: boolean
}

export function TipPromoBox({ promo, inline = false }: TipPromoBoxProps) {
  const gradient = `linear-gradient(${promo.gradient_direction}, ${promo.gradient_from}, ${promo.gradient_to})`
  const isPodcast = promo.type === 'podcast' && !!promo.podcast
  const hasCta = !isPodcast && promo.link_url && promo.cta_label
  const isExternal = promo.link_url?.startsWith('http')

  return (
    <div
      className={`rounded-xl px-4 py-3 ${inline ? 'my-4' : 'my-6'} text-center`}
      style={{ background: gradient, color: promo.text_color }}
    >
      <div className="font-bold tracking-widest uppercase text-xs mb-1">
        {promo.headline}
      </div>

      {isPodcast ? (
        <>
          <div className="leading-snug">{promo.podcast!.showNotesShort}</div>
          <PodcastPromoBadges />
        </>
      ) : (
        <div
          className="leading-snug"
          dangerouslySetInnerHTML={{ __html: sanitizeAdminHtml(promo.body) }}
        />
      )}

      {hasCta && (
        <a
          href={promo.link_url}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noopener noreferrer' : undefined}
          className="mt-2 inline-block text-sm font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity"
          style={{ color: promo.text_color }}
        >
          {promo.cta_label}
        </a>
      )}
    </div>
  )
}
```

- [ ] **Step 3: tsc prüfen**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add components/podcast-badges.tsx components/tip-promo-box.tsx
git commit -m "feat(tip-promo): web rendering for podcast type (show notes + badges)"
```

---

## Task 7: Email-Rendering

**Files:**
- Modify: `lib/email/tiptap-to-html.ts` (`generateEmailContentWithVotes`, der Tip-Promo-HTML-Block)

- [ ] **Step 1: Tip-Promo-HTML im Email-Generator finden**

Run: `grep -n "tipPromo\|gradient\|Synthszr Take\|tip_promo" lib/email/tiptap-to-html.ts`
Den bestehenden Block lokalisieren, der die statische Promo-Tabelle (Gradient + body + CTA) vor dem ersten Synthszr Take einfügt.

- [ ] **Step 2: Podcast-Zweig im HTML-Block ergänzen**

Den Promo-HTML-Aufbau so erweitern, dass bei `tipPromo.type === 'podcast' && tipPromo.podcast` statt `body`/CTA die Show Notes + zwei verlinkte Badge-Images gerendert werden. Absolute URLs nutzen (Email braucht vollqualifizierte `src`/`href`). `baseUrl` ist im Generator bereits verfügbar (sonst aus `process.env.NEXT_PUBLIC_SITE_URL` / dem vorhandenen Pattern übernehmen). Apple/Spotify aus `@/lib/podcast/platform-links` importieren:

```typescript
import { PODCAST_APPLE, PODCAST_SPOTIFY } from '@/lib/podcast/platform-links'

// innerhalb des Promo-HTML-Aufbaus:
const isPodcast = tipPromo.type === 'podcast' && tipPromo.podcast
const promoInner = isPodcast
  ? `
    <div style="line-height:1.4;">${escapeHtml(tipPromo.podcast.showNotesShort)}</div>
    <div style="margin-top:12px;">
      <a href="${PODCAST_APPLE.url}" style="text-decoration:none;display:inline-block;margin:0 8px;">
        <img src="${baseUrl}${PODCAST_APPLE.image}" alt="${PODCAST_APPLE.name}" height="28" style="height:28px;width:auto;border:0;" />
      </a>
      <a href="${PODCAST_SPOTIFY.url}" style="text-decoration:none;display:inline-block;margin:0 8px;">
        <img src="${baseUrl}${PODCAST_SPOTIFY.image}" alt="${PODCAST_SPOTIFY.name}" height="28" style="height:28px;width:auto;border:0;" />
      </a>
    </div>`
  : `<div style="line-height:1.4;">${tipPromo.body}</div>${/* bestehender CTA-Block */ ''}`
```

Den `promoInner` in die bestehende Gradient-Tabellenzelle einsetzen (Headline + Gradient bleiben unverändert). `escapeHtml` ist bereits in der Datei vorhanden (sonst die dort genutzte Sanitisierung verwenden).

- [ ] **Step 3: tsc prüfen**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/email/tiptap-to-html.ts
git commit -m "feat(tip-promo): newsletter rendering for podcast type"
```

---

## Task 8: Cover-Badges bei aktivem Podcast-Promo ausblenden

**Files:**
- Modify: `app/posts/[slug]/page.tsx:173-177`
- Modify: `app/[lang]/posts/[slug]/page.tsx:389-393`
- Modify: `components/featured-article.tsx:96-102`
- Modify: `lib/resend/templates/newsletter.tsx:255-265`

- [ ] **Step 1: Web-Artikelseiten — Promo server-side prüfen**

In `app/posts/[slug]/page.tsx` (und identisch `app/[lang]/posts/[slug]/page.tsx`):
- Import: `import { getActiveTipPromo } from '@/lib/tip-promos/get-active'`
- In der async Page-Funktion vor dem Return:
  ```typescript
  const activeTipPromo = await getActiveTipPromo()
  const hidePodcastBadges = activeTipPromo?.type === 'podcast'
  ```
- Den `<PodcastBadges>…</PodcastBadges>`-Block in `{!hidePodcastBadges && ( … )}` wrappen.

- [ ] **Step 2: featured-article.tsx — Prop**

`components/featured-article.tsx`: Prop `hidePodcastBadges?: boolean` ergänzen, den `<PodcastBadges>`-Block (Z.96-102) nur rendern wenn `!hidePodcastBadges`. Aufrufer (die Page, die `getActiveTipPromo` kennt) reicht das Flag durch.

- [ ] **Step 3: Newsletter-Template — Section überspringen**

`lib/resend/templates/newsletter.tsx`:
- Prop `hidePodcastBadges?: boolean` zur Props-Definition ergänzen (default `false`).
- Die „Podcast Promo Section" (Z.255-265) in `{!hidePodcastBadges && ( … )}` wrappen.
- In den aufrufenden Routen (`app/api/admin/newsletter-send/route.ts`, `app/api/cron/newsletter-send/route.ts`), die `getActiveTipPromo()` bereits aufrufen, `hidePodcastBadges: activeTipPromo?.type === 'podcast'` an das Template übergeben.

- [ ] **Step 4: tsc prüfen**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/posts/[slug]/page.tsx app/[lang]/posts/[slug]/page.tsx components/featured-article.tsx lib/resend/templates/newsletter.tsx app/api/admin/newsletter-send/route.ts app/api/cron/newsletter-send/route.ts
git commit -m "feat(tip-promo): hide cover podcast badges when podcast promo active"
```

---

## Task 9: Admin-UI + API

**Files:**
- Modify: `app/api/admin/tip-promos/route.ts`, `app/api/admin/tip-promos/[id]/route.ts`
- Modify: `app/api/tip-promos/active/route.ts`
- Modify: `app/admin/tip-promos/page.tsx`

- [ ] **Step 1: API — `type` lesen/schreiben**

In `app/api/admin/tip-promos/route.ts` (POST) und `[id]/route.ts` (PUT/PATCH): `type` aus dem Body übernehmen (Validierung: nur `'static'`|`'podcast'`, default `'static'`) und in den insert/update einschließen.

- [ ] **Step 2: active-Route liefert Podcast-Felder**

`app/api/tip-promos/active/route.ts`: sicherstellen, dass das von `getActiveTipPromo()` angereicherte `podcast`-Feld im JSON enthalten ist (das gesamte Promo-Objekt zurückgeben, nicht einzelne Felder herauspicken).

- [ ] **Step 3: Admin-Editor — Typ-Auswahl**

`app/admin/tip-promos/page.tsx`:
- Im Promo-Formular ein Select `type` (`Statisch` / `Podcast`) ergänzen.
- Bei `type='podcast'`: `body`- und `cta_label`/`link_url`-Felder ausblenden; Hinweistext „Copy + Apple/Spotify-Badges werden automatisch aus der aktuellen Podcast-Episode erzeugt." anzeigen.
- `type` in den Save-Payload aufnehmen.

- [ ] **Step 4: tsc + Lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/tip-promos/route.ts app/api/admin/tip-promos/[id]/route.ts app/api/tip-promos/active/route.ts app/admin/tip-promos/page.tsx
git commit -m "feat(tip-promo): admin UI + API for podcast promo type"
```

---

## Task 10: Build + End-to-End-Verifikation (Prod)

**Files:** keine

- [ ] **Step 1: Voller Build**

Run: `npm run build`
Expected: erfolgreicher Build, keine Type-/Lint-Fehler.

- [ ] **Step 2: Push + Deploy**

```bash
git push origin main
```
Auf Vercel-Deployment (READY) warten.

- [ ] **Step 3: Podcast-Promo anlegen**

In `/admin/tip-promos` einen Promo mit `type='podcast'`, Headline (z.B. „HÖR DIE FOLGE"), Gradient anlegen, aktiv schalten und (für deterministische Anzeige) per `constant` in der Config pinnen.

- [ ] **Step 4: Web verifizieren**

Einen veröffentlichten Artikel mit publiziertem Podcast (Show Notes vorhanden) auf synthszr.com öffnen:
- Tip-Promo zeigt gekürzte Show Notes + Apple/Spotify-Badges (Links öffnen die Show).
- Die Podcast-Icons **unter dem Cover** sind ausgeblendet.

- [ ] **Step 5: Newsletter verifizieren**

Test-Newsletter senden / Vorschau:
- Promo zeigt Show Notes + Badge-Images (absolute URLs, klickbar).
- Cover-Badge-Section ist ausgeblendet.

- [ ] **Step 6: Negativfall**

Promo-Config auf einen statischen Promo umstellen → Cover-Badges erscheinen wieder; statischer Promo rendert wie zuvor (HTML-body + CTA).

---

## Notes

- **Reihenfolge:** Tasks 1→9 sind weitgehend sequentiell (5 hängt von 1+3; 6/7 von 5; 8 von 5). Task 2 (platform-links) ist Voraussetzung für 6+7.
- **Fail-soft überall:** Fehlt eine Episode mit Show Notes, wird der Podcast-Promo nicht ausgespielt (get-active → null) und die Cover-Badges bleiben sichtbar — kein leerer Zustand.
- **Bestehende statische Promos** bleiben durch `type DEFAULT 'static'` unverändert.
