# Servergetriebener Lexikonlauf — Design-Spec

**Datum:** 2026-08-05
**Status:** Design freigegeben, bereit für Implementierungsplan
**Dateien im Fokus:** `components/admin/glossary-crawl-panel.tsx`, `app/api/admin/glossary-crawl/route.ts`, neu: `lib/glossary/jobs/service.ts`, `app/api/cron/glossary-jobs/route.ts`

## Problem

Die drei langen Läufe des Lexikons werden **im Browser getrieben**: Begriffe erzeugen
(`runAllTerms`, `glossary-crawl-panel.tsx:181`), Illustrationen nachziehen (:111) und
Bestandsartikel nachverlinken (:307). Alle drei sind `for(;;)`-Schleifen, die
sequenziell `await fetch(...)` aufrufen — der nächste Request geht erst raus, wenn
die vorige Antwort verarbeitet ist.

Das ist bewusst so gebaut, um `maxDuration = 300` zu umgehen (der Kommentar bei
:154 hält es fest: drei Begriffe pro Aufruf reißen das Limit, mit `limit=1`
bleibt jeder Aufruf bei 45–90 s). Der Preis ist, dass der Fortschritt am
aktiven Tab hängt.

**An einem echten Lauf am 2026-08-05 gemessen:**

| Begriff | Server fertig (`updated_at`) | UI-Protokoll | Wartezeit im Browser |
|---|---|---|---|
| Prompt Engineering | 13:53:58 | 14:04:33 | 10,5 Min |
| Provenienz (Content Credentials) | **14:05:51** | **15:25:58** | **80 Min** |
| Quality Gate | 15:27:18 | 15:37:08 | 10 Min |

Der Server braucht ~110 s je Begriff und ist nach dem Insert in 12 s vollständig
durch (`created_at` → `updated_at`). Danach steht alles, bis der Tab die Antwort
verarbeitet. Die Lücken in `glossary_terms.created_at` (715 s / 4889 s / 670 s)
spiegeln exakt die Lücken im UI-Protokoll: **Server-Leerlauf als Folge einer
Browser-Pause.**

Ursache ist die Drosselung inaktiver Tabs (Chrome Intensive Throttling nach ~5
Minuten, danach Tab Freezing), macOS App Nap oder Systemschlaf. Der Fetch läuft
im Netzwerk-Thread weiter, aber die Promise-Fortsetzung und die
`setLog`-State-Updates brauchen den Event-Loop des Tabs.

Zweiter, kleinerer Mangel derselben Wurzel: das Protokoll lebt ausschließlich im
React-State. Wer den Tab neu lädt, verliert den gesamten Verlauf, obwohl die
Arbeit getan ist.

## Ziel & Erfolgskriterien

- Ein angestoßener Lauf läuft **ohne offenen Browser** zu Ende. Tab schließen,
  Rechner in den Schlaf schicken, Netz trennen — der Lauf geht weiter.
- Der Browser **konsumiert nur Fortschritt**: er legt einen Job an und pollt
  dessen Status. Keine Fachlogik, keine Schleife, kein Treiben.
- Das Protokoll übersteht ein Neuladen des Tabs, weil es in der Datenbank steht.
- Ein Lauf von ~47 Begriffen ist in rund 1,5 Stunden durch (zwei Begriffe je
  Minutentick).
- Ein zweiter Klick kann **keinen** parallelen Lauf derselben Art starten.
- Die Fachlogik wird nicht dupliziert: Cron-Pfad und Admin-Route rufen dieselben
  Funktionen.

## Design

Das Muster ist im Repo bereits erprobt: `lib/article-jobs/service.ts` fährt den
Auto-Tagespost über eine resumable Queue, eine Phase pro Tick, mit
`last_advanced_at` als Lease. Übernommen wird das **Muster**, nicht der Code —
die Phasenmodelle haben nichts gemeinsam.

Ein Unterschied ist beabsichtigt: beim Artikel-Job treibt der Browser und der
15-Minuten-Cron ist Fallback. Hier ist es umgekehrt — **der Cron treibt, der
Browser schaut zu.**

### 1. Datenmodell (neue Tabelle)

```sql
create table glossary_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('generate','images','relink')),
  status text not null default 'pending'
    check (status in ('pending','processing','done','error','cancelled')),
  total int,                                  -- bekannte Gesamtzahl, null solange unbestimmt
  done_count int not null default 0,
  log jsonb not null default '[]'::jsonb,     -- [{at, text, ok}], für die Anzeige
  cancel_requested boolean not null default false,
  last_advanced_at timestamptz,               -- Lease gegen überlappende Ticks
  attempts int not null default 0,            -- erfolglose Ticks in Folge
  params jsonb not null default '{}'::jsonb,  -- relink: {from: 'YYYY-MM-DD'}
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Höchstens EIN offener Job je Art. Erledigt den Doppelstart auf DB-Ebene,
-- statt ihn in der UI zu verhindern.
create unique index glossary_jobs_one_open_per_kind
  on glossary_jobs (kind) where status in ('pending','processing');
```

`log` als JSONB-Array statt eigener Zeilen-Tabelle: der Verlauf wird immer
komplett gelesen (das Panel zeigt ihn als Liste), nie einzeln abgefragt, und ein
Lauf erzeugt Dutzende, nicht Millionen Einträge.

Migration über die Supabase-CLI — das Projekt ist nicht im MCP erreichbar.

### 2. Service (`lib/glossary/jobs/service.ts`)

Fünf Funktionen, bewusst schmal:

- `createOrGetJob(supabase, kind, params)` — legt an; verletzt der Insert den
  partiellen Index, wird der bestehende offene Job zurückgegeben. Idempotent,
  damit ein doppelter Klick harmlos ist. `total` wird beim Anlegen gesetzt:
  `generate` und `images` über `openCandidateCount`
  (`lib/glossary/crawl.ts:397`) bzw. die Zahl der Begriffe ohne Illustration;
  bei `relink` bleibt es **null**, weil die Zahl der noch zu prüfenden Artikel
  vom Cursor abhängt und nicht vorab feststeht. Die Anzeige muss `total = null`
  als „Anzahl offen" behandeln, nicht als Null.
- `getNextOpenJob(supabase)` — ältester Job in `pending|processing`, dessen
  `last_advanced_at` null oder älter als `LEASE_STALE_MS` ist. Gleiche Bauart
  wie `article-jobs/service.ts:207`.

  **`LEASE_STALE_MS = 360_000` (6 Minuten), und das ist kein frei gewählter
  Wert:** er MUSS über `maxDuration` (300 s) liegen. Bei einem Minutentakt
  startet während eines laufenden Ticks fünfmal ein neuer Cron. Das Lease wird
  nur *zwischen* Arbeitseinheiten gestempelt — eine einzelne Einheit kann 270 s
  ohne Stempel laufen. Wäre das Lease kürzer als die längste mögliche Einheit,
  würde ein zweiter Tick denselben Job übernehmen und derselbe Begriff zweimal
  erzeugt. Sechs Minuten liegen über allem, was ein Tick überleben kann; ein
  wirklich abgestürzter Tick blockiert damit höchstens sechs Minuten.
- `advanceJob(supabase, job)` — führt **Arbeitseinheiten innerhalb eines
  Zeitbudgets** aus (s. §3) und schreibt Fortschritt, Protokoll und Lease.
- `requestCancel(supabase, kind)` — setzt `cancel_requested`.
- `getJobStatus(supabase, kind)` — leichter Lesepfad für das Polling. Liefert
  den **offenen** Job dieser Art; gibt es keinen, den jüngsten abgeschlossenen
  (damit das Panel nach Abschluss noch Ergebnis und Protokoll zeigt, statt
  leer zu werden). Felder: `status`, `done_count`, `total`, `log`,
  `error_message`, `finished_at`.

### 3. Cron (`app/api/cron/glossary-jobs/route.ts`, `*/1 * * * *`)

`maxDuration = 300`. Ablauf je Tick:

1. `getNextOpenJob`. Kein Job → 200 und fertig (der Cron gibt immer 200, wie die
   übrigen Cron-Routen dieses Projekts).
2. `status = 'processing'`, `last_advanced_at = now()`.
3. Schleife bis **240 s Budget** verbraucht (60 s Sicherheitsabstand zum
   Funktionslimit) oder nichts mehr offen ist:
   - `cancel_requested` prüfen → `status='cancelled'`, raus.
   - **Eine Arbeitseinheit** je nach `kind`:
     - `generate` → `generateCandidates(supabase, 1)` (`lib/glossary/crawl.ts:415`)
     - `images` → `generateMissingIllustrations(supabase)` (:266)
     - `relink` → die aus dem Route-Zweig extrahierte Funktion (s. §4)
   - Protokollzeilen anhängen, `done_count` erhöhen, Lease neu stempeln.
4. Nichts mehr offen → `status='done'`, `finished_at`.

Das Zeitbudget statt einer festen Stückzahl: eine Einheit dauert je nach Begriff
45–270 s, eine feste Zahl würde entweder das Limit reißen oder Zeit verschenken.
Vor jeder weiteren Einheit wird geprüft, ob die verbleibende Zeit für die bisher
**langsamste** Einheit dieses Ticks reicht. Für die erste Einheit gibt es keinen
Messwert; dort gilt die im Route-Kommentar (`:154`) belegte Obergrenze von
**270 s** als Annahme, die erste Einheit läuft also immer, jede weitere nur bei
ausreichendem Rest. Damit bleibt der Tick auch im schlechtesten Fall unter
`maxDuration`.

**Überlast (529):** Der Begriff bleibt in der Warteschlange, `attempts` steigt,
der Tick endet. Bei Erfolg zurück auf 0. Ab **10 erfolglosen Ticks in Folge**
`status='error'` mit Meldung. Der Server darf geduldiger sein als der Browser
(der brach nach drei Runden ab), aber nicht endlos.

**Abgestürzter Tick:** Das Lease läuft ab, der nächste Cron nimmt den Job auf.
Unkritisch, weil jede Einheit atomar ist — ein Begriff ist erzeugt oder nicht.

### 4. Fachlogik entkoppeln

`generateCandidates` und `generateMissingIllustrations` sind schon aufrufbare
Funktionen in `lib/glossary/crawl.ts`, und die eigentliche Verlinkungsarbeit
steckt ebenfalls schon in `backfillGlossaryLinks`
(`lib/glossary/backfill.ts:80`).

Was bei der Nachverlinkung fehlt, ist nicht die Fachlogik, sondern die
**Orchestrierung**: Begriffsliste laden, reservierte Namen bauen, Cursor lesen
und zurückschreiben liegen inline im Route-Zweig `action === 'relink'`
(`app/api/admin/glossary-crawl/route.ts:117–141`). Diese 25 Zeilen werden als
`relinkNextBatch(supabase, { since })` nach `lib/glossary/crawl.ts` gezogen; der
Route-Zweig ruft danach dieselbe Funktion. Der Fortschritt hat mit
`writeRelinkCursor` (:135) bereits einen persistenten Cursor, es entsteht also
kein neuer Zustand.

### 5. Admin-API (`app/api/admin/glossary-jobs/route.ts`)

- `POST {kind, params}` → `createOrGetJob`, antwortet mit dem Job-Status.
- `GET ?kind=…` → `getJobStatus`.
- `PATCH {kind, cancel: true}` → `requestCancel`.

Auth wie die bestehende Crawl-Route (`credentials: 'include'`, gleiche
Admin-Prüfung).

### 6. Panel (`components/admin/glossary-crawl-panel.tsx`)

Die drei `for(;;)`-Schleifen entfallen. An ihre Stelle tritt je Lauf:

- Knopf → `POST /api/admin/glossary-jobs {kind}`.
- Ein Polling-Effekt (`setInterval`, ~5 s) liest `GET ?kind=…`, solange der
  Status offen ist, und rendert `log`, `done_count/total`, `status`.
- Stop-Knopf → `PATCH`.

Beim Öffnen des Panels wird für jede Art einmal der Status geholt: ein laufender
Job zeigt sich mitsamt Protokoll, ohne dass jemand den Lauf angestoßen haben
muss. Das Polling darf gedrosselt werden, ohne Schaden anzurichten — es treibt
nichts mehr.

## Verifikation

- **Unit-Tests** gegen einen fingierten Supabase-Client: idempotentes Anlegen
  (zweiter Aufruf liefert denselben Job), Lease-Filter (frisch gestempelter Job
  wird nicht geliefert), Cancel, `attempts`-Eskalation auf `error`,
  Protokoll-Anhang in Reihenfolge, Zeitbudget-Abbruch.
- **Migration** gegen Prod-Schema anwenden, partiellen Index mit zwei
  gleichzeitigen Inserts prüfen (der zweite muss scheitern).
- **Prod-Verifikation nach Deploy**: Job für `generate` anstoßen, Tab schließen,
  nach ~5 Minuten `glossary_terms.created_at` prüfen — die Abstände müssen bei
  ~110 s liegen, ohne Lücken. Anschließend Panel neu öffnen: das Protokoll muss
  vollständig da sein.
- **Gegenprobe zur alten Ursache**: die Lücken aus dem Problemabschnitt dürfen
  nicht mehr auftreten, auch wenn niemand zusieht.

## Out of Scope (bewusst)

- **Kein Autostart ohne Klick.** Die Auslösung bleibt wie heute ein Knopf; der
  Cron arbeitet nur ab, was angestoßen wurde. Modellaufrufe ohne menschliche
  Auslösung wären eine eigene Entscheidung.
- **Keine Parallelläufe** derselben Art, keine Prioritätsverwaltung, keine
  Warteschlange über mehrere Jobs hinaus.
- **`action=extract`** (Artikel-Crawl) bleibt ein Einzelaufruf über
  `POSTS_PER_EXTRACTION` Artikel — kein Dauerlauf, also kein Job nötig.
- **`article_jobs` wird nicht angefasst.** Der Auto-Tagespost behält sein
  browser-getriebenes Modell mit Cron-Fallback.

---

## Nachtrag: Umsetzung und offene Folge-Punkte (2026-08-05)

Umgesetzt in 12 Commits (`57ce7bf`..`dfebc3c`), 1014 Tests grün. Jeder Task
einzeln geprüft, danach ein Abschluss-Review über den gesamten Branch.

**In Prod verifiziert:** Tabelle samt partiellem Unique-Index angelegt (zweiter
offener Job derselben Art scheitert mit `23505`), Cron-Route antwortet ohne Auth
mit 401, und ein `relink`-Lauf über den Bestand lief **ohne offenen Browser** in
rund vier Minuten durch: 19:11:30 angelegt, 19:15:37 `done`, 218 Artikel neu
verlinkt, 227 Protokollzeilen, Zeitstempel in Berliner Zeit.

### Was der Review gefunden hat und was daraus folgt

Fünf Fehler stammten aus den Code-Samples des Plans, nicht aus der Umsetzung —
darunter `if (!verifyCronAuth(request))`: die Funktion gibt ein Objekt zurück,
die Prüfung wäre also immer falsy gewesen und der Cron-Endpunkt offen. Wer
künftig aus einem Plan dieser Art implementiert, sollte jede fremde Signatur im
echten Code prüfen, statt das Sample zu übernehmen.

Zwei Fehler entstanden erst im Zusammenspiel und waren in den Einzel-Reviews
unsichtbar:

- `getNextOpenJob` filterte nach Lease, nicht nach Art — `generate` und `relink`
  liefen dadurch parallel und überschrieben sich auf `settings.glossary_crawl_state`.
  Behoben durch Serialisierung: genau ein Lexikonlauf gleichzeitig.
- Eine Exception verließ `advanceJob`, die Route fing sie und antwortete
  `ok: true` — ohne `attempts` zu erhöhen. Endloswiederholung im 6-Minuten-Takt
  ohne Fehlerstatus. Behoben: Eskalation im `catch`.

### Offene Folge-Punkte (triagiert, keiner blockierend)

**Kleines Bündel, eine Datei:**
- Das Panel frischt nach Abschluss eines Laufs nichts auf (`onTermsChanged` wird
  für die drei Läufe nicht mehr gerufen) — Begriffsliste und Zähler bleiben auf
  dem Stand des Seitenaufrufs, bis jemand neu lädt.
- `stopJob` prüft `res.ok` nicht und hat kein `try/catch`, anders als die
  `start*Job`-Funktionen.

**Kosmetik, ein Commit:**
- Kommentar zu `ASSUMED_FIRST_UNIT_MS` suggeriert Wirkung; der Wert wird nie
  gelesen — und das ist tragend: wirkte er als Boden, machte jeder Tick nur eine
  Einheit und der Durchsatz bräche weg.
- Der Satz „bleibt auch im schlechtesten Fall unter `maxDuration`" trägt nicht:
  `slowestMs` ist das Maximum *bisheriger* Einheiten, eine spätere darf langsamer
  sein. Der Fall ist recoverable (Lease läuft ab), aber der Kommentar ist zu stark.
- Die `finishJob`-Fehlermeldung nennt für alle drei Arten „Modell dauerhaft
  überlastet"; bei `relink` gibt es keinen Modellaufruf.
- `cancel_requested` wird in der Tick-Schleife geprüft, aber `job` nie neu
  gelesen — der Abbruch greift erst beim nächsten Tick. Entweder Flag neu lesen
  oder den Knopf ehrlicher benennen.
- Die `open`-Berechnung ist vierfach dupliziert.

**Testschulden:** `estimateTotal`-Zweig für `images`; `requestCancel`-Test prüft
den `kind`-Filter nicht (ein weggefallenes `.eq('kind', …)` würde Jobs *aller*
Arten abbrechen, ohne dass ein Test es merkt); `Math.max`-Zweig im Zeitbudget
(ein `Math.min` würde alle Tests bestehen); `relink` mit `linked: []` und
`unchanged > 0`; POST-400 ohne `not.toHaveBeenCalled()`.

**Nur wenn Härte gewünscht:** Der Mutex ist Check-then-Act, nicht atomar (das
Fenster ist von Minuten auf Millisekunden geschrumpft, aber nicht null); ein
`pending`-Job lässt sich nur über den Cron abbrechen, bei stehendem Cron
blockiert er den partiellen Index dauerhaft.

**Nicht anfassen:** Der doppelte `readCrawlState` in `relinkNextBatch` ist
gewollt — er hält das Read-Modify-Write-Fenster kurz; ihn zu sparen vergrößerte
die Race. `setAttempts(0)` je Einheit ist durch `if (job.attempts > 0)` begrenzt.

### Randnotiz zum Migrationsverlauf

`supabase db push` ist in diesem Projekt nicht benutzbar: 15 lokale Migrationen
seit dem 04.07. stehen nicht in der Remote-Registry, `db push` verlangt deshalb
`--include-all` und würde 57 alte Migrationen erneut ausführen, darunter ein
`DROP`. Gezielt anwenden geht mit
`npx supabase db query --linked --file <migration>`.
