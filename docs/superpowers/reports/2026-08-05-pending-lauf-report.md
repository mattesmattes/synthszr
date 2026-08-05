# Report: Vierten Lexikonlauf (pending) auf das Job-Modell umstellen

**Datum:** 2026-08-05
**Branch:** main (HEAD war f1a7ed7)
**Auftrag:** siehe Team-Lead-Nachricht — `/api/admin/glossary-pending` (Begriffs-Freigabe eines Artikels, `components/admin/glossary-approval-panel.tsx`) von der browser-getriebenen `for(;;)`-Schleife auf `glossary_jobs` (kind='pending') umstellen, nach demselben Muster wie generate/images/relink.

## Was geändert wurde

### 1. Migration
`supabase/migrations/20260805130000_glossary_jobs_pending_kind.sql` — erweitert den CHECK-Constraint auf `glossary_jobs.kind` um `'pending'`. Idempotent (`drop constraint if exists` + neu anlegen). **Nicht angewendet**, wie gefordert.

### 2. Fachlogik extrahiert: `lib/glossary/pending-run.ts`
`runPendingUnit(supabase, postId, confirmedSlugs)` — verarbeitet genau einen vorgemerkten Kandidaten (limit=1 an `ensureConfirmedTermsExist`) und übernimmt die Abschlussbehandlung, sobald `remaining === 0`: `applyGlossaryConfirmation` mit Content aus der Datenbank, Content zurückschreiben, Vormerkliste **nur bei `linked > 0`** leeren. Liest die Vormerkliste zusätzlich VOR dem Aufruf, um Namen für das Protokoll aufzulösen (ensureConfirmedTermsExist liefert nur Slugs, und der generierte Kandidat ist danach schon aus der Liste verschwunden).

`app/api/admin/glossary-pending/route.ts` ist jetzt ein dünner Wrapper um `runPendingUnit` (kein kopierter Block). Bleibt als Direktaufruf bestehen (Konsistenz mit `/api/admin/glossary-crawl`), wird vom Panel aber nicht mehr benutzt.

### 3. Job-Modell
- `lib/glossary/jobs/service.ts`: `GlossaryJobKind` um `'pending'` erweitert. `estimateTotal` bekommt jetzt `params` als drittes Argument (Signaturänderung, Aufrufer in `createOrGetJob` angepasst) und zählt für `pending` die bestätigten Kandidaten mit `needsGeneration` aus `generated_posts.pending_glossary_terms`. Fehlen `postId`/`confirmedSlugs`, liefert es `null` ("Anzahl offen", wie bei relink).
- `lib/glossary/jobs/advance.ts`: neuer `pending`-Zweig in `runUnit`. Liest `postId`/`confirmedSlugs` aus `job.params`, ruft `runPendingUnit`. `exhausted = remaining === 0`. `overloaded = generated.length === 0 && remaining > 0` (Fortschritt-Null-Erkennung wie bei images/relink → 10-Versuche-Eskalation greift). Ohne `postId` wirft der Zweig hart (sollte die Route-Validierung schon abfangen; ein Programmierfehler soll nicht als stilles Endlos-Idle im Cron-Log verschwinden).
- `app/api/admin/glossary-jobs/route.ts`: `KINDS` um `'pending'` erweitert. `POST {kind:'pending', postId, confirmedSlugs}` validiert beide Felder separat (je eigene 400-Meldung), baut `params = {postId, confirmedSlugs}`.

### 4. Protokollzeilen — bewusste Abweichung vom Wortlaut im Auftrag

Der Auftrag nannte als Stilbeispiel `„X — erzeugt und veroeffentlicht"`. Das übernehme ich **nicht wörtlich**: bei `pending` passiert Veröffentlichung + Verlinkung laut Modul-Kommentar von `pending-run.ts` NUR am Ende (`remaining === 0`), nicht pro Begriff — die Injektion läuft über den ganzen Artikeltext und wäre pro Begriff dieselbe Arbeit N-mal. Eine Zeile „X — erzeugt und veröffentlicht" für eine Zwischen-Einheit wäre schlicht falsch (der Begriff ist zu diesem Zeitpunkt ein Draft, kein veröffentlichter Begriff). Stattdessen:
- Pro Einheit: `X — erzeugt` (Erfolg) / `X — fehlgeschlagen, siehe Server-Log` (Fehlschlag).
- Bei Abschluss (remaining===0 und linked>0) zusätzlich: `N Begriffe veröffentlicht und verlinkt`.

Falls der Team-Lead den wörtlichen Stil bevorzugt, ist das eine Ein-Zeilen-Änderung in `advance.ts:112-131`.

### 5. Panel: `components/admin/glossary-approval-panel.tsx`
`for(;;)`-Schleife (`runAll`) entfernt. Ein Klick auf „Alle N jetzt erzeugen" legt den Job an (`POST /api/admin/glossary-jobs {kind:'pending', postId, confirmedSlugs}`), danach pollt die Komponente per `useJob('pending')` (~5s Intervall, nur solange offen). `runAfterSave` löst denselben `startJob()` aus statt der alten `runAll()`.

**Sicherheitsnetz gegen den geteilten Job-Slot:** der partielle Unique-Index `glossary_jobs_one_open_per_kind` erlaubt nur EINEN offenen `pending`-Job systemweit — anders als bei generate/images/relink ist `pending` aber artikelbezogen. Ohne Gegenprüfung würde ein Operator, der zwischen zwei Artikeln mit offenen Kandidaten wechselt, den Fortschritt eines FREMDEN Artikels als den eigenen angezeigt bekommen (siehe „Bedenken" unten). Das Panel vergleicht deshalb `job.params.postId` mit dem eigenen `postId`; bei Mismatch zeigt es einen Hinweistext statt des fremden Protokolls und blendet den Start-Knopf durch den `lockedByOtherPost`-Zweig sinngemäß aus.

### 6. Code-Wiederverwendung: `components/admin/glossary-job-shared.tsx` (neu)
`useJob`/`JobLog` waren bisher lokal in `glossary-crawl-panel.tsx` definiert (nicht exportiert). Extrahiert in eine gemeinsame Datei, `JobKind` um `'pending'` erweitert, `JobView` um optionales `params` (für den Post-Abgleich im Approval-Panel). `glossary-crawl-panel.tsx` importiert jetzt von dort, keine Logik dupliziert.

## TDD-Nachweis (RED → GREEN)

Für jede neue Funktionseinheit wurde die Implementierung testweise entfernt/auf den HEAD-Stand zurückgesetzt, der Testlauf als RED dokumentiert, dann wiederhergestellt.

**`lib/glossary/pending-run.ts`** (neue Datei — RED durch Entfernen der Datei):
```
$ mv lib/glossary/pending-run.ts /tmp/pending-run.ts.bak
$ npx vitest run tests/lib/glossary-pending-run.test.ts
FAIL (5/5): Cannot find package '@/lib/glossary/pending-run'
```
Nach Wiederherstellung:
```
$ npx vitest run tests/lib/glossary-pending-run.test.ts
Test Files  1 passed (1) | Tests  5 passed (5)
```

**`lib/glossary/jobs/advance.ts`** (pending-Zweig — RED durch fehlenden Zweig, Test lief gegen den bereits implementierten Code, siehe unten für den echten Fund):
```
$ npx vitest run tests/lib/glossary-jobs-advance.test.ts
FAIL: "endet den Job (exhausted)…" — expected false to be true
```
Ursache war KEIN Implementierungsfehler, sondern eine Mock-Verunreinigung zwischen zwei Tests (siehe „Was ich zur verschwundenen Sperre / zu Fallstricken gefunden habe" unten) — nach Korrektur des Tests:
```
$ npx vitest run tests/lib/glossary-jobs-advance.test.ts
Test Files  1 passed (1) | Tests  17 passed (17)
```

**`lib/glossary/jobs/service.ts`** (estimateTotal für `pending` — RED durch Zurücksetzen auf HEAD-Version):
```
$ git show HEAD:lib/glossary/jobs/service.ts > lib/glossary/jobs/service.ts
$ npx vitest run tests/lib/glossary-jobs-service.test.ts
FAIL (1/15): "zaehlt nur bestaetigte Kandidaten…" — expected null to be 1
```
Nach Wiederherstellung der neuen Implementierung:
```
$ npx vitest run tests/lib/glossary-jobs-service.test.ts tests/lib/glossary-jobs-advance.test.ts tests/lib/glossary-pending-run.test.ts
Test Files  3 passed (3) | Tests  37 passed (37)
```

**`app/api/admin/glossary-jobs/route.ts`** (Validierung für `kind='pending'` — RED, da `pending` vor der Änderung noch nicht in `KINDS` stand):
```
$ npx vitest run tests/api/glossary-jobs-route.test.ts
FAIL (1/14): "reicht postId und confirmedSlugs fuer pending als params durch" — createOrGet 0 mal aufgerufen
```
Nach Implementierung:
```
$ npx vitest run tests/api/glossary-jobs-route.test.ts
Test Files  1 passed (1) | Tests  14 passed (14)
```

**`app/api/admin/glossary-pending/route.ts`** (Wrapper um `runPendingUnit` — RED durch Zurücksetzen auf HEAD-Version):
```
$ git show HEAD:app/api/admin/glossary-pending/route.ts > app/api/admin/glossary-pending/route.ts
$ npx vitest run tests/api/glossary-pending-route.test.ts
FAIL (2/5): runPendingUnit 0 mal aufgerufen; Fehlermeldung "supabase.from is not a function" statt "kaputt"
```
Nach Wiederherstellung:
```
$ npx vitest run tests/api/glossary-pending-route.test.ts
Test Files  1 passed (1) | Tests  5 passed (5)
```

**Gesamtsuite:**
```
$ npx vitest run
Test Files  127 passed (127) | Tests  1035 passed (1035)
```
Baseline war 1014 — 21 neue Tests (5 pending-run, 5 advance-pending, 2 service-pending, 4 admin-route-pending, 5 glossary-pending-route-wrapper), keine Regression.

```
$ npx tsc --noEmit
(keine Ausgabe — sauber)

$ npm run build
BUILD_EXIT=0
```
`.next` lag in Dropbox und wurde vor dem Build weggeschoben (`mv .next "$TMPDIR/next-old-$$"`), danach gelöscht.

## Geprüfte fremde Signaturen

- `ensureConfirmedTermsExist(supabase, postId, confirmedSlugs, limit)` — gelesen in `lib/glossary/ensure-terms.ts`, Rückgabe `{generatedSlugs, pendingRemainder}`. Wichtig: `pendingRemainder === null` heißt "nichts mehr offen", NICHT "leer" — bei bereits-existierenden Kandidaten werden diese aus der Liste entfernt, ohne in `generatedSlugs` aufzutauchen (stiller Erfolg).
- `applyGlossaryConfirmation(supabase, postId, confirmedSlugs, content)` — gelesen in `lib/glossary/confirm.ts`. `content` ist ein STRING (JSON-serialisiert), kein Objekt; Rückgabe `{content?, publishedSlugs}`, `content` nur gesetzt, wenn tatsächlich etwas injiziert wurde.
- `verifyCronAuth`/`getNextOpenJob`/`appendLog`/`finishJob`/`releaseLease`/`setAttempts` — nicht verändert, nur gelesen zum Verständnis des bestehenden Musters (advance.ts, service.ts, cron-route). Keine neue Fehlannahme gefunden.
- `new URL(request.url).searchParams` — im Admin-Route-Pattern schon korrekt vorhanden, nicht angetastet.

## Was ich zur „verschwundenen Sperre" gefunden habe

Geprüft: hält irgendetwas im Editor (Speichern-Knopf, Navigation, „ungespeicherte Änderungen") implizit an der Laufzeit der alten `for(;;)`-Schleife?

- `busy`/`stopRequested` in `GlossaryApprovalPanel` waren rein lokaler State. Die Komponente hat **keinen** Callback-Prop, der `busy` nach außen reicht (`GlossaryApprovalPanelProps` hat nur `candidates, value, onChange, postId, runAfterSave`).
- In der Editor-Seite (`app/admin/generated-articles/edit/[id]/page.tsx:1017-1023`) wird `GlossaryApprovalPanel` nur mit diesen Props verdrahtet; `runAfterSave={glossaryRunTrigger}` ist ein reiner Zähler (`useState(0)`), der nach dem Speichern hochgezählt wird — keine Kopplung an `busy`.
- Kein `beforeunload`-Handler in dieser Datei, der auf den Lauf reagiert.
- Innerhalb der Komponente selbst gab es (anders als beim Crawl-Panel) **nur einen** Knopf, dessen Sichtbarkeit von `busy` abhing — kein zweiter Knopf, der durch `busy` gesperrt wurde.

**Befund: keine verschwundene Sperre in diesem Fall.** Der Umbau war hier ohne Nebenwirkungen auf andere UI-Elemente möglich. Trotzdem eine NEUE, bewusste Sperre eingebaut (siehe Abschnitt 5 oben): der Post-Abgleich gegen `job.params.postId`, weil der geteilte Job-Slot (`kind='pending'` ist systemweit, nicht artikelweise, exklusiv) sonst den Fortschritt eines fremden Artikels anzeigen könnte.

Zusätzlicher Fund, nicht im Panel, sondern in der Testsuite selbst: `vi.clearAllMocks()` (in `beforeEach`) löscht Aufrufdaten, aber NICHT die Warteschlange von `mockImplementationOnce`. Ein Test, der absichtlich nur eine von zwei georderten `mockImplementationOnce`-Antworten verbraucht (um "die erste Einheit" zu isolieren), lässt die zweite für den NÄCHSTEN Test übrig — der bekam dadurch scheinbar zufällig falsche Rückgabewerte. Behoben, indem der Test beide Antworten konsumiert, statt das Budget künstlich zu verknappen. Kein Produktivcode-Bug, aber ein Fallstrick, der in diesem Test-Stil (viele Dateien nutzen `mockImplementationOnce`-Ketten) jederzeit wieder auftreten kann.

## Self-Review

- `git diff` aller sieben geänderten Dateien gelesen; keine treibende Schleife mehr im Diff (nur noch `for(;;)` in Kommentaren, die die ALTE Historie erklären).
- Keine unrelated Refactorings — bestehender Code in `glossary-crawl-panel.tsx` wurde nur um die extrahierten Definitionen gekürzt, sonst unverändert.
- `estimateTotal`-Signaturänderung (drittes Argument `params`) ist die einzige Änderung an einer bestehenden, exportierten Funktion außerhalb der reinen Erweiterung; einziger Aufrufer (`createOrGetJob`) mit angepasst.
- Migration nicht angewendet (wie gefordert).

## Bedenken

1. **Geteilter Job-Slot ist artikelübergreifend exklusiv.** Der Unique-Index `glossary_jobs_one_open_per_kind` lässt nur EINEN offenen `pending`-Job zu — für generate/images/relink korrekt (die sind global), für `pending` aber pro Artikel gedacht. Zwei Artikel mit offenen Kandidaten können nicht gleichzeitig einen Begriffslauf haben; ein zweiter Klick auf „Alle N jetzt erzeugen" bei Artikel B liefert (unsichtbar für den Operator, außer durch meinen neuen Hinweistext) den bereits laufenden Job von Artikel A zurück. Ich habe das im Panel abgefangen (Post-Abgleich, Hinweistext, kein Fortschritt eines fremden Artikels wird angezeigt), aber die Migration selbst NICHT geändert (das ginge über den Auftrag hinaus und betrifft eine Schema-Entscheidung, die laut Auftrag beim Team-Lead liegt). Falls das in der Praxis stört (z. B. bei zwei Autor:innen gleichzeitig), wäre ein Unique-Index auf `(kind, (params->>'postId'))` — nur für `pending` — die sauberere Lösung.
2. **Stiller Nicht-Abschluss bei fehlgeschlagenem Publish.** Schlägt `applyGlossaryConfirmation` beim letzten Schritt fehl (`linked === 0`, obwohl `remaining === 0`), markiert `advanceJob` den Job trotzdem als `done` (mein Code: `exhausted: r.remaining === 0`, unabhängig von `linked`). Die Vormerkliste bleibt dann zwar korrekt erhalten (nicht geleert), aber der Job zeigt "Fertig" an, obwohl nichts veröffentlicht wurde. Das ist **kein neuer Fehler** — die alte Browser-Schleife brach unter denselben Bedingungen genauso kommentarlos ab (`if (remaining === 0) break`, ohne Prüfung von `linked`) — aber es wäre jetzt einfacher zu fixen (z. B. `exhausted: r.remaining === 0 && (r.linked > 0 || r.generated.length === 0 && <schon vorher alles publiziert>)`). Nicht angefasst, um nicht über den Auftrag hinauszugehen; bitte bei Bedarf gesondert adressieren.
3. **Log-Wortlaut weicht vom Auftrag ab** (siehe Abschnitt 4) — bewusst, aus Genauigkeitsgründen, aber bitte gegenlesen, falls der wörtliche Stil aus Konsistenzgründen gewünscht ist.

## Geänderte / neue Dateien

- `supabase/migrations/20260805130000_glossary_jobs_pending_kind.sql` (neu, nicht angewendet)
- `lib/glossary/pending-run.ts` (neu)
- `app/api/admin/glossary-pending/route.ts` (geändert)
- `lib/glossary/jobs/service.ts` (geändert)
- `lib/glossary/jobs/advance.ts` (geändert)
- `app/api/admin/glossary-jobs/route.ts` (geändert)
- `components/admin/glossary-job-shared.tsx` (neu)
- `components/admin/glossary-crawl-panel.tsx` (geändert — nur Extraktion)
- `components/admin/glossary-approval-panel.tsx` (geändert)
- Tests: `tests/lib/glossary-pending-run.test.ts` (neu), `tests/api/glossary-pending-route.test.ts` (neu), `tests/lib/glossary-jobs-advance.test.ts` (erweitert), `tests/lib/glossary-jobs-service.test.ts` (erweitert), `tests/api/glossary-jobs-route.test.ts` (erweitert)

---

## Fix-Runde (2026-08-05, nach Review)

Review-Ergebnis: Umbau selbst akzeptiert (keine Duplizierung, Abschlussbehandlung vollständig, Migration korrekt, keine treibende Schleife, „verschwundene Sperre"-Aussage bestätigt). Bedenken 1 und 2 aus dem ersten Report **nicht akzeptiert** — konkrete Fixes verlangt. Bedenken 3 (Log-Wortlaut) akzeptiert, zwei zusätzliche Kosmetik-Funde kamen dazu. Alles unten behoben.

### 1. Abschluss ehrlich machen (`lib/glossary/pending-run.ts`, `lib/glossary/jobs/advance.ts`)

**Bug (a) `done` trotz `linked === 0`** und **Bug (b) Datenverlust bei Teil-Publish**: beide Löcher hatten dieselbe Wurzel — `runPendingUnit` prüfte nach `applyGlossaryConfirmation` nur `linked > 0` (irgendetwas veröffentlicht), nicht ob **alle** bestätigten Slugs veröffentlicht wurden.

**Fix:** `PendingRunResult` bekommt ein neues Feld `publishFailed?: string[]` — Namen der bestätigten Slugs, die nach dem Publish-Versuch NICHT `status='published'` sind (egal ob wegen Lesefehler, fehlgeschlagenem Update oder hidden/gelöscht). Berechnet als `confirmedSlugs.filter(s => !result.publishedSlugs.includes(s))`. Ist die Menge nicht leer:
- Vormerkliste bleibt unangetastet (die bestehende `if (linked > 0)`-Bedingung wurde zu `if (linked > 0 && notPublished.length === 0)`).
- Content wird trotzdem geschrieben, falls etwas injiziert wurde (Teilerfolg nicht verlieren).

In `advance.ts`'s `pending`-Zweig von `runUnit`: `publishFailed` erzeugt eine `ok:false`-Protokollzeile („N Begriffe konnten nicht veröffentlicht werden, bleiben als Entwurf liegen") und setzt ein neues `UnitOutcome`-Feld `fatal?: string`. In `advanceJob` wird `outcome.fatal` VOR `outcome.overloaded` geprüft und beendet den Job sofort mit `finishJob(..., 'error', ...)` — **ohne** die 10-Versuche-Eskalation und **ohne** `releaseLease` (der Job ist final, kein Retry-Pfad: der Fehler ist deterministisch, ein Retry würde denselben Fehlschlag nur verzögert wiederholen).

**Tests (RED→GREEN):**
```
$ npx vitest run tests/lib/glossary-pending-run.test.ts
FAIL (3/7): "leert die Vormerkliste NICHT..." erwartet result.publishFailed=['Slop'], bekam undefined;
            neuer Test "meldet publishFailed und leert die Vormerkliste NICHT..." — publishFailed undefined;
            neuer Test "nennt beim Fehlschlag den TATSAECHLICH versuchten Kandidaten..." — 'Existiert Schon' statt 'Kaputt'
```
Nach Fix:
```
$ npx vitest run tests/lib/glossary-pending-run.test.ts
Test Files  1 passed (1) | Tests  7 passed (7)
```
```
$ npx vitest run tests/lib/glossary-jobs-advance.test.ts
FAIL (2/19): "beendet den Job SOFORT als error..." — finishJob mit 'done' statt 'error' aufgerufen;
             "protokolliert die Abschlusszeile ohne die verlinkt-Zusage..." — Text enthielt noch "und verlinkt"
```
Nach Fix:
```
$ npx vitest run tests/lib/glossary-jobs-advance.test.ts tests/lib/glossary-pending-run.test.ts
Test Files  2 passed (2) | Tests  26 passed (26)
```

### 2. Cosmetik — falscher Name beim Fehlschlag

Im selben Fix wie oben behoben: `attempted` wurde vorher naiv als „erster bestätigter Kandidat mit `needsGeneration`" aus der VORHER gelesenen Liste bestimmt. `ensure-terms.ts` prüft aber die Existenz **aller** eligiblen Kandidaten auf einmal und entfernt schon vorhandene lautlos, bevor es den ersten „missing"-Kandidaten versucht. Ein bereits vorhandener erster Kandidat hätte also fälschlich als „fehlgeschlagen" gegolten, obwohl der tatsächliche (gescheiterte) Versuch einen anderen betraf.

**Fix:** `attempted` wird jetzt aus `beforeEligible` UND dem tatsächlichen Ergebnis (`generatedSlugSet`, `stillOpenSlugs`) abgeleitet — der erste Kandidat, der weder erzeugt wurde noch verschwunden (=bereits vorhanden) ist, sondern nachweislich noch offen blieb. Regressionstest oben („nennt beim Fehlschlag den TATSAECHLICH versuchten Kandidaten...") deckt das ab.

### 3. Kosmetik — Abschlusszeile ohne „und verlinkt"

`advance.ts`: Wortlaut von `„N Begriffe veröffentlicht und verlinkt"` auf `„N Begriffe veröffentlicht"` gekürzt (Option „Wortlaut kürzen" aus dem Review gewählt, nicht die content-Kopplung — `runPendingUnit` müsste sonst ein zusätzliches Feld exponieren, für eine reine Protokollzeile unverhältnismäßig). Test „protokolliert die Abschlusszeile ohne die verlinkt-Zusage..." oben.

### 4. Artikelweiser Unique-Index statt Panel-Krücken

**Migration** (`supabase/migrations/20260805130000_glossary_jobs_pending_kind.sql`, **in derselben, noch unangewendeten Datei erweitert** statt einer dritten Migration — beide Änderungen gehören zum selben, noch nicht ausgerollten Feature, niemand hat je auf dem Zwischenstand ohne Index gearbeitet):
```sql
drop index if exists glossary_jobs_one_open_per_kind;
create unique index glossary_jobs_one_open_per_kind
  on glossary_jobs (kind, coalesce(params->>'postId', ''))
  where status in ('pending', 'processing');
```
`coalesce(...,'')` wie vom Review verlangt — ohne sie wären für generate/images/relink (params.postId immer NULL) beliebig viele offene Jobs gleichzeitig erlaubt, der bestehende Doppelstart-Schutz wäre aufgehoben. **Nicht angewendet**, wie beim ersten Teil.

**`lib/glossary/jobs/service.ts`:**
- `getOpenJob` bekommt `params` als drittes Argument; ist `params.postId` gesetzt, filtert die Konflikt-Abfrage zusätzlich mit `.eq('params->>postId', postId)` — sonst würde ein Unique-Konflikt bei 'pending' den offenen Job eines FREMDEN Artikels zurückliefern.
- `createOrGetJob` reicht `params` an `getOpenJob` durch (vorher kind-only).
- `getJobStatus` bekommt ein optionales drittes Argument `postId`. **Neue Regel:** `kind === 'pending' && !postId` liefert sofort `null`, OHNE Datenbankzugriff — seit dem artikelweisen Index ist „der" pending-Job ohne postId nicht mehr eindeutig (mehrere Artikel können gleichzeitig einen offenen Job haben), eine ungefilterte Fallback-Abfrage auf den „jüngsten abgeschlossenen Job" könnte sonst den Job eines fremden Artikels liefern — exakt der Fund, der diesen Umbau ausgelöst hat.

**`app/api/admin/glossary-jobs/route.ts` (GET):** liest `postId` aus den Query-Params und reicht es IMMER durch (auch `undefined` für generate/images/relink — hält die Signatur einheitlich, `getJobStatus` ignoriert es für diese Arten ohnehin).

**Frontend:** `useJob(kind, postId?)` in `glossary-job-shared.tsx` hängt `postId` an die Fetch-URL, wenn gesetzt. `glossary-approval-panel.tsx` ruft `useJob('pending', postId)` auf und hat die komplette Fremd-Job-Logik zurückgebaut (`jobIsForThisPost`, `lockedByOtherPost`, den Hinweistext, den Guard im Auto-Start-Effekt) — die Route filtert jetzt serverseitig, das Panel sieht nie mehr einen fremden Job. `params` ist aus dem `JobView`-Interface entfernt (wurde nur für den jetzt zurückgebauten Abgleich gebraucht, sonst ungenutzt).

**Tests (RED→GREEN):**
```
$ npx vitest run tests/lib/glossary-jobs-service.test.ts
FAIL (4/20): Konflikt-Lookup filterte noch nicht nach postId (2 neue Tests in createOrGetJob (pending));
             getJobStatus fragte trotz kind=pending ohne postId die DB ab statt sofort null zu liefern (2 neue Tests)
```
Nach Fix:
```
$ npx vitest run tests/lib/glossary-jobs-service.test.ts
Test Files  1 passed (1) | Tests  20 passed (20)
```
Regressionstest explizit ergänzt: „filtert den Unique-Konflikt-Lookup NICHT nach postId, wenn keiner in params steht (generate/images/relink)" — bestand schon vor dem Fix (bestätigt, dass der bestehende Doppelstart-Schutz nicht angefasst wurde) und danach weiter.

```
$ npx vitest run tests/api/glossary-jobs-route.test.ts
FAIL (2/15): bestehender Test erwartete getJobStatus mit nur 2 Argumenten, Route ruft jetzt immer mit 3 (drittes undefined);
             neuer Test "reicht postId fuer kind=pending durch" — Route reichte postId noch nicht durch
```
Nach Fix:
```
$ npx vitest run tests/api/glossary-jobs-route.test.ts
Test Files  1 passed (1) | Tests  15 passed (15)
```
(Der bestehende Test wurde bewusst angepasst, nicht umgangen — die Signaturänderung ist eine direkte, gewollte Folge des Fixes.)

Frontend-Refaktor (`glossary-job-shared.tsx`, `glossary-approval-panel.tsx`) hat keine eigenen Komponententests (wie schon im ersten Teil) — abgesichert über `tsc --noEmit` und `npm run build`.

### Gesamtverifikation nach der Fix-Runde

```
$ npx tsc --noEmit
(keine Ausgabe — sauber)

$ npx vitest run
Test Files  127 passed (127) | Tests  1045 passed (1045)
```
Baseline vor der Fix-Runde war 1035 — 10 neue/erweiterte Assertions über 4 Testdateien, keine Regression.
```
$ npm run build
BUILD_EXIT=0
```
`.next` erneut vor dem Build weggeschoben und danach entfernt.

### Self-Review (Fix-Runde)

- `git diff --stat` nach Abschluss geprüft: nur die sechs betroffenen Produktivdateien plus vier Testdateien plus die Migration — keine unbeabsichtigten Änderungen.
- Geprüft, dass `outcome.fatal` für generate/images/relink nie gesetzt wird (ihre `runUnit`-Zweige geben das Feld nicht zurück) — der neue Check in `advanceJob` ist für sie ein No-op, bestätigt durch die weiterhin grünen Tests dieser drei Arten.
- Geprüft, dass `linked === 0 && notPublished.length === 0` bei nicht-leerem `confirmedSlugs` unerreichbar ist (wäre `notPublished` dann leer, müsste `publishedSlugs` alle Slugs enthalten, also `linked` = `confirmedSlugs.length` > 0) — kein toter Code, nur eine nicht weiter geprüfte Invariante.

### Verbleibende Bedenken

Keine neuen. Die vom Review als „Minor, späterer Durchgang" eingestuften Punkte (eingefrorene `confirmedSlugs` in `params`, Hook-Reihenfolge im Panel) wurden wie angewiesen NICHT angefasst.
