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
