# Fachbegriff-Lexikon — Design-Spec

Datum: 2026-08-03
Status: genehmigt, bereit für Implementierungsplan

## Ziel

Erklärungsbedürftige Fachbegriffe werden in Artikeln markiert und verlinkt. Ein
Klick führt auf eine Lexikonseite, deren LLM-generierter Erklärungstext ein
15-jähriger Gymnasiast ohne Vorwissen versteht — ohne bis zur Unschärfe zu
vereinfachen. Der Erklärungstext ist der Hauptinhalt der Seite; verwandte
Begriffe, Produkte aus den Synthszr Charts und aktuelle externe News sind
arrondierende Information.

Die Seiten sind SEO- und GEO-optimiert: sie sollen ranken und von LLMs als
Quelle zitiert werden.

## Geklärte Anforderungen

Entschieden im Brainstorming vom 2026-08-03:

1. **Erkennung hybrid.** Der Ghostwriter setzt `{lex:Begriff}`-Direktiven
   (sicher, gewollt). Zusätzlich matcht ein Server-Lauf die Begriffsliste gegen
   den Text und erzeugt Vorschläge. Nur bestätigte Begriffe werden verlinkt.
2. **Links werden beim Speichern persistiert.** Ein Server-Lauf schreibt echte
   TipTap-Marks in das gespeicherte JSON. Alle drei Ausgabepfade sehen sie ohne
   eigene Erkennungslogik.
3. **Freigabe im bestehenden Publishing-Flow**, vor dem Newsletter-Versand.
   Freigegeben wird die *Begriffsauswahl*; Slug und Erklärungstext entstehen
   vollautomatisch per LLM.
4. **Vollständiger Umfang in einem Plan** — inklusive News-Block, Produkt-
   Assoziation und Monats-Cron.
5. **Text ist Hauptfokus.** Illustrationen unterstützen, wenn sie helfen; alles
   Übrige ist visuell und in der HTML-Reihenfolge nachgeordnet.

### Gesetzte Defaults

Nicht explizit entschieden, sondern begründet gesetzt. Jeder einzeln umkehrbar:

| Punkt | Default | Grund |
|---|---|---|
| Sprachen | de/en | entspricht `SEO_LOCALES`; cs/nds/fr zeigen EN-Fallback ohne hreflang |
| Link-Policy | erste Erwähnung pro Begriff, max. 8 Begriffe/Artikel | Muster von `product-links.ts`; Lesbarkeit |
| Kollisionsregel | Company > Chart-Produkt > Lexikonbegriff | spezifisch vor generisch |
| Altartikel | kein Auto-Backfill; Skript manuell auslösbar | Kosten und Risiko kontrollierbar |
| News-Darstellung | Titel, Quelle, Datum, Link + ein eigener Einordnungssatz | urheberrechtlich sauber; die Volltexte sind ohnehin Newsletter-Blobs |
| Begriff→Produkt | LLM-Zuordnung bei Anlage, Refresh im Monats-Cron | Mapping existiert nirgends; nur `visible` + `chartable` |
| Route | `/[lang]/glossary/[slug]` | Projekt-Routensegmente sind englisch |
| Domäne | KI/Tech | Finanzbegriffe deckt teilweise `/companies` |
| Illustrationen | max. 1 pro Begriff, als Hero, optional | zwei Dither-Bilder konkurrieren mit dem Text |
| Verständlichkeit | LLM-Judge im Generator + harte Grenzen | messbar ohne neues Tooling |

## Architektur

### A) Datenmodell

Vier neue Tabellen, alle nach dem Muster aus `docs/security/security-runbook.md`
Abschnitt 5: RLS aktiviert, `revoke all` von `public`/`anon`/`authenticated`,
`grant` nur an `service_role`. Die Seiten rendern serverseitig mit
`createAdminClient()` — kein anon-Zugriff nötig.

**`glossary_terms`**

| Spalte | Typ | Zweck |
|---|---|---|
| `id` | uuid pk | |
| `slug` | text unique | URL-Segment, LLM-generiert, kleingeschrieben |
| `canonical_name` | text | Anzeigename, deutsch |
| `aliases` | text[] | Flexionen und Schreibvarianten für den Matcher |
| `status` | text | `draft` \| `published` \| `hidden` |
| `summary` | text | 1–2 Sätze; Lead, Meta-Description, GEO-Anker |
| `body` | jsonb | TipTap-Dokument, der Erklärungstext |
| `illustration_url` | text null | Vercel-Blob-URL des Dither-Bilds |
| `illustration_alt` | text null | beschreibender Alt-Text (SEO-relevant) |
| `embedding` | vector null | aus `canonical_name + summary`, für die News-Suche |
| `readability_score` | numeric null | Ergebnis der Verständlichkeitsprüfung |
| `review_state` | text | `ok` \| `flagged` \| `revision_pending` |
| `pending_body` | jsonb null | Cron-Revisionsvorschlag, bis zur Freigabe |
| `last_reviewed_at` | timestamptz null | |
| `created_at`, `updated_at` | timestamptz | |

`status`-Constraint als CHECK. Index auf `slug` (unique) und auf
`status` für Sitemap- und Matcher-Queries.

**`glossary_term_translations`**

`term_id` (fk, cascade), `language`, `canonical_name`, `aliases text[]`,
`summary`, `body jsonb`, `updated_at`. Primary Key `(term_id, language)`.

Eigene Tabelle statt `content_translations`: dessen CHECK-Constraint erlaubt nur
`generated_post | static_page | ui`. Den Constraint für ein fremdes Schema
aufzubohren würde die Übersetzungs-Queue mit einem Typ belasten, dessen
Chunking- und Status-Semantik nicht passt.

**`glossary_term_products`**

`term_id` (fk, cascade), `product_id` (fk), `relevance numeric`,
`source text` (`llm` \| `manual`), `confirmed_at timestamptz null`.
Primary Key `(term_id, product_id)`.

**`glossary_term_news`**

`term_id` (fk, cascade), `repo_item_id` (fk auf `daily_repo`), `title`,
`source_name`, `source_url`, `published_at`, `context_sentence text`,
`similarity numeric`, `refreshed_at timestamptz`. Primary Key
`(term_id, repo_item_id)`.

Diese Tabelle ist nicht optional: ohne sie müsste jede Lexikonseite bei jedem
ISR-Revalidate eine pgvector-Ähnlichkeitssuche über `daily_repo` auslösen — bei
200 Begriffen und `revalidate = 900` rund 19.000 Vektor-Queries pro Tag für
Daten, die sich wöchentlich ändern. Der Cron rechnet, die Seite liest nur.

**Erweiterung bestehender Tabellen**

- `generated_posts.pending_glossary_terms jsonb` — Kandidatenliste aus der
  Analyse-Phase, bis zur Freigabe im Editor.
- `image_prompts`: ein zusätzlicher Datensatz für den Lexikon-Bildstil mit
  eigenen Dither-Parametern. Die Cover-Werte sind auf 3:2-Fotomotive
  abgestimmt; ein Schema braucht gröberes `coarseness`, sonst verschwinden
  feine Linien im Rauschen.

### B) Erkennung und Freigabe

Eine neue Phase `lexicon` in `lib/article-jobs/service.ts`, hinter den
bestehenden Phasen `planning` → `writing` → `finalizing`. Dort, weil die Queue
resumable ist und pro Tick eine Phase abarbeitet — das umgeht das
300-Sekunden-Limit, an dem ein einzelner Request mit mehreren LLM-Calls
scheitern würde.

Die Phase muss **hinter** `finalizing` liegen: erst dort entsteht über
`persistDraftPost` die `postId`, an der die Kandidatenliste hängt. Konkret gibt
`finalizing` sein `status: 'done'` ab und setzt stattdessen `phase: 'lexicon'`;
die neue Phase schließt den Job ab. Schlägt die Lexikon-Phase fehl, ist der
Artikel trotzdem fertig — der Job läuft in die bestehende
`max_attempts`-Behandlung, und der Editor zeigt einfach keine Kandidaten.

Ablauf der Phase:

1. **Tags einsammeln.** `{lex:Begriff}`-Direktiven aus dem Ghostwriter-Output
   extrahieren, analog zu `extractCompanyTags()`.
2. **Matcher.** `findGlossaryMentions(visibleText, terms)` nach dem Muster von
   `findMentionedProducts` in `lib/posts/product-mentions.ts:19-36`:
   Unicode-Wortgrenzen (`[^\p{L}\p{N}]`, nicht `\b` — sonst brechen Umlaute und
   Komposita), Mindestlänge 4 Zeichen, case-insensitive, gegen
   `canonical_name` **und** `aliases`. Sichtbaren Text via
   `extractVisibleText()` gewinnen, damit keine Treffer in URLs entstehen.
3. **Neue Kandidaten.** Ein LLM-Call identifiziert erklärungsbedürftige
   Begriffe, die noch nicht in `glossary_terms` stehen. Für jeden generiert er
   `slug`, `canonical_name`, `aliases`, `summary`, `body` und die Entscheidung,
   ob eine Illustration hilft. Eintrag mit `status = 'draft'`.
4. **Illustration** für neue Kandidaten mit positiver Entscheidung (Abschnitt E).
5. **Kandidatenliste ablegen** in `generated_posts.pending_glossary_terms`: pro
   Eintrag `slug`, `name`, `origin` (`tag` \| `match` \| `new`) und die
   Trefferstellen im Text.

**Freigabe im Editor** (`app/admin/generated-articles/edit/[id]/page.tsx`): ein
Panel listet die Kandidaten. `origin = 'tag'` ist vorausgewählt, `match` und
`new` sind Checkboxen mit Vorschau von `summary`. Beim Speichern schickt der
Client die bestätigten Slugs an `PATCH /api/admin/generated-posts`.

**Serverseitig** in derselben Route: `injectGlossaryMarks()` schreibt die Marks
in das JSON, bestätigte Drafts wechseln auf `status = 'published'`. Nicht
bestätigte Kandidaten bleiben Draft — sie tauchen beim nächsten Artikel wieder
auf, ohne erneut generiert zu werden.

Der Client injiziert nicht selbst: er hat keinen Service-Role-Zugriff, und die
Verlinkung muss auch für den Newsletter- und Übersetzungspfad gelten, die nicht
über den Editor laufen.

### C) Verlinkung — drei Ausgabepfade

Eine TipTap-Mark `glossaryLink` mit `attrs: { slug }`.

`injectGlossaryMarks(content, slugs, terms)` in `lib/glossary/inject-marks.ts`
ist **idempotent**: es entfernt vorhandene `glossaryLink`-Marks und setzt sie
neu. Damit ist mehrfaches Speichern unschädlich, und nach der Übersetzung genügt
ein erneuter Lauf.

Pflichtstellen — jede einzelne bricht still, wenn sie fehlt:

- **`components/tiptap-editor.tsx`** und
  `components/tiptap-editor-with-patterns.tsx`: Mark registrieren. Ein
  unbekannter Mark-Typ wird vom Editor beim Laden verworfen — die Links
  verschwinden beim nächsten Speichern.
- **`lib/tiptap/render-static-html.ts`**: Mark rendern. Diese Datei fällt bei
  unbekannten Typen auf einen leeren String zurück; ohne Support verschwindet
  der **komplette Artikel** aus dem Prerender-HTML — ohne Fehler, ohne Log. Das
  ist der Pfad, den Crawler sehen, also der für das SEO-Ziel entscheidende.
- **`lib/email/tiptap-to-html.ts`**: Mark zu `<a>`. Der Sanitizer erlaubt `a`
  bereits, `sanitizeHtmlForEmail` muss nicht erweitert werden.
- **`components/tiptap-renderer.tsx`**: Mark rendert als Link. Kein neuer
  DOM-Prozessor — die Marks stehen schon im JSON.
- **Die drei Brace-Strip-Stellen** (u. a. `render-static-html.ts:44`) müssen
  `{lex:...}` mit entfernen. Sonst bleibt die Direktive sichtbar, oder der
  pauschale `{...}`-Strip verschluckt sie an einer Stelle und nicht an der
  anderen.

**Reihenfolge:** `injectGlossaryMarks` läuft **nach** `hideExplicitCompanyTags`
und nach der Produkt-Verlinkung, damit die Kollisionsregel greift: ein Wort, das
schon Company- oder Produktlink ist, bekommt keinen Lexikon-Link.

### D) Lexikonseite

Route `app/[lang]/glossary/[slug]/page.tsx`, aufgebaut nach
`app/[lang]/rankings/[slug]/page.tsx`.

```
export const revalidate = 900
export async function generateStaticParams() { return [] }
```

Das leere `generateStaticParams` ist nicht optional: ohne es behandelt Vercel
Dynamic-Segment-Routen als voll dynamisch und **ignoriert `revalidate`** — jeder
Aufruf würde ein Live-DB-Hit. In Prod verifiziert, dokumentiert in
`app/[lang]/rankings/[slug]/page.tsx:32-34`.

Loader `getGlossaryTerm(slug, lang)` in `lib/glossary/detail.ts`, gewrappt in
React `cache()`, damit `generateMetadata` und die Page nicht doppelt lesen.

**HTML-Reihenfolge** (SEO/GEO-relevant, nicht nur Layout):

1. `<h1>` Begriff
2. Lead: `summary`
3. Illustration, falls vorhanden
4. Erklärungstext aus `body`, volle Breite, Lesetypografie
5. — visuelle Trennung —
6. Verwandte Begriffe · Produkte · News · Artikel mit diesem Begriff

LLMs zitieren den ersten substanziellen Textblock. Arrondierende Blöcke oben
würden genau die Passage verwässern, für die die Seite existiert.

**SEO/GEO:**

- JSON-LD `DefinedTerm` innerhalb eines `DefinedTermSet` („Synthszr Lexikon"),
  ausgegeben über `safeJsonLd` aus `lib/seo/site.ts`.
- `generateLocalizedMetadata` mit `availableLocales: ['de', 'en']`.
- Sitemap-Eintrag in `app/sitemap.ts`, nur `status = 'published'`, nur de/en.
- `summary` als Meta-Description.
- Kein `aggregateRating` — vermeidet das Projekt bewusst.

**Index-Seite** `app/[lang]/glossary/page.tsx`: alphabetische Liste aller
veröffentlichten Begriffe, `revalidate = 3600`. Selektiert nur `slug`,
`canonical_name`, `summary` — **nicht** `body`. Wide JSONB-Selects in
Listen-Queries waren die Ursache des 109-GB-Egress-Overage.

Die arrondierenden Blöcke selektieren ebenfalls schmal: keine `body`-Spalte der
verwandten Begriffe, keine `history`-JSONB der Produkte.

### E) Illustrationen

Neue Funktion in `lib/gemini/image-generator.ts`:

```ts
export async function generateGlossaryIllustration(
  termName: string,
  summary: string,
): Promise<{ success: boolean; imageBase64?: string; alt?: string; error?: string }>
```

Sie baut einen **eigenen, erklärenden Prompt** — nicht das Satire-Template aus
`getActiveImagePrompt()`, das auf Nachrichtenbilder festgelegt ist — und gibt
das Rohbild an

```ts
generateAndProcessImage(termName, { enableDithering: true, ... }, rawBase64)
```

weiter. Der dritte Parameter `preloadedRawBase64` existiert bereits und
überspringt die Generierung; die Kette Scale → Tonkurve → Floyd-Steinberg-Dither
→ `whiteToTransparent` läuft unverändert. Damit entsteht derselbe
schwarz-auf-transparent-Look wie bei Covern, ohne den produktiven Cover-Pfad
anzufassen.

Nötiger Eingriff: `generateImageOpenAI` exportieren (oder ein schmaler Wrapper
`generateRawImage(prompt, options)`), weil es heute modul-privat ist.

Speicherung via `put` aus `@vercel/blob` wie in `app/api/post-images/route.ts`,
URL und Alt-Text in `glossary_terms`.

Der Alt-Text ist hier SEO-Substanz, kein Nachgedanke: ein Dither-Bild ist für
einen Crawler vollständig opak.

Der Monats-Cron generiert **keine** Bilder neu — ein Begriff ändert sein Bild
nicht, weil sich die Nachrichtenlage ändert.

### F) News-Block

`find_similar_items` ist unbrauchbar: es verlangt eine `item_id` und liefert
ausschließlich Einträge mit **älterem** `newsletter_date`.

Neue RPC `match_glossary_news(query_embedding vector, since timestamptz, match_limit int)`:

- `security invoker`, `set search_path = pg_catalog, public`, EXECUTE nur für
  `service_role` (Muster aus dem Runbook Abschnitt 5).
- Filtert `source_type in ('article','webcrawl')`. Newsletter-Rows enthalten den
  gesamten Newsletter-Plaintext über mehrere Themen — ein Embedding-Treffer sagt
  dort nichts über den Begriff aus, und `source_url` ist unzuverlässig
  (`lib/newsletter/fetcher.ts:473-478`).
- Zeitfenster: 90 Tage.

Pro Begriff wird ein Embedding aus `canonical_name + summary` erzeugt und in
`glossary_terms.embedding` gespeichert — die Abfrage bettet also nicht bei jedem
Lauf neu ein.

**Der wöchentliche Cron** `glossary-news` ruft die RPC pro Begriff auf,
generiert für jeden Treffer einen Einordnungssatz und schreibt das Ergebnis nach
`glossary_term_news` (bestehende Zeilen des Begriffs werden ersetzt). Die Seite
liest ausschließlich diese Tabelle — kein Vektor-Zugriff im Renderpfad.

Dargestellt werden **Titel, Quelle, Datum, Link und der eigene
Einordnungssatz** — keine Fremd-Volltextzitate. Maximal 5 News pro Begriff.
Wöchentlich statt monatlich, weil monatlich aktualisierte News keine wären.

### G) Produkt-Block

Bei der Anlage eines Begriffs ordnet ein LLM-Call passende Produkte aus den
Charts zu und schreibt sie nach `glossary_term_products`. Nur Produkte mit
`visibility_status = 'visible'` und `chartable` kommen infrage — die
`products`-Tabelle enthält Kandidaten und niedrig-konfidente Einträge.

Ein Mapping über `product_categories` funktioniert nicht: die ~50 Slugs sind
Produktkategorien (`frontier-llms`, `reasoning-models`), keine Fachbegriffe. Für
„Mixture of Experts" oder „RLHF" existiert keine passende Kategorie.

Refresh im Monats-Cron. Manuell gesetzte Zuordnungen (`source = 'manual'`)
werden dabei nicht überschrieben.

### H) Mehrsprachigkeit

Übersetzt werden `canonical_name`, `aliases`, `summary` und `body` nach
`glossary_term_translations`, ausgelöst bei der Freigabe eines Begriffs.

Für die Verlinkung im übersetzten Artikel läuft `injectGlossaryMarks` **erneut**
über den übersetzten Content, mit der übersetzten Begriffsliste. Weil die
Verlinkung deterministisch aus der Liste entsteht, muss sie nicht durch die
Übersetzung getragen werden. Das umgeht das Problem, an dem `bundleType` sich
abgearbeitet hat: der Übersetzungs-LLM verwirft unbekannte TipTap-Attribute, und
`reapplyBundleTypeAttrs` muss sie positionsbasiert zurückschreiben — was bricht,
wenn Nodes verschmelzen oder sich teilen.

Neue UI-Labels („Verwandte Begriffe", „Aktuelle News", „Im Lexikon") brauchen
Einträge in `defaultTranslations` **und** `ui_translations`, sonst rendern sie
in allen Sprachen deutsch.

Nur de/en gehen in `hreflang` und Sitemap. cs/nds/fr zeigen den EN-Fallback.

### I) Monats-Cron

`app/api/cron/glossary-review/route.ts`, `CRON_SECRET`-authentifiziert wie die
übrigen Cron-Routen.

Pro Lauf ein Batch von Begriffen, geordnet nach `last_reviewed_at` aufsteigend.
Für jeden Begriff prüft ein LLM-Call mit den aktuellen News als Kontext, ob die
Erklärung noch stimmt:

- unverändert → `review_state = 'ok'`, `last_reviewed_at` aktualisiert
- veraltet → neuer Text in `pending_body`, `review_state = 'revision_pending'`

Der **Live-Text bleibt unverändert** bis zur Freigabe im Admin. Grund:
`is_manually_edited` existiert genau deshalb, weil automatische Regenerierung
manuelle Korrekturen überschreibt. Ein Admin-Bereich zeigt offene Revisionen mit
Diff und den Aktionen Übernehmen/Verwerfen.

Batch-Größe 10 Begriffe pro Lauf — bei einem LLM-Call je Begriff bleibt das
deutlich unter 300 Sekunden. Der Cron läuft täglich und arbeitet die Liste nach
`last_reviewed_at` durch; jeder Begriff kommt damit von selbst etwa monatlich
dran, ohne dass ein einzelner Lauf das gesamte Lexikon abarbeiten müsste. Die
Route gibt immer 200 zurück — ein Fehler in einem Begriff darf den Cron nicht als
fehlgeschlagen markieren (Muster aus dem `article_jobs`-Cron).

## Touchpoints

**Neu**

| Datei | Zweck |
|---|---|
| `supabase/migrations/*_glossary_schema.sql` | vier Tabellen, RLS, Grants, Indizes |
| `supabase/migrations/*_glossary_news_rpc.sql` | `match_glossary_news` |
| `lib/glossary/terms.ts` | CRUD, Begriffsliste laden |
| `lib/glossary/mentions.ts` | `findGlossaryMentions` |
| `lib/glossary/inject-marks.ts` | idempotente Mark-Injektion |
| `lib/glossary/generate.ts` | LLM: Kandidaten, Slug, Text, Produktzuordnung |
| `lib/glossary/detail.ts` | Seiten-Loader, `cache()`-gewrappt |
| `lib/tiptap/glossary-link-mark.ts` | TipTap-Mark |
| `app/[lang]/glossary/page.tsx` | Index |
| `app/[lang]/glossary/[slug]/page.tsx` | Detailseite |
| `app/api/cron/glossary-review/route.ts` | Monatsprüfung |
| `app/api/cron/glossary-news/route.ts` | wöchentlicher News-Refresh |
| `app/api/admin/glossary/route.ts` | Admin-CRUD, Revisionen |
| `app/admin/glossary/page.tsx` | Begriffsverwaltung, offene Revisionen |
| `components/glossary/*` | Seitenblöcke |

**Geändert**

| Datei | Änderung |
|---|---|
| `lib/gemini/image-generator.ts` | `generateGlossaryIllustration`, `generateImageOpenAI` exportieren |
| `lib/claude/ghostwriter-pipeline.ts` | `{lex:}`-Direktive im Prompt |
| `lib/article-jobs/service.ts` | Phase `lexicon` hinter `finalizing` |
| `app/api/admin/generated-posts/route.ts` | Mark-Injektion, Draft→published |
| `app/admin/generated-articles/edit/[id]/page.tsx` | Freigabe-Panel |
| `components/tiptap-editor.tsx`, `-with-patterns.tsx` | Mark registrieren |
| `components/tiptap-renderer.tsx` | Mark rendern |
| `lib/tiptap/render-static-html.ts` | Mark rendern, `{lex:}` strippen |
| `lib/email/tiptap-to-html.ts` | Mark zu `<a>` |
| `app/sitemap.ts` | Glossar-Einträge |
| `lib/i18n/default-translations.ts` | neue Labels |
| `vercel.json` bzw. `vercel.ts` | zwei Cron-Einträge |

## Fallstricke

Belegt, nicht vermutet:

1. `render-static-html.ts` fällt bei unbekannten Node-/Mark-Typen auf `''`
   zurück — eine nicht dort registrierte Mark lässt den ganzen Artikel aus dem
   Prerender-HTML verschwinden, still.
2. `revalidate` ohne (auch leeres) `generateStaticParams` wird von Vercel
   ignoriert.
3. `\b` in Regex bricht bei Umlauten und Komposita; `[^\p{L}\p{N}]` mit
   `u`-Flag verwenden.
4. Die Ausschlusslisten-Strategie aus `lib/rankings/product-exclusions.ts` ist
   hier nicht verfügbar: sie schließt ambivalente Wörter komplett vom Autolink
   aus, und genau die sind hier der Inhalt. Deshalb Freigabe pro Erwähnung statt
   Sperrliste pro Begriff.
5. Die LLM-Validity-QA prüft nur Einträge mit ≤ 40 Mentions
   (`lib/rankings/product-validity-qa.ts:20`) — häufige Begriffe rutschen
   ungeprüft durch. Für das Lexikon ersetzt die redaktionelle Freigabe diese
   Prüfung.
6. `content_translations` und `translation_queue` haben CHECK-Constraints auf
   `generated_post | static_page | ui`.
7. Der Übersetzungs-Cron verarbeitet max. 3 Übersetzungen pro 15-Minuten-Tick
   (~288/Tag), geteilt mit den täglichen Posts. Glossar-Übersetzungen dürfen die
   Artikel nicht verdrängen — eigene Queue oder niedrigere Priorität.
8. Bei Chunked-Translation wird ein fehlgeschlagener Chunk unübersetzt
   übernommen, Status trotzdem `completed`.
9. Wide JSONB-Selects in Listen-Queries verursachten 109 GB Egress-Overage.
10. PostgREST cappt bei 1000 Zeilen — Sitemap und Index brauchen Pagination,
    sobald das Lexikon wächst.

## Verifikation

Gegen Produktion (`synthszr.com`), nicht gegen einen lokalen Dev-Server.

**Datenmodell**
- anon-Leseprobe auf die vier neuen Tabellen: `permission denied` oder 0 Zeilen.
- Supabase Security Advisor nach der Migration: keine neuen WARN-Einträge.
- `match_glossary_news` hat `search_path` gesetzt und ist für `anon` nicht
  ausführbar.

**Verlinkung**
- Testartikel mit `{lex:}`-Tag speichern → Marks im gespeicherten JSON.
- `curl -s https://www.synthszr.com/de/posts/<slug> | grep glossary` findet den
  Link im **ausgelieferten HTML** — das ist der Kernbeweis für das SEO-Ziel.
- Newsletter-Testversand an ein kontrolliertes Konto: Link vorhanden, kein
  unersetztes `{{...}}`, keine sichtbare `{lex:}`-Direktive.
- Artikel ohne Glossarbegriffe rendert unverändert — Regressionsschutz für
  `render-static-html.ts`.

**Seite**
- `/de/glossary/<slug>` und `/en/glossary/<slug>` liefern 200.
- `x-vercel-cache` zeigt `HIT`/`STALE` nach dem zweiten Aufruf — beweist, dass
  ISR greift.
- JSON-LD validiert als `DefinedTerm`.
- `hreflang` nennt nur de und en.
- Erklärungstext steht im HTML **vor** den arrondierenden Blöcken.

**Illustration**
- Generiertes Bild ist schwarz-auf-transparent gedithert.
- Alt-Text vorhanden und beschreibend.

**Cron**
- Ohne `Authorization` → 401; mit korrektem Bearer → 200.
- Ein veralteter Begriff erhält `revision_pending`, der Live-Text bleibt
  unverändert.

## Nicht-Ziele

- Keine Volltextsuche im Lexikon — `/search` existiert.
- Kein A–Z-Register unter 30 Begriffen.
- Keine Hover-Tooltips: im Newsletter technisch unmöglich, im Web ein zweiter
  Renderpfad ohne Nutzen für SEO.
- Keine Begriffs-Hierarchie (Ober-/Unterbegriffe).
- Keine öffentliche API.
- Keine automatische Rückwirkung auf Altartikel.
- Keine Illustrations-Regenerierung im Monats-Cron.
