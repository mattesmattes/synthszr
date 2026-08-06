# Report: Lexikon-Dubletten bereinigen und verhindern

**Datum:** 2026-08-06
**Branch:** main
**Auftrag:** siehe Team-Lead-Nachricht - Bestand bereinigen (Dry-Run-Skript) und kuenftige Dubletten in `lib/glossary/crawl.ts` verhindern.

## Was geaendert wurde

### 1. `lib/glossary/generate.ts` - `normalizeSlugForDedup`

Neue, pure, exportierte Funktion neben `slugify`:

```ts
export function normalizeSlugForDedup(slug: string): string {
  return slug.replace(/-/g, '').replace(/s$/, '')
}
```

Genau die im Auftrag vorgegebene Regel: ohne Bindestriche, ohne einen einzelnen End-"s". Bewusst NICHT mehr als das - siehe Kollisionscheck unten.

### 2. `lib/glossary/crawl.ts` - Teil 2 (Praevention)

Zwei Stellen in `generateCandidates`, wie im Auftrag benannt:

- **`partitionByExisting`**: vergleicht jetzt ueber `normalizeSlugForDedup(slug)` statt ueber den exakten Slug. Ein exakter Treffer ist ein Sonderfall eines normalisierten Treffers (ein String normalisiert immer gleich zu sich selbst) - die bestehenden 5 Tests (exakte Kollision, Warteschlangen-interne Dublette per Gross/Kleinschreibung, leere Warteschlange) bleiben dadurch unveraendert gruen. Faengt jetzt zusaetzlich Schreibvarianten ab, sowohl gegen den Bestand als auch INNERHALB einer Warteschlange (die zweite Haelfte des Auftrags - "das auch Dubletten innerhalb eines Laufs abfaengt").
- **`existingSlugs`-Ladepfad**: vorher `.in('slug', rawQueue.map(slugify))` - eine enge Abfrage, die nur exakte Treffer der AKTUELLEN Kandidatennamen sehen konnte. "Eval" (Kandidat) haette gegen diese Abfrage niemals "evals" (Bestand) gesehen, weil die Strings nicht gleich sind. Jetzt: der GANZE Slug-Bestand (alle Status, nicht nur published - ein Insert scheitert am Unique-Constraint unabhaengig vom Status der bestehenden Zeile), paginiert mit `range()` (PostgREST kappt sonst still bei 1000 Zeilen, aktuell ~500 Begriffe, das Lexikon waechst weiter). Nur die Spalte `slug`, kein `body`/`summary` (Egress).

Der dritte Punkt aus dem Auftrag - "ein uebersprungener Kandidat muss abgehakt werden" - brauchte KEINE Aenderung: der bestehende Code in `generateCandidates` (`for (const name of alreadyExisting) { generatedSlugs.push(slugify(name)); delete candidates[name] }`) verarbeitet `alreadyExisting` bereits unabhaengig davon, OB der Treffer exakt oder normalisiert war - `partitionByExisting` liefert in beiden Faellen dasselbe Feld. Durch Test `tests/lib/glossary-crawl-dedupe.test.ts` direkt nachgewiesen (s. TDD-Nachweis).

### 3. `scripts/dedupe-glossary-terms.ts` - Teil 1 (Bestand)

Neues Skript, Muster/Aufrufkonvention wie `scripts/requantize-glossary-illustrations.ts` (Env-Pfad als erstes Argument, `dotenv`, `createClient` mit Service-Role-Key, Dry-Run als Voreinstellung, `--apply` fuer den Schreiblauf). **Nicht angewendet** - nur der Dry-Run wurde ausgefuehrt (Ergebnis unten), der Schreiblauf ist eure Entscheidung.

Ablauf:
1. Laedt alle veroeffentlichten Slugs (schmal, paginiert), gruppiert nach `normalizeSlugForDedup`.
2. Fuer jede Gruppe mit mehr als einem Mitglied: laedt die vollen Zeilen (nur fuer die betroffenen Slugs, kein `select('*')` ueber den Bestand) und entscheidet den Gewinner nach Inhaltslaenge (`summary.length + extractPlainText(body).length`, bei Gleichstand der aeltere `created_at`). Druckt die Begruendung je Paar.
3. Prueft je zu versteckendem Slug per `ilike` auf `generated_posts.content` (Muster `"attrs":{"slug":"<slug>"}"`, das einzige Muster, das eine `glossaryLink`-Mark schreibt - Stock-Links nutzen `href`, nicht `slug`, s. `lib/glossary/inject-stock-links.ts:115`), wie viele veroeffentlichte Artikel auf den Slug verlinken. Nur `id, slug` werden uebertragen, nicht `content` (Egress) - der `ilike`-Filter laeuft in Postgres.
4. Nur mit `--apply`: setzt den Verlierer auf `status='hidden'`, mergt dessen `canonical_name` UND eigene Aliasse in die `aliases`-Spalte (`text[]`, geprueft in `lib/glossary/detail.ts:77` und `terms.ts:107`) des Gewinners (case-insensitive dedupliziert, eigener `canonical_name` des Gewinners ausgeschlossen). Danach werden die betroffenen Artikel per `linkPostContent` (`lib/glossary/backfill.ts`, bereits exportierte reine Funktion) neu verlinkt - **keine eigene Mark-Schreib-Logik**, s. naechster Abschnitt.

## Wie die Verlinkung korrigiert wird (der gefaehrlichste Teil)

Geprueft, ob `applyGlossaryConfirmation` oder `backfillGlossaryLinks` das schon leisten: beide sind Orchestrierung fuer einen anderen Anlass (Freigabe eines Artikels bzw. paginierter Cursor-Lauf ueber den ganzen Bestand) und nicht direkt fuer "korrigiere genau diese N Artikel" nutzbar, ohne den Crawl-Relink-Cursor (`state.relinkCursor` in `settings`) anzufassen, der von einem parallel laufenden Cron benutzt wird. Die eigentliche Arbeit - Marks strippen und anhand der AKTUELLEN Begriffsliste neu setzen - steckt aber in einer bereits exportierten reinen Funktion, `linkPostContent(content, terms, reserved)` aus `lib/glossary/backfill.ts`. Das Skript ruft genau diese Funktion fuer jeden betroffenen Artikel auf, mit `getMatcherTerms('de')` (gelesen NACH dem Verstecken/Alias-Merge, damit der Verlierer nicht mehr in der Liste steht und seine Aliasse am Gewinner haengen) und `buildReservedNames(getChartProductNames())`. Effekt: `injectGlossaryMarks` entfernt die alte Mark auf den versteckten Slug und findet dieselbe Textstelle erneut, jetzt als Alias des Gewinners - der Link zeigt danach auf den ueberlebenden Slug, ohne dass irgendwo neuer Code existiert, der Marks schreibt.

**Nicht abgedeckt:** `content_translations` (uebersetzte Artikel) haben eine EIGENE Mark-Re-Injektion (`reinjectGlossaryMarksForTranslation` in `lib/glossary/translate.ts`, laeuft nur waehrend der Uebersetzungs-Pipeline selbst) - das Skript fasst diese Tabelle nicht an. Siehe Bedenken.

## Geprueft am echten Bestand (Dry-Run gegen Prod, `vercel env pull --environment=production`)

```
Modus: nur lesen (Dry-Run)
502 veroeffentlichte Begriffe geladen
4 Dubletten-Gruppe(n) gefunden

Paar: evals (GEWINNER, 3972 Zeichen, erstellt 2026-08-04) <-> eval (3699 Zeichen, erstellt 2026-08-05)
Paar: leveraged-etfs (GEWINNER, 4367 Zeichen, erstellt 2026-08-05 09:47) <-> leveraged-etf (4000 Zeichen, erstellt 2026-08-05 10:05)
Paar: pre-training (GEWINNER, 4179 Zeichen, erstellt 2026-08-05 09:48) <-> pretraining (3933 Zeichen, erstellt 2026-08-05 11:49)
Paar: time-series-foundation-model (GEWINNER, 4722 Zeichen, erstellt 2026-08-05 09:58) <-> time-series-foundation-models (4377 Zeichen, erstellt 2026-08-05 10:24)

Verlinkungs-Check:
  eval: 30 Artikel
  leveraged-etf: 0 Artikel
  pretraining: 12 Artikel
  time-series-foundation-models: 0 Artikel

42 Artikel-Verlinkungen insgesamt betroffen.
```

In allen vier Faellen deckt sich "mehr Inhalt" mit "aelter" (kein Zielkonflikt in den Kriterien). Bei `leveraged-etf`/`leveraged-etfs` tragen BEIDE Zeilen denselben `canonical_name`-Text ("Leveraged ETF") - der Slug-Unterschied kommt daher, dass `generateAndInsertDraft`/`draft-writer.ts` den vom Crawl-Kandidaten vorgegebenen Slug fuer die Zeile uebernimmt, nicht den vom LLM zurueckgegebenen `canonical_name` neu slugifiziert (der Kandidat hiess einmal "Leveraged ETF", einmal "Leveraged ETFs" - das LLM hat den Text beide Male auf Singular normalisiert, der Slug blieb aber am Kandidatennamen haengen). Das ist ein separater, bestehender Verhaltenspunkt in `draft-writer.ts`, nicht Gegenstand dieses Auftrags - nur als Erklaerung, warum der Name in der Ausgabe zweimal identisch aussieht.

## Kollisionscheck der Normalisierungsregel (explizit gefordert)

Gruppiert man alle 471 zum Befundzeitpunkt veroeffentlichten Slugs (Snapshot in `tests/fixtures/glossary-slugs-2026-08-06.json`) nach `normalizeSlugForDedup`, entstehen genau 4 Gruppen mit mehr als einem Mitglied - die vier oben genannten Paare. Die uebrigen 463 Slugs bleiben nach der Normalisierung paarweise eindeutig. **Keine falsche Kollision gefunden.** Das ist nicht nur behauptet, sondern als Regressionstest eingebaut (`tests/lib/glossary-generate.test.ts`, "wirft inhaltlich verschiedene Begriffe nicht zusammen") - wird die Regel jemals zu aggressiv, faellt genau dieser Test um, bevor es in Prod auffaellt.

Die Regel bleibt bewusst eng (nur Bindestrich + ein End-"s") - ist NICHT zu aggressiv, wie der Check zeigt, deshalb keine engere Variante noetig.

## Bedenken (wichtig, bitte lesen)

**Der "Eval"-Cluster ist keine Zweier-, sondern eine Vierer-Dublette.** Neben `eval`/`evals` existieren ZWEI weitere veroeffentlichte Begriffe zum selben Konzept: `evaluation` ("Evaluation") und `evaluation-eval` ("Evaluation (Eval)"). Alle vier haben nahezu identische summaries und ueberlappende Aliaslisten (`evaluation`s Aliasse enthalten bereits "Eval" und "Evals"; `evaluation-eval`s Aliasse enthalten "Eval", "Evals", "Evaluation" ...). `normalizeSlugForDedup` sieht das NICHT, weil es unterschiedliche Woerter/Wortlaengen sind, keine Bindestrich-/Pluralvariante desselben Worts - das faellt explizit unter die im Auftrag ausgeschlossene Kategorie "echte Synonyme, braeuchten Embeddings, nicht anfangen". Ich habe die Regel deshalb NICHT erweitert. Aber: dieses Skript wuerde den Eval-Themenkomplex nur von vier auf drei veroeffentlichte Eintraege reduzieren (`evaluation` und `evaluation-eval` blieben als weitere, inhaltlich ueberlappende Eintraege stehen). Das ist ein Fund, keine Entscheidung von mir - bitte separat pruefen, ob dieser Cluster einen eigenen (manuellen oder embeddings-basierten) Merge-Durchgang braucht.

**`content_translations` bleibt unangeruehrt.** Uebersetzte Artikel (Englisch) haben ihre eigene Mark-Injektion und werden von diesem Skript nicht korrigiert. Fuer die vier hier gefundenen Paare ist das Risiko gering (die betroffenen Artikel sind - soweit geprueft - deutsche News-Artikel; ob und wie viele davon eine EN-Uebersetzung mit eigenen `glossaryLink`-Marks haben, habe ich nicht separat gezaehlt), aber es ist eine bewusste Luecke, kein Versehen.

**`identifyCandidates`s `knownSlugs`-Filter bleibt exakt, nicht normalisiert.** Der Auftrag nennt explizit nur `existingSlugs` und `partitionByExisting` in `generateCandidates` (die TEURE Generierungs-Stufe) als zu aendernde Stellen - die (billige) Extraktions-Stufe kann einen bereits gemergten Begriff also weiterhin als "neuen" Namen vorschlagen (z.B. wieder "Eval", wenn ein Artikel ihn erwaehnt und `eval` inzwischen hidden ist). Das kostet einen Extraktions-Call (Sekunden), keinen Generierungs-Call (45-90s) - `generateCandidates` faengt den Kandidaten beim naechsten Schritt trotzdem ab (jetzt normalisiert gegen den GANZEN Bestand, auch hidden-Zeilen). Bewusst nicht erweitert, um nicht ueber den Auftrag hinauszugehen.

## Geprueft: Selbst nicht angewendet

`scripts/dedupe-glossary-terms.ts` wurde ausschliesslich im Dry-Run-Modus gegen Prod ausgefuehrt (Ergebnis oben). Kein `--apply`-Lauf, keine Schreiboperation gegen `glossary_terms` oder `generated_posts`.

## Geprueft Signaturen

- `aliases`-Spalte ist `text[]` (JS: `string[]`) - bestaetigt in `lib/glossary/detail.ts:77` (`(row.aliases ?? []) as string[]`) und `lib/glossary/terms.ts:107`.
- `linkPostContent(content: unknown, terms: GlossaryMatcherTerm[], reserved: string[]): { content: unknown; changed: boolean }` - `lib/glossary/backfill.ts:43`, pur, wirft nie (fangt intern und meldet nur ueber `changed`/console.error).
- `getMatcherTerms(lang): Promise<GlossaryMatcherTerm[] | null>` - `null` bei DB-Fehler, NICHT `[]` (Unterschied ist bewusst, s. Kommentar in `terms.ts`) - im Skript entsprechend behandelt (Abbruch der Link-Korrektur mit Fehlermeldung, Status/Alias-Aenderungen bleiben bestehen).
- `buildReservedNames(chartProductNames: string[]): string[]` - pur, keine eigene DB-Anfrage - `getChartProductNames()` separat aufgerufen.
- `isValidTipTapDoc`/`extractPlainText` aus `lib/glossary/generate.ts` fuer die Inhaltslaenge (statt roher `JSON.stringify(body).length`, das Struktur-Overhead mitzaehlen wuerde).
- `injectGlossaryMarks` schreibt Marks nur mit `attrs: { slug }` - Stock-Links nutzen `attrs: { href, target }` (`lib/glossary/inject-stock-links.ts:115`) - der `ilike`-Suchstring `"attrs":{"slug":"<slug>"}` ist damit eindeutig fuer glossaryLink-Marks.
- `partitionByExisting(queue, existingSlugs: Set<string>)` - Signatur UNVERAENDERT, nur die interne Vergleichslogik.

## TDD-Nachweis

Implementierung und Tests sind hier nicht in strikter RED-first-Reihenfolge entstanden. Um trotzdem einen echten Nachweis statt einer Behauptung zu haben, per `git stash` NACHTRAEGLICH gegen die alte `crawl.ts` (exakter Vergleich) geprueft, ob die neuen Tests dort tatsaechlich rot sind:

**RED** (`git stash push -- lib/glossary/crawl.ts`, dann die neuen Tests gegen die alte Version laufen lassen):

```
$ npx vitest run tests/lib/glossary-crawl-existing.test.ts tests/lib/glossary-crawl-dedupe.test.ts
 × sortiert einen Kandidaten aus, dessen Slug nur NORMALISIERT mit einem bestehenden uebereinstimmt
 × erkennt die Bindestrich-Variante gegen einen bestehenden Slug ohne Bindestrich
 × faengt eine normalisierte Dublette auch INNERHALB derselben Warteschlange ab
 (plus die drei entsprechenden Faelle in glossary-crawl-dedupe.test.ts)
 Test Files  2 failed (2)
      Tests  6 failed | 6 passed (12)
```

**GREEN** (`git stash pop`, Aenderung wieder da):

```
$ npx vitest run tests/lib/glossary-crawl-existing.test.ts tests/lib/glossary-generate.test.ts tests/lib/glossary-crawl-dedupe.test.ts
 Test Files  3 passed (3)
      Tests  38 passed (38)
```

`tests/lib/glossary-crawl-dedupe.test.ts` ist neu und testet `generateCandidates` end-to-end (gemockter Supabase-Client fuer `settings` + `glossary_terms`, gemocktes `generateAndInsertDraft`): ein normalisiert kollidierender Kandidat wird NICHT erzeugt UND landet in `state.generated` (der "Abhaken"-Teil des Auftrags, direkt am echten Funktionsverhalten nachgewiesen, nicht nur an `partitionByExisting` isoliert).

## Verifikation

- `npx tsc --noEmit`: sauber, keine Ausgabe.
- Volle Suite: `1067 passed (1067)`, `128 Test-Dateien`, keine Fehlschlaege (der bekannte netzwerkabhaengige Flake in `scheduled-tasks.test.ts` ist in diesem Lauf nicht aufgetreten). Zwischenzeitlich gab es 2 Fehlschlaege in `tests/api/glossary-inject-on-save.test.ts` - die stammten NICHT von dieser Aenderung, sondern von einem zeitgleich laufenden, unabhaengigen Umbau an `app/api/admin/generated-posts/route.ts` (Commit `053a48e`, anderes Team-Mitglied) und waren nach dessen Commit wieder gruen. Zur Sicherheit gegengeprueft: `git diff -- lib/glossary/crawl.ts lib/glossary/generate.ts scripts/dedupe-glossary-terms.ts` enthaelt keine Referenz auf `createOrGetJob`/`jobs/service`/die betroffene Route.
- `npm run build`: Exit 0 (ein Zwischenversuch scheiterte mit `ENOENT` auf `.next/static/.../_ssgManifest.js` durch einen `mv`-Race mit Dropbox-Sync beim direkten Zweitlauf - beim naechsten, saubereren Lauf Exit 0. Kein Code-Fehler.)

## Self-Review

- Habe ich irgendwo `select('*')` oder eine ungefilterte `body`-Spalte geladen? Nein - `contentLength` bekommt `body` nur fuer die (max. 8) betroffenen Zeilen, nie fuer den ganzen Bestand.
- Ternaere im Select-String? Nein, an keiner Stelle.
- `.range()` bei allen ungefilterten Listenabfragen (Crawl-Bestand, Skript-Bestandsliste)? Ja.
- Hat die Aenderung an `partitionByExisting` bestehende Tests kaputt gemacht? Nein - alle 5 vorherigen Tests weiterhin gruen (verifiziert vor UND nach der Aenderung).
- Wurde irgendwo produktiv geschrieben? Nein - nur Dry-Run gegen Prod (reine SELECTs), keine UPDATEs.
- Encoding-Falle: ein Edit mit Em-Dash + typografischen Anfuehrungszeichen hat beim ersten Versuch in `generate.ts` `\uXXXX`-Escape-Text statt echter UTF-8-Zeichen ins File geschrieben (per `sed`/`xxd` verifiziert, nicht nur vom Read-Tool angezeigt). Sofort korrigiert; alle neuen Kommentare in diesem Auftrag verwenden seitdem geradzeilige Anfuehrungszeichen und "-" statt "-" (Em-Dash), Umlaute selbst sind unauffaellig geblieben. Bitte beim naechsten Mal in `crawl.ts`/`generate.ts` kurz `grep -n '\\u[0-9a-f]\{4\}'` gegenpruefen, falls dort mit Em-Dash/typografischen Anfuehrungszeichen editiert wird.

## Dateien

- `lib/glossary/generate.ts` - `normalizeSlugForDedup` (neu, exportiert)
- `lib/glossary/crawl.ts` - `partitionByExisting` (normalisierter Vergleich), `generateCandidates` (breiterer `existingSlugs`-Ladepfad)
- `scripts/dedupe-glossary-terms.ts` - neu, Dry-Run-Skript
- `tests/lib/glossary-generate.test.ts` - `normalizeSlugForDedup`-Tests inkl. Real-Daten-Regression
- `tests/lib/glossary-crawl-existing.test.ts` - normalisierte Kollisionsfaelle fuer `partitionByExisting`
- `tests/lib/glossary-crawl-dedupe.test.ts` - neu, End-to-End-Nachweis fuer `generateCandidates`
- `tests/fixtures/glossary-slugs-2026-08-06.json` - neu, Snapshot der 471 Slugs fuer den Regressionstest

---

# Nachtrag 2026-08-06: Kriterium umgedreht + Panel-Zaehlung korrigiert

Zwei Nachbesserungen nach eurem Review des ersten Dry-Runs.

## 1. Gewinner-Kriterium: Verlinkungen vor Inhalt vor Alter

### Was geaendert wurde

Neue Datei `lib/glossary/dedupe.ts` mit der reinen Entscheidungslogik, ausgelagert aus dem Skript. Grund fuer die Auslagerung: das Skript ruft `main()` beim Import unbedingt auf (echter DB-Verbindungsversuch, `process.exit` bei Fehlern) - eine direkt im Skript definierte Funktion ist deshalb nicht sinnvoll importierbar/testbar. `lib/glossary/dedupe.ts` hat keinen eigenen Supabase-Client und keine Nebeneffekte.

`decidePair(rows, linkCounts: Map<string, number>)` sortiert jetzt nach:
1. **Mehr eingehende Verlinkungen** (fehlende Eintraege in `linkCounts` gelten als 0).
2. Bei Gleichstand: mehr Inhalt (unveraendert: `summary.length + extractPlainText(body).length`).
3. Bei erneutem Gleichstand: der AELTERE (`created_at`).

Liefert zusaetzlich `decidingCriterion: 'Verlinkungen' | 'Inhaltslaenge' | 'Alter'` - der Vergleich zwischen Platz 1 und Platz 2 (der knappste, aussagekraeftigste), gedruckt in der Skript-Ausgabe je Paar.

`scripts/dedupe-glossary-terms.ts` prueft jetzt die Verlinkungen fuer JEDE Zeile jeder Gruppe VOR der Entscheidung (vorher nur fuer den nach Inhalt vermuteten Verlierer - das war zu wenig, weil das neue Kriterium die Zahlen beider Seiten braucht, um ueberhaupt zu entscheiden). Die tatsaechlichen Mark-Aenderungen (nur die Links der ENDGUELTIGEN Verlierer) werden separat und explizit gezaehlt und ausgegeben.

### Ergebnis am echten Bestand (Dry-Run gegen Prod, `vercel env pull --environment=production`, erneut frisch gepullt)

```
Paar: eval, evals - entschieden durch: Verlinkungen
  GEWINNER eval ("Eval"): 30 Verlinkung(en), 3699 Zeichen Inhalt
  versteckt  evals ("Evals"): 8 Verlinkung(en), 3972 Zeichen Inhalt

Paar: leveraged-etfs, leveraged-etf - entschieden durch: Inhaltslaenge
  GEWINNER leveraged-etfs: 0 Verlinkung(en), 4367 Zeichen
  versteckt  leveraged-etf: 0 Verlinkung(en), 4000 Zeichen

Paar: pretraining, pre-training - entschieden durch: Verlinkungen
  GEWINNER pretraining ("Pretraining"): 12 Verlinkung(en), 3933 Zeichen
  versteckt  pre-training ("Pre-Training"): 3 Verlinkung(en), 4179 Zeichen

Paar: time-series-foundation-model, time-series-foundation-models - entschieden durch: Inhaltslaenge
  GEWINNER time-series-foundation-model: 0 Verlinkung(en), 4722 Zeichen
  versteckt  time-series-foundation-models: 0 Verlinkung(en), 4377 Zeichen

11 Mark-Aenderung(en) waeren durch diese Entscheidung noetig.
```

Gewinner sind jetzt `eval`, `leveraged-etfs`, `pretraining`, `time-series-foundation-model` - **eval und pretraining bleiben, exakt wie erwartet.**

**Aber: 11 Mark-Aenderungen, nicht 0.** Das ist eine echte Abweichung von der genannten Erwartung, kein Bug in der neuen Logik - und der Grund ist eine Luecke im ERSTEN Dry-Run: der hatte Verlinkungen nur fuer die damaligen (inhaltsbasierten) Verlierer geprueft (`eval`: 30, `leveraged-etf`: 0, `pretraining`: 12, `time-series-foundation-models`: 0) und NIE fuer deren Gegenstuecke (`evals`, `leveraged-etfs`, `pre-training`, `time-series-foundation-model`). Jetzt, mit beiden Seiten geprueft, zeigt sich: **`evals` hat selbst 8 eingehende Verlinkungen, `pre-training` hat 3.** Die Erwartung "0 Mark-Aenderungen" waere nur eingetroffen, wenn die (jetzt gewinnenden) staerker verlinkten Slugs schon vorher Gewinner gewesen waeren UND ihre Gegenstuecke komplett unverlinkt waeren - beides trifft auf `evals` (8 Links) und `pre-training` (3 Links) nicht zu. Die 11 Aenderungen sind also real und noetig, sobald `eval`/`pretraining` gewinnen sollen: 8 Artikel, die auf `evals` verlinken, und 3, die auf `pre-training` verlinken, muessten auf den jeweils anderen Slug umgebogen werden. Bitte das vor einem `--apply`-Lauf zur Kenntnis nehmen - ich habe die Zahl nicht "auf 0 gebogen", sondern wie gefordert **explizit ausgegeben und hier gemeldet.**

### TDD-Nachweis

**RED:**
```
$ npx vitest run tests/lib/glossary-dedupe.test.ts
Error: Cannot find package '@/lib/glossary/dedupe'
Test Files  1 failed (1)
```

**GREEN** (nach Implementierung von `lib/glossary/dedupe.ts`):
```
$ npx vitest run tests/lib/glossary-dedupe.test.ts
Test Files  1 passed (1)
     Tests  6 passed (6)
```

6 Tests: staerker verlinkt gewinnt trotz weniger Inhalt (der Kern-Fall); Gleichstand bei Verlinkungen faellt auf Inhaltslaenge zurueck; Gleichstand bei beidem faellt auf Alter zurueck; die beiden unveraenderten Paare (Leveraged ETF, Time Series Foundation Model) bleiben beim Inhalts-Kriterium; eine fehlende Verlinkungszahl gilt als 0; `reasoning` nennt Verlinkung/Inhalt/Datum je Zeile.

## 2. Panel-Zaehlung: `total` bei Job-Anlage korrigiert (nicht die Anzeige)

### Ursache gefunden

`estimateTotal` (`lib/glossary/jobs/service.ts`, Zweig `kind==='pending'`) zaehlte bestaetigte Kandidaten mit `needsGeneration===true` - aber dieser Flag wird beim Vormerken EINMAL gesetzt (`lib/glossary/candidates.ts`) und NIE aktualisiert, wenn derselbe Begriff seither ueber einen ANDEREN Artikel entstanden ist. `estimateTotal` vertraute diesem veralteten Flag blind, ohne (wie der tatsaechliche Worker `ensureConfirmedTermsExist`/`generateMissingTerms` es laengst tat) frisch gegen `glossary_terms` zu pruefen, ob der Begriff nicht doch schon existiert. Daher "37" (alle jemals mit needsGeneration vorgemerkten, seit ueberholten Kandidaten) statt "1" (tatsaechlich offen).

`total` war also die falsche Zahl - genau wie ihr vermutet habt. Die Korrektur sitzt entsprechend dort, nicht in der Anzeige (`JobLog`/`glossary-approval-panel.tsx` bleiben unveraendert - sie zeigen nur `job.total`/`job.done_count` an, die jetzt korrekt ankommen).

### Was geaendert wurde

- **`lib/glossary/ensure-terms.ts`**: neue exportierte Funktion `findMissingFromGlossary(supabase, candidates)` - die frische Existenzpruefung, die vorher inline in `generateMissingTerms` steckte, jetzt herausgezogen und geteilt. `generateMissingTerms` ruft sie jetzt auf statt die Pruefung zu duplizieren (verhaltensgleich - siehe Verifikation).
- **`lib/glossary/jobs/service.ts`**: `estimateTotal`s `pending`-Zweig ruft jetzt `findMissingFromGlossary` mit den bestaetigten+needsGeneration-Kandidaten auf und zaehlt nur die, die WIRKLICH noch fehlen - dieselbe Definition von "offen" wie der Worker selbst verwendet (und wie `openCandidateCount` es fuer `kind='generate'` schon vormacht, s. Auftrag) - keine dritte Zaehlweise.

Bewusst NICHT angefasst: `components/admin/glossary-approval-panel.tsx`s `openCount` (der PRE-Start-Knopftext "Alle N jetzt erzeugen") bleibt eine grobe Schaetzung aus rein clientseitigen Props, mit demselben theoretischen Staleness-Risiko - eine Korrektur dort waere ein zusaetzlicher API-Roundtrip und explizit "Anzeige", nicht "Anlage". Sobald ein Job existiert, zeigt `JobLog` sofort die jetzt korrekte serverseitige Zahl. Flagge das hier als moegliche Folgearbeit, falls euch das PRE-Start-Verhalten auch stoert.

### Gepruefte Signaturen

- `ensureConfirmedTermsExist(supabase, postId, confirmedSlugs, limit)` - Signatur unveraendert.
- `generateMissingTerms` (intern, nicht exportiert) - Ablauf unveraendert, nur der Existenz-Check-Block durch den Aufruf der neuen Funktion ersetzt.
- `estimateTotal(supabase, kind, params): Promise<number | null>` - Signatur unveraendert, nur der `pending`-Zweig.
- `GlossaryCandidate` (`lib/glossary/types.ts`) - `slug`, `needsGeneration?: boolean` - unveraendert genutzt.

### TDD-Nachweis

**RED** (`findMissingFromGlossary` existiert noch nicht):
```
$ npx vitest run tests/lib/glossary-ensure-terms.test.ts
 × behält nur Kandidaten, die es in glossary_terms noch NICHT gibt
 × liefert eine leere Liste ohne DB-Zugriff, wenn keine Kandidaten übergeben werden
 × liefert null bei einem Lesefehler, nicht eine leere Liste
TypeError: findMissingFromGlossary is not a function
Tests  3 failed | 8 passed (11)
```

**RED** (`estimateTotal` vertraut noch dem Flag - Reproduktion der Panel-Beobachtung mit 3 Kandidaten, wovon 2 laengst existieren):
```
$ npx vitest run tests/lib/glossary-jobs-service.test.ts
 × prueft needsGeneration-Kandidaten FRISCH gegen glossary_terms, statt dem Flag blind zu vertrauen
   AssertionError: expected 3 to be 1
```

**GREEN** (nach beiden Aenderungen):
```
$ npx vitest run tests/lib/glossary-ensure-terms.test.ts tests/lib/glossary-jobs-service.test.ts
Test Files  2 passed (2)
     Tests  32 passed (32)
```

## Verifikation (Nachtrag)

- `npx tsc --noEmit`: sauber.
- Volle Suite: `1077 passed (1077)`, `129 Test-Dateien` (1067 vorheriger Stand + 10 neue Tests: 6 in `glossary-dedupe.test.ts`, 3 in `glossary-ensure-terms.test.ts`, 1 in `glossary-jobs-service.test.ts`). Keine Fehlschlaege, keine Regressionen in bestehenden Tests.
- `npm run build`: Exit 0 (`.next` vorher aus dem Dropbox-Pfad geschoben).
- Dry-Run erneut gegen Prod ausgefuehrt (frischer `vercel env pull`) - Ergebnis oben. **Weiterhin nicht angewendet.**

## Self-Review (Nachtrag)

- Wurde die alte Inhalts-Logik dupliziert statt wiederverwendet? Nein - `contentLength`/`mergeAliases` sind jetzt in `lib/glossary/dedupe.ts`, das Skript importiert sie, keine zweite Kopie.
- Pruefe ich Verlinkungen jetzt fuer ALLE vier Slugs pro Paar, nicht nur fuer die vermuteten Verlierer? Ja - sonst haette `decidePair` gar keine Datenbasis fuer Kriterium 1 gehabt.
- Habe ich die "0 Mark-Aenderungen"-Erwartung stillschweigend erfuellt, indem ich z.B. nur die Loser-Verlinkungen der GLEICHEN Slugs wie vorher gezaehlt haette? Nein, ausdruecklich gegengeprueft und die Abweichung (11 statt 0) klar benannt statt sie zu verstecken.
- Zweite Zaehlweise fuer 'pending'-Jobs eingefuehrt statt die bestehende zu nutzen? Nein - `findMissingFromGlossary` ist dieselbe Pruefung, die `generateMissingTerms` schon immer machte, nur herausgezogen; `estimateTotal` ruft jetzt dieselbe Funktion statt einer eigenen Kopie.
- Panel-Anzeige (`glossary-approval-panel.tsx`, `JobLog`) angefasst? Nein, wie ausdruecklich gefordert ("Korrektur gehoert dorthin [total], nicht in die Anzeige").

## Dateien (Nachtrag)

- `lib/glossary/dedupe.ts` - neu: `decidePair`, `mergeAliases`, `contentLength`, `DedupeRow`/`DedupeDecision`/`DedupeCriterion`
- `scripts/dedupe-glossary-terms.ts` - Verlinkungs-Check fuer alle Kandidaten vor der Entscheidung, `decidePair`/`mergeAliases` importiert statt lokal definiert, explizite Mark-Aenderungs-Zahl
- `tests/lib/glossary-dedupe.test.ts` - neu
- `lib/glossary/ensure-terms.ts` - neu: `findMissingFromGlossary` (exportiert), `generateMissingTerms` nutzt sie
- `lib/glossary/jobs/service.ts` - `estimateTotal`s `pending`-Zweig nutzt `findMissingFromGlossary`
- `tests/lib/glossary-ensure-terms.test.ts` - 3 neue Tests fuer `findMissingFromGlossary`
- `tests/lib/glossary-jobs-service.test.ts` - 1 neuer Test fuer den frischen Existenz-Check in `estimateTotal`

---

## Schreiblauf ausgefuehrt (2026-08-06, 10:03 Uhr)

Freigabe des Betreibers eingeholt, `--apply` gegen Prod ausgefuehrt (frischer
`vercel env pull --environment=production`, Env-Datei danach geloescht).

**Vorher geprueft, was der Dry-Run nicht zeigt.** Das Skript verlaesst sich
darauf, dass `linkPostContent` die Mark des Verlierers auf den Gewinner
umbiegt, weil dessen Name als Alias am Gewinner haengt. `injectGlossaryMarks`
schliesst aber **mehrdeutige Aliasse** aus (`inject-marks.ts`, Prod-Befund
2026-08-05): beansprucht mehr als ein Begriff denselben Alias, wird er gar
nicht verlinkt - nur der kanonische Name ist von der Regel ausgenommen. Beim
Eval-Paar trifft das auf **jeden** Alias zu, weil `evaluation` und
`evaluation-eval` denselben Begriffsraum belegen:

```
Alias "Evals":       auch Alias bei evaluation-eval, evaluation  -> mehrdeutig
Alias "Evaluation":  auch Alias bei evaluation-eval              -> mehrdeutig
Alias "Evaluierung": auch Alias bei evaluation-eval, evaluation  -> mehrdeutig
(...alle 9 Aliasse des zusammengefuehrten "eval" sind mehrdeutig)
Kanonisch "Eval": bleibt verlinkbar (Regel nimmt canonical_name aus)
```

Ob die 8 `evals`-Marks dadurch ersatzlos verschwinden oder ueber den
kanonischen Namen doch auf `eval` landen, laesst sich nicht aus den Aliassen
ableiten - es haengt am Artikeltext. Deshalb **Trockenprobe der
Mark-Neuberechnung**: simulierte Begriffsliste (Verlierer raus, Aliasse
gemergt), `linkPostContent` gegen die echten 11 Artikel, nichts geschrieben.
Ergebnis: **11 von 11 umgebogen, 0 ersatzlos verloren** - die Artikel nennen
"Eval" auch im Singular. Die Sorge war unbegruendet, aber erst danach belegt.

**Nebeneffekt, der dabei sichtbar wurde:** `linkPostContent` verlinkt die
betroffenen Artikel **komplett** neu gegen die heutigen 498 Begriffe, nicht nur
die Verlierer-Marks. Pro Artikel kamen 1-12 Links dazu (`repository`, `defi`,
`ssh`, `velocity`, ...), zwei bestehende fielen weg
(`rekursive-selbstverbesserung`, `memory-ki-agenten` - beide zugunsten
konkurrierender Begriffe auf derselben Textstelle). Das ist dieselbe Drift, die
der `relink`-Cron ohnehin erzeugt, kein Effekt des Merges - aber der Lauf ist
damit weniger chirurgisch als "11 Marks umbiegen" klingt.

**Backup vor dem Schreiben:** die 8 `glossary_terms`-Zeilen (status/aliases)
und der `content` aller 11 Artikel liegen als JSON im Scratchpad der Session
(`dedupe-backup-2026-08-06.json`, 347 KB). Der `hidden`-Status ist trivial
ruecknehmbar, ueberschriebene Artikeltexte sind es ohne Sicherung nicht.

### Ergebnis

```
versteckt: evals                          -> Alias "Evals" an eval
versteckt: leveraged-etf                  -> (Name identisch, kein neuer Alias noetig)
versteckt: pre-training                   -> Alias "Pre-Training" an pretraining
versteckt: time-series-foundation-models  -> Alias "..." an time-series-foundation-model
11 von 11 Artikeln neu verlinkt.
```

Zwei Paare wurden durch das **neue** Kriterium (Verlinkungen vor Inhalt)
umgedreht: `eval` schlaegt `evals` (30 zu 8 Links), `pretraining` schlaegt
`pre-training` (12 zu 3). Nach dem alten Kriterium waeren 42 Marks umgebogen
worden, jetzt waren es 11.

### Verifikation nach dem Lauf

- Erneuter Dry-Run: `498 veroeffentlichte Begriffe geladen / Keine Dubletten gefunden.`
- DB: alle vier Gewinner `published`, alle vier Verlierer `hidden`, Aliasse gemergt.
- Verbliebene Marks auf versteckte Slugs: **0** bei allen vier.
- Marks auf die Gewinner: `eval` 33 Artikel (vorher 30), `pretraining` 12 (unveraendert -
  die drei `pre-training`-Artikel verlinkten bereits zusaetzlich auf `pretraining`).
- Prod (HTTP, mit Redirect-Folge): Gewinner-Seiten **200**, Verlierer-Seiten **404**.
- Stichprobe im Artikel `hugging-face-hack-...`: nur noch `glossary/eval`, kein `glossary/evals`.

Ein Pruefskript meldete faelschlich "Alias fehlt" fuer `leveraged-etfs`: beide
Zeilen tragen denselben `canonical_name` ("Leveraged ETF"), und `mergeAliases`
schliesst den eigenen kanonischen Namen des Gewinners bewusst aus. Korrektes
Verhalten, zu naiver Check.

### Weiterhin offen

- **Der Eval-Cluster ist jetzt dreifach statt vierfach**, nicht einfach:
  `eval`, `evaluation`, `evaluation-eval` bleiben nebeneinander bestehen. Der
  Alias-Befund oben zeigt die Kosten davon konkret: **alle neun Aliasse von
  `eval` sind mehrdeutig und werden nie verlinkt** - nur der kanonische Name
  "Eval" traegt. Ein Dreier-Merge wuerde diese Aliasse eindeutig machen und die
  Verlinkungsqualitaet spuerbar heben. Braucht eine inhaltliche Entscheidung
  (welcher der drei Texte bleibt), keine Automatik.
- `content_translations` unveraendert - EN-Uebersetzungen koennen weiterhin
  Marks auf die vier versteckten Slugs tragen.

---

## Dreier-Merge des Eval-Clusters (2026-08-06, 10:20 Uhr)

Betreiber-Entscheidung nach dem Alias-Befund oben: `evaluation` und
`evaluation-eval` auf `eval` zusammenführen. Kuratierte Gruppe -
`normalizeSlugForDedup` sieht sie nicht (andere Wörter, keine
Schreibvarianten) und soll sie auch nicht sehen; die Regel bleibt eng.

Ausgangslage:

| Begriff | Inhalt | Verlinkungen |
|---|---|---|
| **eval** | 3699 Z. | **33** |
| evaluation | 4080 Z. | 4 |
| evaluation-eval | 4318 Z. | 0 |

`eval` hat den kürzesten Text und gewinnt trotzdem - nach demselben Kriterium
wie beim Paar-Merge (Verlinkungen vor Inhalt). Die Texte wurden nicht
angefasst; wer den inhaltsreicheren Body von `evaluation-eval` übernehmen
will, muss das separat entscheiden.

Durchgeführt mit denselben Bausteinen (`mergeAliases`, `linkPostContent`),
Trockenprobe vorab: **4 von 4 Marks auf `eval` umgebogen, 0 verloren**.
Backup der drei Begriffszeilen und vier Artikel im Session-Scratchpad.

**Wirkung, um die es eigentlich ging:** von den 14 zusammengeführten Aliassen
sind jetzt **12 eindeutig** - vorher waren es 0 von 9. Nur `Benchmark-Test`
und `Benchmarking` bleiben mehrdeutig, weil `benchmark` sie ebenfalls
beansprucht; das ist inhaltlich richtig und soll so bleiben.

Verifiziert: `eval` 200, `evaluation` und `evaluation-eval` 404,
Stichprobe `claude-opus-5-ist-da-und-ist-fable-haft` zeigt nur noch
`glossary/eval`.

## content_translations: Befund statt Korrektur

Auftrag war, übersetzte Artikel von Marks auf die inzwischen versteckten Slugs
zu befreien. **Solche Marks gibt es nicht** - und zwar aus einem größeren
Grund: von 743 Übersetzungszeilen (en/cs/nds/fr) enthält **keine einzige**
überhaupt eine `glossaryLink`-Mark.

Erste Messung lief ins Leere, weil `content_translations.content` `jsonb` ist,
nicht `text` wie bei `generated_posts`: PostgREST-`ilike` scheitert dort mit
`operator does not exist: jsonb ~~*`, und ein `content::text`-Cast im Filter
wird nicht angewandt. Gemessen wurde deshalb per SQL über
`npx supabase db query --linked`. Wer hier künftig sucht: das Muster muss auch
die jsonb-Serialisierung mit Leerzeichen (`"slug": "..."`) berücksichtigen -
beide Varianten wurden geprüft, beide 0.

Ursache ist kein Pipeline-Fehler. `reinjectGlossaryMarksForTranslation` nimmt
die Slugs aus dem **Quelltext**; alle 20 seit dem Lexikon-Start (03.08.)
erzeugten Übersetzungen liefen, bevor ihr jeweiliger deutscher Artikel
verlinkt war - die zwölf älteren vor dem großen `relink`-Lauf am 05.08. 19:11,
die acht von heute für Artikel, deren Begriffe noch nicht freigegeben sind
(`cron-060826`, `erdbeben-bei-deepmind-...`). Zum Zeitpunkt der Übersetzung
gab es schlicht nichts zu injizieren.

**Daraus folgt ein offener Punkt, der größer ist als der ursprüngliche:**
`backfillGlossaryLinks` fasst nur `generated_posts` an. Die Übersetzungen
holen die Marks nie nach, weil sie nur bei einer *neuen* Übersetzung gesetzt
werden. EN-, CS-, FR- und NDS-Leser sehen deshalb aktuell **keine
Lexikon-Links**, während die deutschen Artikel durchgehend verlinkt sind. Ein
Backfill über `content_translations` (Quelltext lesen,
`reinjectGlossaryMarksForTranslation`, zurückschreiben) wäre die Entsprechung
zum `relink`-Lauf - noch nicht gebaut, bewusst nicht im Rahmen dieses Auftrags
angefangen.

---

## Übersetzungs-Backfill (2026-08-06, 12:31 Uhr)

Der oben als offen notierte Punkt ist umgesetzt: neue Job-Art `translations`,
Zwilling von `relink` für `content_translations`.

**Ergebnis: von 0 auf 720 verlinkte Übersetzungszeilen.**

| Sprache | Zeilen | mit Marks | ohne Artikel |
|---|---|---|---|
| en | 224 | 218 | 3 |
| cs | 224 | 217 | 3 |
| nds | 223 | 217 | 3 |
| fr | 72 | 68 | 3 |

Prod-verifiziert: `/en/posts/shake-up-at-deepmind-…` zeigt 57 Glossar-Links,
`/en/posts/white-house-makes-ai-safety-…` 31 — vorher jeweils null.
Laufzeit 7 Minuten für 661 Zeilen (der erste, abgebrochene Lauf hatte 59
geschafft, die blieben erhalten).

### Aufbau

- `lib/glossary/backfill-translations.ts` — `relinkTranslationsBatch`,
  cursorbasiert wie `backfillGlossaryLinks`, 20 Zeilen je Batch.
- `relinkTranslationsNextBatch` in `crawl.ts` neben `relinkNextBatch`, mit
  **eigenem** Cursor (`translationsCursor`): die beiden Läufe gehen über
  verschiedene Tabellen mit verschiedenen Sortierschlüsseln und dürfen sich
  nicht gegenseitig zurücksetzen. Cursor über die Zeilen-`id` statt eines
  Zeitstempels — `translated_at` kann null sein, und bei `updated_at` schöbe
  der Lauf seinen eigenen Fortschritt vor sich her.
- Keine neue Mark-Schreib-Logik: die Injektion läuft über
  `reinjectGlossaryMarksForTranslation`, dieselbe Funktion wie in der
  Übersetzungs-Queue. Sie nimmt jetzt optional vorgeladene Listen — ohne das
  wären es zwei DB-Abfragen je Zeile für Daten, die je Sprache konstant sind
  (bei 743 Zeilen rund 1500 Roundtrips).
- Migration `20260806120000`, Panel-Knopf „Übersetzungen nachverlinken".

### Zwei Fallen, die den Zwilling von der Vorlage unterscheiden

**`content_translations.content` ist `jsonb`**, `generated_posts.content`
dagegen serialisierter Text in einer `text`-Spalte. Ein aus der Vorlage
kopiertes `JSON.stringify` hätte einen String IN die jsonb-Spalte gelegt:
gültiges JSON, aber der Renderer bekommt einen String statt eines Dokuments und
zeigt nichts an. Eigener Test dagegen.

**`generated_post_id` ist bei 12 der 743 Zeilen NULL** (Übersetzungen von
static_page und ui). Das hat den ersten Lauf nach 59 Zeilen zerlegt: ein `null`
in der `.in()`-Liste serialisiert PostgREST als Literal `"null"`, die Abfrage
stirbt mit `invalid input syntax for type uuid: "null"`, und der Wurf riss den
ganzen Tick mit. Kein `is null`-Filter kann das abfangen — der Wert wird erst
beim Serialisieren zum String. Behoben durch Filtern der IDs vor der Abfrage;
die Zeilen laufen durch den bestehenden „kein Quelltext"-Zweig.

### Was der Lauf NICHT heilt

Die Ursache bleibt: eine Übersetzung, die vor der Begriffs-Freigabe ihres
Artikels entsteht, ist weiterhin linkfrei, bis dieser Lauf sie einholt. Er ist
deshalb wiederholbar gebaut (Cursor setzt sich am Ende selbst zurück) und
gehört nach jedem größeren Freigabe- oder relink-Durchgang angestoßen. Die
Wurzel-Lösung wäre, die Übersetzungen direkt in `applyGlossaryConfirmation`
mitzuziehen — nicht gebaut, weil das den Freigabe-Pfad wieder verlängert, und
genau daran hing der Hänger von heute Morgen.
