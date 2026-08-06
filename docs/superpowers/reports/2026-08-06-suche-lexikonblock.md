# Report: Lexikon-Block in der Suche

**Datum:** 2026-08-06
**Branch:** main (HEAD war 7494c30)
**Auftrag:** siehe Team-Lead-Nachricht — Suche (`app/api/search/route.ts`, `components/home-search.tsx`, `components/search-overlay.tsx`) um einen Ergebnisblock für veröffentlichte Lexikonbegriffe ergänzen. Suchfelder: `canonical_name`, `aliases`, `summary` — nicht `body`. Reihenfolge: nach Blogposts, vor Firmen.

## Was geändert wurde

### 1. Neue Suchfunktion: `searchPublishedTerms` in `lib/glossary/terms.ts`

Lädt alle veröffentlichten Begriffe mit schmalen Spalten (`id, slug, canonical_name, aliases, summary` — **kein** `body`), filtert danach in Node auf Substring-Treffer in `canonical_name`, `aliases` (Array-Element) oder `summary`. In Node filtern, weil `aliases` eine `text[]`-Spalte ist — PostgREST-`ilike()` greift nicht auf einzelne Array-Elemente. Für `lang != 'de'` wird ein eigenständiges Übersetzungs-Overlay (`applySearchTranslations`) aus `glossary_term_translations` nachgezogen, das alle drei Felder zugleich überschreibt (die bestehenden Funktionen `applyTranslations`/`getMatcherTerms` decken je nur zwei davon ab und sind nicht exportiert — ein Verbreitern ihrer Typen für einen dritten, dort ungenutzten Wert schien mir invasiver als eine neue, acht Zeilen kurze Funktion).

Präfix-Treffer im Namen zuerst sortiert (gleiche Regel wie bei Companies/Produkten in der Route), dann alphabetisch, gekappt auf `limit`. Rückgabe: `{ slug, canonicalName, excerpt }`, `excerpt` = zeichenbasiert gekürzte `summary` (160 Zeichen + Ellipse), analog zu `buildSnippet` in der Route — kein Zitat mit Fundstelle, nur eine Vorschau.

`SEARCH_FETCH_LIMIT = 1000`: PostgREST kappt eine Abfrage ohne `range()`/`limit()` sonst still bei 1000 Zeilen (bekannter Fallstrick dieses Projekts). Bei aktuell gut 300 veröffentlichten Begriffen unkritisch; ein Kommentar im Code weist darauf hin, dass Pagination nötig wird, sobald die Begriffszahl 1000 übersteigt.

### 2. Route: `app/api/search/route.ts`

`searchPublishedTerms(rawQuery, locale, maxGlossary)` läuft als eigenes Promise parallel zu den Post-Lookups (eigene Tabelle, eigener `createAdminClient()` — `glossary_terms` hat kein anon-SELECT, RLS aus Migration `20260803120000_glossary_schema.sql` revoked alles außer `service_role`). Fehler werden abgefangen und degradieren auf `[]`, wie beim Produkte-Block. `maxGlossary`: 6 im Kompakt-Modus, 24 im Voll-Modus (`full=1`) — spiegelt `MAX_COMPANIES`/`MAX_PRODUCTS`. Response um `glossary` erweitert, auch im Leer-Fall (`rawQuery.length < 2`).

### 3. Dritte Render-Fläche gefunden und mitgezogen: `app/[lang]/search/page.tsx`

Diese Datei stand nicht in der Team-Lead-Dateiliste, ist aber die tatsächliche `/de/search`-Seite aus dem Bug-Report ("BLOGPOSTS (1)") — eine von `home-search.tsx` komplett unabhängige JSX-Struktur mit eigenen, durchnummerierten Abschnittskommentaren ("1. Blog Posts / 2. Synthszr Charts / 3. Synthszr Stock"). Ohne Änderung hier wäre der Bug auf der Vollseite weiterhin sichtbar. Neuer Abschnitt "2. Lexikon" zwischen Posts und Charts eingefügt, Folgeabschnitte umnummeriert (jetzt 1–4).

### 4. `components/home-search.tsx`

- `GlossaryHit`-Interface, `SearchResults.glossary`, `glossaryHeading`-Strings für de/en/cs/nds (exakt nach dem Muster von `companiesHeading` etc.), `BookOpen`-Icon.
- Neuer Abschnitt zwischen Charts und Posts (Aufbau wie die Produkt-Liste: Name + Excerpt, `HighlightedText`, Link auf `/${locale}/glossary/${slug}`).
- **Reihenfolge:** bleibt bei der bestehenden Priorisierung — Companies → Products/Charts → **Lexikon (neu)** → Posts. Ursprünglich hatte ich (in einer ersten, vom Team-Lead korrigierten Fassung) die ganze Reihenfolge auf Posts→Lexikon→Charts→Companies umgestellt, um sie an die Vollseite anzugleichen; das war falsch — „Companies always on top" ist eine bewusste Produktentscheidung, die durch die Ergänzung nicht kippen soll (siehe „Bedenken" unten). Companies steht wieder an erster Stelle, das Lexikon wird nur unmittelbar vor die Posts eingefügt.
- **Section-Config-Array:** `SECTION_ORDER: SectionId[] = ['companies', 'products', 'glossary', 'posts']` ist jetzt die einzige Stelle, die die Reihenfolge bestimmt. `renderSection(id)` kennt nur den Inhalt eines Blocks (Header, Liste, Klick-Handler), nicht seine Position. Eine spätere Umsortierung ist ein Ein-Zeilen-Edit an `SECTION_ORDER`.
- Trennlinien-Refactor: äußerer Wrapper trägt jetzt `divide-y divide-border`; jeder Block-Header hat nur noch sein eigenes `border-b` (Trennung Header/Liste), kein positionsabhängiges `border-t` mehr. `divide-y` zieht die Trennlinie zwischen sichtbaren Geschwister-Blöcken automatisch (nie vor dem ersten) — dieselbe Trennlinie wie vorher, nur nicht mehr hart an die Position gebunden. Gleiches Muster wie die `<ul className="divide-y divide-border">`-Listen, die im File schon existierten.

`components/search-overlay.tsx`: keine Änderung nötig — rendert nur `<HomeSearch locale={locale} />`, bekommt den neuen Block automatisch mit.

### 5. `SearchStrings`

`glossaryHeading` für alle vier bestehenden Sprachen ergänzt: de „Lexikon (n)", en „Glossary (n)", cs „Slovník (n)", nds „Lexikon (n)" (nds hat kein eigenes Wort für „Glossar" belegt, „Lexikon" ist im Bestand schon die nds-Übersetzung für „Blog-Bidrägen"-Nachbarbegriffe — gleiche Wahl wie bei `companiesHeading`, das auch hochdeutsch bleibt).

## Geprüfte Signaturen (vor Verwendung im echten Code nachgesehen)

- `createAdminClient()` aus `@/lib/supabase/admin` — Rückgabetyp, `.from().select().eq().limit()`/`.in()`-Chain: gegen `lib/glossary/terms.ts` (bestehende Funktionen) und `tests/lib/glossary-terms.test.ts` (Mock-Chain) abgeglichen.
- RLS auf `glossary_terms`: `supabase/migrations/20260803120000_glossary_schema.sql` gelesen — `revoke all … from anon` bestätigt, dass die Route den Admin-Client braucht, nicht den anon-Client wie bei `posts`/`generated_posts`.
- `glossary_term_translations`-Spalten (`term_id, language, canonical_name, aliases, summary, body`): gegen drei bestehende Verwender abgeglichen (`applyTermTranslation` in `detail.ts`, `getMatcherTerms`/`applyTranslations` in `terms.ts`).
- `app/[lang]/search/page.tsx`: vollständig gelesen, bevor der neue Abschnitt eingefügt wurde — eigenes `SearchData`-Interface, eigene JSX, keine Kopplung zu `home-search.tsx`.
- `app/[lang]/glossary/[slug]/page.tsx` existiert (`find app -path "*glossary*" -name "page.tsx"`) — Ziel-Route `/${locale}/glossary/${slug}` ist real, keine Annahme.

## TDD-Nachweis

**RED** — 9 neue Tests in `tests/lib/glossary-terms.test.ts` gegen den HEAD-Stand von `lib/glossary/terms.ts` (Funktion existierte noch nicht):
```
$ npx vitest run tests/lib/glossary-terms.test.ts
FAIL  searchPublishedTerms > selektiert kein body-JSONB … TypeError: searchPublishedTerms is not a function
FAIL  searchPublishedTerms > filtert auf status=published … (8 weitere, gleicher Fehler)
Test Files  1 failed (1)
     Tests  9 failed | 21 passed (30)
```

**GREEN** — nach Implementierung von `searchPublishedTerms`/`applySearchTranslations`:
```
$ npx vitest run tests/lib/glossary-terms.test.ts
Test Files  1 passed (1)
     Tests  30 passed (30)
```

Für die Route- und UI-Integration (dünne Verdrahtung, keine eigene Fachlogik) wurde kein zusätzlicher RED/GREEN-Zyklus gefahren — die Route hatte vorher schon keine Tests, und die neue Logik liegt vollständig in der getesteten Lib-Funktion.

## Verifikationsschritte mit Ausgaben

```
$ npx tsc --noEmit
(keine Ausgabe — sauber)

$ npx vitest run
Test Files  127 passed (127)
     Tests  1054 passed (1054)
```
1054 = 1044 Baseline + 1 vorbestehender Fehlschlag (`scheduled-tasks.test.ts`, laut Auftrag ein echter HTTP-Request, der regelmäßig >300s braucht) + 9 neue Tests. Der Fehlschlag ist in diesem Lauf NICHT aufgetreten (`npx vitest run tests/api/scheduled-tasks.test.ts` separat: 3/3 grün) — vermutlich netzwerk-/timing-abhängig, wie im Auftrag beschrieben. Keine Regression durch meine Änderung.

```
$ npm run build
✓ Compiled successfully
… /api/search, /[lang]/search, /api/admin/search/backfill-embeddings gelistet …
```
`.next` lag in Dropbox, vor jedem Build weggeschoben (`mv .next "$TMPDIR/next-old-$$"`). Im Build-Log erscheinen mehrfach `[Glossary] applyTranslations: TypeError: fetch failed` — das ist bestehender Code (`lib/glossary/terms.ts`, `applyTranslations`, nicht meine neue Funktion), der beim statischen Build ohne DB-Zugriff in dieser Sandbox degradiert. Build terminiert trotzdem mit Erfolg; kein Zusammenhang mit meiner Änderung.

`npm run lint` lässt sich in diesem Repo aktuell nicht ausführen (`ESLint couldn't find an eslint.config.js` — Projekt hat keine ESLint-9-Konfiguration im Root). Vorbestehender Zustand, nicht Teil dieses Auftrags; `next build` führt sein eigenes Lint nicht sichtbar fehlschlagend aus (Build war grün).

### Zweiter Durchlauf nach der Reihenfolge-Korrektur (Team-Lead-Antwort)

Vor der Korrektur mit `git show HEAD~1:components/home-search.tsx` die Companies-/Products-/Posts-Blöcke des Standes VOR meiner allerersten Änderung gesichert und nach dem Umbau auf `renderSection`/`SECTION_ORDER` textlich abgeglichen — Überschriften-Strings, Zählwerte, Struktur identisch, nur aus `{results.X.length > 0 && (…)}` in `if (…) return null; return (…)` innerhalb eines `switch` verschoben.

```
$ npx tsc --noEmit
(keine Ausgabe — sauber)

$ npx vitest run
Test Files  127 passed (127)
     Tests  1054 passed (1054)

$ npm run build
✓ Compiled successfully
… /api/search, /[lang]/search weiterhin gelistet …
```

`grep` gegen `app/[lang]/search/page.tsx` bestätigt die unveränderte Reihenfolge dort: `1. Blog Posts / 2. Lexikon / 3. Synthszr Charts / 4. Synthszr Stock`.

## Self-Review

- `select('*')` nirgends verwendet; Spalten in `searchPublishedTerms` sind exakt `id, slug, canonical_name, aliases, summary` (kein `body`).
- `status = 'published'`-Filter sitzt in der DB-Query selbst (`.eq('status', 'published')`), nicht erst im Node-Filter — ein `draft`/`hidden`-Begriff verlässt die Datenbank gar nicht.
- Kein `select`-String mit Ternär (Fallstrick dieses Projekts) — `SEARCH_COLUMNS` ist ein festes Literal.
- Response-Shape an allen drei Call-Sites synchron gehalten: `app/api/search/route.ts` (Quelle), `components/home-search.tsx` und `app/[lang]/search/page.tsx` (beide Konsumenten) haben je ihr eigenes, dupliziertes `GlossaryHit`/`SearchData`-Interface — gleiches Muster wie die bestehenden `PostHit`/`CompanyHit`/`ProductHit`, die auch dreifach dupliziert sind statt aus einem gemeinsamen Typ importiert. Nicht von mir eingeführt, nur fortgesetzt.
- `truncateSummary` schneidet zeichenbasiert, nicht wortgrenzen-bewusst — kann mitten im Wort enden. Bewusst so, weil `buildSnippet` in der Route (Vorbild) das genauso macht; eine Wortgrenzen-Suche wäre eine Verbesserung, die niemand verlangt hat.
- Habe die alten, jetzt doppelten Products-/Posts-Blöcke in `home-search.tsx` nach dem Umbau vollständig entfernt (nicht nur verschoben) — per `git diff` gegenprüft, dass keine zwei `results.products.map`-Blöcke mehr existieren.

## Bedenken

1. **~~Reihenfolge-Entscheidung eigenständig getroffen~~ — korrigiert nach Team-Lead-Antwort.** Team-Lead hat beide Rückfragen beantwortet: Meine Lesart „Reihenfolge in beiden Flächen vereinheitlichen" war falsch. Verbindliche Vorgabe: `app/[lang]/search/page.tsx` (Posts → Charts → Companies) wird zu **Posts → Lexikon → Charts → Companies** — das hatte ich bereits richtig umgesetzt, keine Änderung nötig. `components/home-search.tsx` (Companies → Charts → Posts) wird dagegen zu **Companies → Charts → Lexikon → Posts** — die „Companies always on top"-Priorisierung ist eine dokumentierte Produktentscheidung des Betreibers und bleibt unangetastet, das Lexikon wird nur direkt vor die Posts eingefügt. Ich habe die vorherige Umsortierung im Dropdown zurückgenommen: Companies steht wieder an erster Stelle, Lexikon sitzt jetzt zwischen Charts und Posts.
2. **Section-Config-Array umgesetzt** (vom Team-Lead bestätigt): `components/home-search.tsx` hat jetzt ein `SECTION_ORDER: SectionId[]`-Array als einzige Stelle, die die Block-Reihenfolge im Dropdown bestimmt, plus eine `renderSection(id)`-Funktion, die pro Block nur den Inhalt kennt (nicht die Position). Eine spätere Umsortierung ist ein Ein-Zeilen-Edit an `SECTION_ORDER`. Für `app/[lang]/search/page.tsx` habe ich das NICHT eingeführt — die vier Blöcke dort sind bereits unabhängige `<div className="mb-8">`-Boxen ohne geteilte Trennlinien-Logik (anders als das Dropdown, das eine gemeinsame Border-Berechnung hatte); eine Umsortierung ist dort schon heute ein reines Verschieben eines JSX-Blocks. Ein Array einzuführen hätte dort keinen Mehrwert gehabt, nur zusätzliche Indirektion.
3. **Bestehende Blöcke unverändert geprüft:** Habe die Companies-/Products-/Posts-Blöcke gegen den Stand vor meiner ersten Änderung (`git show HEAD~1:components/home-search.tsx`) diff-geprüft — Überschriften-Strings, Zählwerte, Übersetzungen und Struktur sind identisch geblieben, nur aus der Inline-JSX-Bedingung (`{results.X.length > 0 && (…)}`) in einen `switch`-Case (`if (…) return null; return (…)`) verschoben. Eine sichtbare Detailänderung bleibt: die Header hatten vorher `border-b border-border` (erster Block) bzw. `border-b border-t border-border` (nachfolgende Blöcke); jetzt tragen alle Header einheitlich nur `border-b border-border`, und der äußere Wrapper zieht die Trennlinie zwischen sichtbaren Blöcken automatisch über `divide-y divide-border` (nie vor dem ersten). Das Rendering-Ergebnis ist damit optisch identisch — CSS-`divide-y` erzeugt exakt dieselbe Trennlinie, nur nicht mehr positionsabhängig hart kodiert — aber es ist eine Implementierungsänderung an bestehenden Blöcken, die ich hier explizit benenne, falls das strenger als „nur ergänzen" gilt.
4. **`app/[lang]/search/page.tsx` war nicht in der ursprünglichen Dateiliste.** Vom Team-Lead ausdrücklich bestätigt: richtig, dass ich sie angefasst habe.
5. Für `app/[lang]/search/page.tsx` gibt es keinen i18n-Key `search.glossary` (die vorhandene `tr('search.posts', 'Blogposts')`-Infrastruktur läuft für diesen Key ins Leere — der Key existiert in keiner Übersetzungsdatei, `tr()` liefert also für JEDE Sprache den deutschen Fallback „Blogposts"). Ich habe die neue Überschrift deshalb wie den Rest der Datei per `locale === 'de' ? … : …`-Ternär gebaut (gleiches Muster wie h1/Placeholder in dieser Datei), nicht über `tr()`. Kein neuer Fallstrick, nur Konsistenz mit einem bestehenden, das i18n-System nicht wirklich benutzenden Teil dieser Seite.
6. Keine Embedding-/LLM-Rerank-Stufe für den Lexikon-Block (anders als bei Posts) — bewusst weggelassen, weil weder Auftrag noch Companies/Produkte-Blöcke das tun; reine Substring-Suche genügt für den geforderten Umfang.
7. **Beobachtung, nicht behoben (Team-Lead-Anweisung):** Die beiden Flächen sortieren jetzt bewusst unterschiedlich — Vollseite Posts vorne, Dropdown Companies vorne. Das ist ein bestehender Zustand von vor meiner Änderung (die beiden Flächen hatten schon vorher unterschiedliche Prioritäten), keine Regression. Team-Lead hat entschieden, das nicht zu vereinheitlichen; falls das gewünscht wird, ist es eine spätere, eigene Entscheidung des Betreibers.
8. **Zustellungslücke, dann Bestätigung, dann fehlender Kommentar-Wortlaut.** Eine erste Stopp-Nachricht des Team-Leads kam nicht an (Zustellungsfehler, nicht meiner) — dadurch hatte ich die Vereinheitlichung bereits umgesetzt, bevor die Korrektur zu mir durchdrang. Die zweite, vollständige Nachricht kam an und wurde in Commit `536e1c7` umgesetzt. Eine dritte Nachricht bestätigte dieselbe Entscheidung noch einmal (der Betreiber hatte inzwischen entschieden) und wies zusätzlich darauf hin, den Original-Kommentar bei den Companies **wörtlich** wiederherzustellen, falls umformuliert. Das war bei mir der Fall: ich hatte in Commit `536e1c7` nur eine neue, deutsche Erklärung beim `SECTION_ORDER`-Array ergänzt, den englischen Original-Kommentar „Synthszr-Analyse always on top — these are the unique value-add: AI investment ratings the user can't get from Google. Posts come below as supporting context." aber nicht an seiner alten Stelle (direkt beim Companies-Block) wörtlich stehen gelassen. In diesem Commit wörtlich wiederhergestellt (Wortlaut per `git show <commit-vor-meiner-ersten-Änderung>` gegengeprüft), zusätzlich zur — bleibenden — deutschen Erklärung beim Array selbst.
9. `divide-y`-Optik kurz gegengeprüft, wie vom Team-Lead verlangt: `divide-y` sitzt auf dem äußeren Wrapper-`<div>`, dessen direkte Kinder die `<section>`-Elemente sind (nicht die `<header>`). Border-top landet also auf dem `<section>`, nicht mehr direkt auf dem `<header>` wie im Original — da `<section>` aber ohne eigene Klassen/Padding um `<header>` liegt, ist die Linie pixelgleich an derselben Stelle. Keine optische Abweichung.

## Nachtrag 2026-08-06: Reihenfolge angleichen + Suchbegriff hervorheben

Zwei weitere Aufträge vom Betreiber, nachdem die Commits bereits live waren.

### 1. Reihenfolge in `app/[lang]/search/page.tsx` an das Dropdown angeglichen

Der Betreiber hat entschieden: keine zwei unterschiedlichen Sortierungen mehr (Beobachtung Punkt 7 oben hat das ausgelöst). Neue, für beide Flächen identische Reihenfolge: **Companies → Charts → Lexikon → Posts**.

`app/[lang]/search/page.tsx` bekam dasselbe Muster wie `home-search.tsx`: `SECTION_ORDER: SectionId[]` als einzige Stelle für die Reihenfolge, `renderSection(id)` kennt nur den Inhalt. Die per-Block-Kommentare `{/* 1. Blog Posts */}` etc. sind raus — die hätten bei vier Blöcken sonst vier Stellen, die mit `SECTION_ORDER` synchron gehalten werden müssten, exakt das Problem, das die Konstante lösen soll. Stattdessen ein Doc-Kommentar an `SECTION_ORDER` selbst, der explizit auf die Dropdown-Konstante verweist.

Diff-geprüft: Überschriften-Strings (`tr('search.posts', 'Blogposts')`, `'Lexikon' : 'Glossary'`, `Synthszr Charts`, `Synthszr Stock`), Zählwerte und die leere-Ergebnis-Meldung sind unverändert (`grep` gegen den Stand vor dieser Änderung, siehe Verifikation unten) — nur aus vier separaten `{data.X.length > 0 && (…)}`-Blöcken in einen `switch`-Case innerhalb von `renderSection` verschoben. Jeder Block bleibt seine eigene `<section className="mb-8">`-Box mit eigenem `border`/`rounded-lg` — anders als im Dropdown gibt es hier keine geteilte Trennlinien-Logik, also auch keinen `divide-y`-Umbau nötig.

### 2. Suchbegriff gelb hervorheben

**Geprüft, was es schon gibt, wie gefordert:** `components/post-search-highlight.tsx` passt NICHT. Es ist ein DOM-Mutation-basierter Highlighter (MutationObserver + TreeWalker), der über `document.getElementById(targetId)` an die Artikel-BODY-Root auf der Post-Detailseite bindet (nach Navigation von der Suche mit `?q=`) — ein völlig anderer Einsatzort (Fließtext eines bereits geöffneten Artikels) als das, was hier gebraucht wird (Titel/Auszug-Zeilen INNERHALB der Ergebnisliste, React-JSX-basiert, kein imperativer DOM-Zugriff). Es hätte hier auch technisch nicht gepasst: es erwartet eine Container-ID zum Durchlaufen, keine einzelnen Textfelder.

Was tatsächlich passt und schon existierte: `HighlightedText`, eine private (nicht exportierte) Komponente in `home-search.tsx`, bereits für Posts/Produkte/Lexikon im Dropdown im Einsatz (nur bei Companies fehlte sie — nachgezogen). Extrahiert nach **`components/highlighted-text.tsx`** (neu, kein `'use client'`, keine Hooks — pure Funktion, deshalb sowohl in der Client-Komponente `home-search.tsx` als auch in der Server-Komponente `app/[lang]/search/page.tsx` nutzbar). Escaping (`trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`) und Case-Insensitivität (`'gi'`-Flag) sind unverändert aus dem Original übernommen — beides war schon vorher korrekt implementiert, nichts Neues zu bauen.

**Wichtiger Fund zur Farbe:** Bevor ich `#CCFF00` einfach per Analogie zur bestehenden `bg-neon-cyan/60`-Klasse eingebaut hätte, habe ich die kompilierte CSS-Ausgabe geprüft (`grep -c "neon-cyan" .next/static/chunks/*.css`) — `.bg-neon-cyan` existiert dort NUR ohne Opazitäts-Suffix (`.bg-neon-cyan{background-color:#0ff}`), es gibt KEINE generierte Regel für `.bg-neon-cyan\/60` oder `\/70`. Der Grund: `neon-cyan` ist keine in `@theme` registrierte Farbe, sondern eine handgeschriebene CSS-Klasse in `globals.css` — Tailwind kann für so eine Klasse keinen Opazitäts-Modifier generieren, weil es den Farbwert dafür gar nicht kennt. Das bedeutet: **die bestehenden Marks in `HighlightedText` und `PostSearchHighlight` rendern schon seit ihrer Einführung nicht cyan, sondern mit dem nativen Browser-Default für `<mark>` (Gelb)** — der Klassenname im Markup hat schlicht keine Wirkung. Das ist ein vorbestehender, von mir nicht verursachter Bug, den ich hier NICHT rückwirkend für `post-search-highlight.tsx` behebe (außerhalb des Auftrags — nur als Beobachtung notiert), aber für die neue Implementierung natürlich nicht wiederhole.

Für `#CCFF00` selbst gilt dasselbe Prinzip nicht: die Bracket-Syntax `bg-[#CCFF00]/60` (Tailwinds Arbitrary-Value-Notation) IST bereits im Projekt etabliert und funktionierend (`components/stock-synthszr-layer.tsx`, `app/[lang]/rankings/[slug]/page.tsx` u. a. nutzen exakt dieses Muster mit `/10`, `/20`, `/30`, `/40`). Nach dem Build geprüft: `.bg-\[\#CCFF00\]\/60{background-color:#cf09;background-color:lab(93.9363% -35.8091 88.7913/.6)}` erscheint korrekt im kompilierten CSS. `HighlightedText` nutzt jetzt `bg-[#CCFF00]/60 text-foreground rounded-sm px-0.5` — dieselbe visuelle Gewichtung (60 % Deckkraft, geerbte Textfarbe) wie das ursprünglich GEMEINTE, aber nie wirksame Cyan, nur mit der jetzt tatsächlich greifenden Farbe.

**Wo die Hervorhebung jetzt greift:** Titel und Auszug in allen vier Blöcken, auf beiden Flächen — Posts (Titel + Snippet/Excerpt), Lexikon (Name + Excerpt), Charts (Produktname), Companies (Firmenname) — vorher fehlte sie bei Companies im Dropdown und komplett auf `app/[lang]/search/page.tsx`.

### Verifikation (Nachtrag)

```
$ npx tsc --noEmit
(keine Ausgabe — sauber)

$ npx vitest run
Test Files  127 passed (127)
     Tests  1054 passed (1054)

$ npm run build
✓ Compiled successfully

$ grep -il "ccff00" .next/static/chunks/*.css
.next/static/chunks/2oyth177lti1j.css
$ grep -o "[^}]*ccff00[^}]*}" .next/static/chunks/2oyth177lti1j.css -i
.bg-\[\#CCFF00\]\/60{background-color:#cf09;background-color:lab(93.9363% -35.8091 88.7913/.6)}
… (weitere /10, /20, /30, /40, /90-Varianten, alle bereits vorhanden)
```

`grep` gegen die Überschriften-Strings in `page.tsx` bestätigt: `tr('search.posts', 'Blogposts')`, `'Lexikon' : 'Glossary'`, `Synthszr Charts`, `Synthszr Stock` — alle unverändert an ihren jeweiligen Textstellen, nur die Reihenfolge der vier `<section>`-Blöcke hat sich verschoben.

### Bedenken (Nachtrag)

10. `post-search-highlight.tsx` (Post-Body-Highlight nach Klick aus der Suche) hat denselben Opazitäts-Bug (`bg-neon-cyan/70` ohne Wirkung, nativer Browser-Gelb-Fallback) — nicht behoben, da außerhalb des Auftrags ("in den Ergebnissen", nicht im Artikeltext). Beobachtung für den Betreiber, analog zur unterschiedlichen Block-Reihenfolge vorher.
11. `HighlightedText` wandert von `home-search.tsx` (Client-Komponente) nach `components/highlighted-text.tsx` (kein `'use client'`) — geprüft, dass das für BEIDE Konsumenten funktioniert: die Komponente selbst hat keine Hooks/Browser-APIs, ist also in einer Server-Komponente (`page.tsx`) genauso zulässig wie im Client (`home-search.tsx`, das sie jetzt importiert statt lokal zu definieren).
12. Sortier-Kommentare (`{/* 1. Blog Posts */}` etc.) aus `page.tsx` entfernt, weil sie mit vier verstreuten Nummerierungen genau das Synchronisierungsproblem reproduziert hätten, das `SECTION_ORDER` lösen soll. Falls die Nummern-Kommentare aus anderen Gründen gewünscht waren (z. B. Lesbarkeit beim Diff), bitte Bescheid sagen — leicht nachrüstbar als Kommentar direkt in `SECTION_ORDER`.

## Nicht committet

Wie gefordert: alle Änderungen liegen als lokaler Commit auf `main`, **nicht gepusht**.
