# Report: Speicherpfad erzeugt keine Lexikonbegriffe mehr synchron

**Datum:** 2026-08-06
**Branch:** main (HEAD vor dieser Änderung: 6d62600)
**Auftrag:** siehe Team-Lead-Nachricht — `app/api/admin/generated-posts/route.ts:216` rief `ensureConfirmedTermsExist` synchron auf (bis zu 3 Begriffe à 45–90s, bis zu 270s direkt am 300s-Limit der Function). Der Speicherpfad soll nur noch den `pending`-Job anlegen und sofort antworten. Zwei Nebenbedingungen: die Freigabe bereits existierender Begriffe bleibt synchron; `pending_glossary_terms` darf nicht verfrüht geleert werden.

## Was geändert wurde

### 1. `app/api/admin/generated-posts/route.ts`

Der `PATCH`-Handler ruft `ensureConfirmedTermsExist` nicht mehr auf. Neuer Ablauf im `confirmedGlossarySlugs`-Zweig:

1. `applyGlossaryConfirmation` läuft wie bisher zuerst und synchron — veröffentlicht alle bestätigten Slugs, die bereits als `status='draft'` existieren, und injiziert die `glossaryLink`-Marks in den Content. Für Slugs, die es noch nicht gibt, trifft der `.eq('status','draft')`-Filter einfach nichts — kein Fehler, nur kein Effekt für diesen Slug.
2. Eine neue, schmale Prüfung liest `pending_glossary_terms` und stellt fest, ob **irgendein** bestätigter Slug `needsGeneration: true` trägt (dieselbe Regel wie `openCount` im Freigabe-Panel, `glossary-approval-panel.tsx:74` — dort bereits als Bedingung für den Start-Knopf etabliert).
3. Falls ja: `createOrGetJob(supabase, 'pending', { postId: id, confirmedSlugs })` — idempotent, ein zweites Speichern liefert den laufenden Job zurück statt zu scheitern (Unique-Index `glossary_jobs_one_open_per_kind`, geschlüsselt nach `(kind, postId)`). **`pending_glossary_terms` wird in diesem Zweig nicht angefasst.**
4. Falls nein (nichts musste erzeugt werden) und mindestens ein Slug wurde veröffentlicht: `pending_glossary_terms` wird geleert — derselbe Endzustand wie vor diesem Umbau für den Fall, dass es ohnehin nichts zu erzeugen gab.

`maxDuration = 300` und sein erklärender Kommentar sind raus: sie existierten ausschließlich für die jetzt entfernte synchrone Erzeugung. Die verbleibende Arbeit im PATCH-Pfad (DB-Updates, ein Job-Insert) braucht den Plattform-Default nicht zu überschreiten. Den Kommentar stehen zu lassen wäre irreführend gewesen — er behauptet ein Verhalten, das es nicht mehr gibt.

### 2. Warum genau diese Prüfung vor `createOrGetJob` — nicht einfach immer aufrufen

`createOrGetJob` legt den Job **unbedingt** an (der interne `estimateTotal`-Aufruf bestimmt nur die Anzeige-Zahl, verhindert aber keinen Insert bei `total=0`). Ohne die eigene Prüfung würde **jedes** Speichern mit ausschließlich bereits vorhandenen bestätigten Begriffen einen leeren, sich beim nächsten Cron-Tick sofort selbst schließenden Job anlegen — und dabei `applyGlossaryConfirmation` ein zweites Mal (idempotent, aber sinnlos) laufen lassen. Das Freigabe-Panel guardet exakt dagegen (`if (openCount === 0) return` vor `startJob()`); die Route zieht jetzt dieselbe Linie.

### 3. `MAX_GENERATE_PER_SAVE` — bewusst NICHT entfernt

Geprüft (`grep -rn "MAX_GENERATE_PER_SAVE\|ensureConfirmedTermsExist"` über das ganze Repo, inklusive `app/api/admin/glossary-pending/route.ts` wie gefordert):

- `app/api/admin/glossary-pending/route.ts` nutzt weder die Konstante noch `ensureConfirmedTermsExist` direkt — es ruft `runPendingUnit` auf.
- `lib/glossary/pending-run.ts` (`runPendingUnit`) ruft `ensureConfirmedTermsExist(supabase, postId, confirmedSlugs, 1)` mit **explizitem** `limit=1` — der Default greift dort nie.
- Einzige verbleibende Verwendung: `MAX_GENERATE_PER_SAVE` ist der **Default-Parameterwert** von `ensureConfirmedTermsExist`s `limit`-Argument (`lib/glossary/ensure-terms.ts:66`) — Teil der öffentlichen Signatur einer exportierten Funktion, nicht nur ein interner Implementierungsdetail.
- `tests/lib/glossary-ensure-terms.test.ts` testet diesen Default **direkt** (`deckelt die Menge pro Speichervorgang…`, importiert `MAX_GENERATE_PER_SAVE` und ruft `ensureConfirmedTermsExist` ohne explizites `limit` auf).

Die Konstante ist damit **nicht tot**: kein Produktionscode ruft die Funktion mehr ohne explizites Limit auf, aber der Default bleibt die Sicherheitsbremse gegen genau den Fehler, den dieses ganze Modul beheben sollte (unbegrenzte synchrone Erzeugung) — falls je ein künftiger Aufrufer die Funktion ohne eigenes Limit nutzt. Entfernen hieße: eine bestehende, aussagekräftige Testabdeckung kaputt machen, um einen funktionierenden Schutzmechanismus zu verlieren, ohne dass irgendetwas dadurch einfacher würde. Konstante, Default-Wert und Test bleiben unverändert.

## Geprüfte Signaturen

- `createOrGetJob(supabase, kind: GlossaryJobKind, params: Record<string, unknown> = {})` — `lib/glossary/jobs/service.ts:62`. Rückgabe `Promise<GlossaryJob>`, wirft bei einem echten Fehler (kein Unique-Violation-Fallback verfügbar) — deshalb in `try/catch`.
- `applyGlossaryConfirmation` — Signatur unverändert, nur die Aufrufstelle in der Route angepasst (kein `ensured`-Parameter mehr davor).
- `ensureConfirmedTermsExist` — unverändert, nur nicht mehr von dieser Route aufgerufen.
- `GlossaryCandidate` (`lib/glossary/types.ts`) — `slug`, `needsGeneration?: boolean` (optional, fehlt bei vor dem Umbau geschriebenen Listen — dort bedeutet „fehlt" korrekt „kein Kandidat für die Erzeugung", `.some(...)` mit `&& c.needsGeneration` behandelt `undefined` bereits korrekt als falsy).

## TDD-Nachweis

**RED** — zwei neue Tests in `tests/api/glossary-inject-on-save.test.ts`, geschrieben gegen den unveränderten Routencode:

```
$ npx vitest run tests/api/glossary-inject-on-save.test.ts
 × legt bei einem bestätigten, noch nicht existierenden Begriff einen pending-Job an, statt ihn synchron zu erzeugen
   AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
 × lässt pending_glossary_terms unangetastet, wenn EIN bestätigter Begriff schon veröffentlicht wird, ein ANDERER aber noch erzeugt werden muss
   AssertionError: expected '...' to contain 'glossaryLink'
Test Files  1 failed (1)
     Tests  2 failed | 6 passed (8)
```

Der zweite Fehlschlag hat einen strukturellen Grund, nicht den erwarteten: der alte Code ruft zusätzlich `ensureConfirmedTermsExist`s eigene Existenzprüfung auf `glossary_terms` auf, die in meinem für den NEUEN Code dimensionierten Mock-Queue keinen eigenen Eintrag hatte — dadurch verschob sich die FIFO-Reihenfolge und `applyGlossaryConfirmation` bekam die falsche kanonische Antwort. Genau das ist erwartetes RED-Verhalten: der Test ist auf die NEUE Aufrufreihenfolge zugeschnitten, die es beim alten Code noch nicht gibt.

**GREEN** — nach der Implementierung:

```
$ npx vitest run tests/api/glossary-inject-on-save.test.ts
Test Files  1 passed (1)
     Tests  8 passed (8)
```

Ein bestehender Test (`lädt den Content aus der DB nach…`) musste angepasst werden: seine Mock-Queue-Reihenfolge war auf die ALTE Aufrufreihenfolge (erst `ensureConfirmedTermsExist`s Kandidaten-Read, dann `applyGlossaryConfirmation`s Content-Fallback) zugeschnitten. Die NEUE Reihenfolge ist umgekehrt (`applyGlossaryConfirmation` läuft zuerst, meine `needsGeneration`-Prüfung danach) — die Kommentare und die Reihenfolge der Queue-Einträge wurden entsprechend korrigiert, die Assertion selbst blieb unverändert.

Der obsolet gewordene Test „erzeugt einen bestätigten, noch nicht existierenden Begriff VOR der Freigabe" (testete exakt das Verhalten, das der Auftrag abschafft) wurde durch die zwei neuen Tests ersetzt — plus einen dritten, der den bereits bestehenden Erfolgspfad (`schreibt eine glossaryLink-Mark…`) um explizite Assertions ergänzt, dass `generateAndInsertDraft` und `createOrGetJob` dabei NICHT aufgerufen werden.

## Verifikation

```
$ npx tsc --noEmit
(keine Ausgabe — sauber)

$ npx vitest run
Test Files  128 passed (128)
     Tests  1067 passed (1067)

$ npm run build
✓ Compiled successfully
```

`.next` lag wieder in Dropbox, vor jedem Build weggeschoben (`mv .next "$TMPDIR/next-old-$$"`).

**Hinweis zur Testzahl:** 1067 statt der im Auftrag genannten Baseline 1054 — das Arbeitsverzeichnis ist geteilt, und der parallele Implementer an `lib/glossary/crawl.ts`/Dubletten-Erkennung hat dort **uncommittete** Änderungen liegen (`lib/glossary/crawl.ts`, `lib/glossary/generate.ts`, `tests/lib/glossary-crawl-existing.test.ts`, `tests/lib/glossary-generate.test.ts` — sichtbar in `git status`, nicht von mir). Mein `vitest run`/`tsc`/`build` liefen zwangsläufig gegen diesen gemischten Stand mit, da beide Agents dasselbe Dateisystem teilen. Ich habe diese vier Dateien **nicht angefasst** und **nicht committet** (git add nur mit explizit benannten, eigenen Dateien — nie `-A` oder `.`). Der scheduled-tasks-Fehlschlag trat in diesem Lauf nicht auf (separat verifiziert: 3/3 grün).

## Self-Review

- `pending_glossary_terms` wird in `updateData` nur in EINEM der beiden Zweige gesetzt (Klartext: entweder der Job-Zweig fasst sie nicht an, oder der Sonst-Zweig leert sie) — kein Pfad kann versehentlich beides tun.
- Die neue `needsGeneration`-Prüfung liest `pending_glossary_terms` per `.maybeSingle()` (nicht `.single()`) — konsistent mit `ensure-terms.ts`/`pending-run.ts`, die dieselbe Spalte genauso lesen (ein fehlender Post darf diese Zugabe nicht mit einem Wurf zum Scheitern bringen).
- `createOrGetJob` steht in einem eigenen `try/catch`, das den Fehler nur loggt — dasselbe Prinzip wie das alte `ensureConfirmedTermsExist` (die Begriffs-Erzeugung/Job-Anlage ist eine Zugabe zum Speichern des Artikels, darf ihn nicht scheitern lassen).
- `confirmedSlugs` wird einmal in eine lokale, typisierte Variable extrahiert (`body.confirmedGlossarySlugs as string[]`), statt an drei Stellen erneut zu casten — kleine Aufräumung direkt im Rahmen der ohnehin geänderten Zeilen, keine Ausweitung.
- Kein `select('*')`, keine neue Spalte, keine Schema-Änderung.

## Bedenken

1. **Geteiltes Arbeitsverzeichnis mit uncommitteten Fremd-Änderungen** (s. Verifikation oben) — nicht meine Aufgabe, aber der Grund für die abweichende Testzahl. `lib/glossary/crawl.ts` und `scripts/dedupe-glossary-terms.ts` wurden nicht angefasst.
2. Die `needsGeneration`-Prüfung liest `pending_glossary_terms` per zusätzlichem Round-Trip, den `createOrGetJob`s eigener `estimateTotal`-Aufruf intern noch einmal (redundant) wiederholt, wenn ein Job tatsächlich angelegt wird — zwei kleine Selects statt einem. Eine gemeinsame, exportierte Hilfsfunktion in `service.ts` würde das vermeiden, hätte aber eine nicht angefragte Datei (`lib/glossary/jobs/service.ts`) über den reinen Aufruf hinaus verändert. Bei einer JSONB-Spalte einer Einzelzeile ist der Mehraufwand minimal; als Beobachtung notiert, falls das anders bewertet wird.
3. `MAX_GENERATE_PER_SAVE` bleibt wie oben begründet stehen — falls das nicht gewollt ist, ist das Entfernen (Konstante + Default-Parameter + der eine betroffene Test) eine kleine, isolierte Änderung.

## Nicht committet / Nicht gepusht

Wie gefordert: Änderungen liegen lokal auf `main`, noch nicht committet zum Zeitpunkt dieses Reports — Commit folgt unmittelbar danach, kein Push.
