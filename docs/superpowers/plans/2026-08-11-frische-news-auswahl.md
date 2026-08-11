# Frische, aktuelle und relevante News für die Postgenerierung

> **Für agentische Worker:** Aufgaben einzeln abarbeiten, jede endet mit einer eigenen Verifikation gegen Prod.

**Ziel:** Der Tagespost nutzt ausschließlich News, die (a) **aktuell** sind (≤ 48 h alt),
(b) **frisch** sind (in den letzten 7 Tagen nicht in einem *veröffentlichten* Post verwendet)
und (c) **relevant** (höchster Score, keine thematischen Dubletten).

**Betreiber-Entscheidungen (2026-08-11):** Aktualitätsfenster 48 h · gestaute Items
automatisch verfallen lassen · thematische Dubletten per Embedding zusammenfassen.

---

## Befund (an Prod gemessen, 2026-08-11)

Der heutige Post (`die-agenten-oekonomie-…`) ist **nicht** das Problem: 33 von 34 Items
sind taggleich, 0 Dubletten, Quellenverteilung 10/34 (29 %). Die Ursachen liegen tiefer:

| # | Befund | Beleg |
|---|---|---|
| B1 | **`getSelectedItems()` hat KEINEN Zeitfilter** — sie liefert *alle* `status='selected'`, egal wie alt | `lib/news-queue/service.ts:595-612` |
| B2 | Der Auto-Post nimmt **zuerst** alle `selected`-Items, bevor er frische nachlädt | `lib/claude/queue-article.ts:139-145`, `lib/article-jobs/service.ts:122` |
| B3 | `status='used'` wird **erst beim Veröffentlichen** gesetzt, nicht beim Draft | `lib/news-queue/service.ts:659-695`, nur Aufrufer: `app/admin/generated-articles/edit/[id]/page.tsx:686` |
| B4 | `resetStuckSelectedItems(24)` läuft **nach** dem Post-Enqueue im selben Tick | `app/api/cron/scheduled-tasks/route.ts:348` vs. `:203-246` |
| B5 | Semantische Dedup existiert bereits, aber nur über **3 Tage** | `lib/claude/queue-article.ts:263-273`, `lib/news-queue/semantic-dedup.ts:19` (Cosine ≥ 0.8) |
| B6 | Source-Diversität ist **effektiv deaktiviert** (`SOURCE_LIMIT_PERCENTAGE = 1.0`), obwohl CLAUDE.md 30 % dokumentiert | `lib/news-queue/service.ts:15` vs. `CLAUDE.md:104` |
| B7 | 1037 pending Items im Stau (578 aus Vortagen), 0 davon abgelaufen | Prod-Messung |

**Die Kette, die „veraltete News" erzeugt (B1+B2+B3+B4):** Der Cron generiert einen
**Draft**. Dessen Items bleiben `selected` (B3). Am nächsten Morgen greift
`getSelectedItems()` sie **bevorzugt und ohne Alterscheck** wieder ab (B1+B2) — der
Aufräumer, der sie freigegeben hätte, läuft erst danach (B4). Solange ein Draft nicht
veröffentlicht wird, zieht der Post also täglich dieselben, alternden Items.

---

## Aufgabe 1 — `getSelectedItems()` auf das Aktualitätsfenster begrenzen

**Warum zuerst:** Schließt B1 und damit den direktesten Weg, auf dem alte News in den
Post kommen.

**Dateien:** `lib/news-queue/service.ts:595-612` · Test: `tests/lib/news-queue-*.test.ts`

- [ ] **1.1** Test schreiben: `getSelectedItems()` liefert ein Item mit
  `email_received_at` = jetzt−72 h **nicht**, ein Item mit jetzt−12 h **schon**.
- [ ] **1.2** Test laufen lassen → muss fehlschlagen (aktuell kein Filter).
- [ ] **1.3** Filter ergänzen: `.gte('email_received_at', cutoff)` mit
  `cutoff = now − FRESHNESS_WINDOW_HOURS`. Fallback auf `queued_at` für Items ohne
  `email_received_at` (Spalte ist nullable) — sonst fallen sie still raus.
- [ ] **1.4** Konstante `FRESHNESS_WINDOW_HOURS = 48` in `lib/constants/thresholds.ts`,
  damit Auswahl und Verfall (Aufgabe 5) dieselbe Zahl verwenden.
- [ ] **1.5** Tests grün, committen.

**Verifikation:** Gegen Prod zählen, wie viele `selected`-Items älter als 48 h sind —
diese Zahl muss nach dem Fix aus der Auswahl verschwinden.

---

## Aufgabe 2 — Harte 7-Tage-Sperre gegen veröffentlichte Posts

**Warum:** Die Frische-Definition des Betreibers wörtlich umsetzen. Heute wirkt sie nur
indirekt über `status='used'` — und das greift erst nach dem Publish (B3).

**Dateien:** `lib/news-queue/service.ts` (neue Funktion) · `lib/claude/queue-article.ts:139-190`

- [ ] **2.1** Test: Ein Item, dessen `used_in_post_id` auf einen **veröffentlichten**
  Post von vor 3 Tagen zeigt, wird nicht ausgewählt. Ein Item, dessen Post ein **Draft**
  ist, bleibt wählbar (Betreiber-Definition: nur publizierte Posts sperren).
- [ ] **2.2** Test: Ein Item, dessen Post vor 8 Tagen veröffentlicht wurde, ist wieder
  wählbar (die Sperre ist ein Fenster, kein Dauerausschluss).
- [ ] **2.3** `getRecentlyUsedItemIds(supabase, days = 7)` implementieren:
  `generated_posts` mit `status='published' AND created_at >= now − 7d` → deren IDs →
  `news_queue.used_in_post_id IN (…)`. **Paginiert** laden und `.in()` in 200er-Blöcken
  stückeln (PostgREST-Grenzen, s. `reference_postgrest_grenzen`).
- [ ] **2.4** In `generateQueueArticle` nach jedem Auswahlzweig anwenden (auch auf den
  `getBalancedSelection`-Zweig, nicht nur auf `selected`).
- [ ] **2.5** Tests grün, committen.

---

## Aufgabe 3 — Semantische Coverage-Dedup von 3 auf 7 Tage

**Warum:** Aufgabe 2 sperrt *dieselbe Meldung*; diese Aufgabe sperrt *dasselbe Thema* aus
einer anderen Quelle. Der Mechanismus existiert bereits (B5) und muss nur das Fenster der
Frische-Definition treffen.

**Dateien:** `lib/claude/queue-article.ts:263-273` · `lib/news-queue/semantic-dedup.ts`

- [ ] **3.1** `recentCoverageDays: 3` → `7`.
- [ ] **3.2** Test: Ein Item, dessen Embedding ≥ 0.8 zu einem Thema aus einem vor 5 Tagen
  veröffentlichten Post liegt, wird verworfen (vorher: durchgelassen).
- [ ] **3.3** **Wichtige Einschränkung dokumentieren:** `getRecentCoverageEmbeddings`
  (`semantic-dedup.ts:139-172`) braucht `used_in_post_id` **und** eine `daily_repo_id`
  mit gefülltem `embedding`. Items ohne beides fallen still aus der Vergleichsmenge.
  Vor dem Deploy an Prod messen, wie groß dieser blinde Fleck ist — bei einer großen
  Lücke wirkt die Dedup schwächer als erwartet.
- [ ] **3.4** Tests grün, committen.

---

## Aufgabe 4 — Draft-Items nicht am Folgetag erneut einsammeln

**Warum:** Schließt B4. Ohne diese Aufgabe bleibt die Kette offen, selbst wenn 1–3 stehen:
ein nicht veröffentlichter Draft hält seine Items bis zum nächsten Lauf blockiert.

**Dateien:** `app/api/cron/scheduled-tasks/route.ts:203-246` und `:348`

- [ ] **4.1** `resetStuckSelectedItems(24)` **vor** den Post-Enqueue ziehen, damit
  hängengebliebene Items im selben Tick zuerst freigegeben und dann regulär nach Score
  und Frische neu bewertet werden.
- [ ] **4.2** Test: Ein `selected`-Item mit `selected_at` = jetzt−30 h ist nach dem
  Cron-Tick `pending` **und** war für den Post dieses Ticks nicht mehr bevorzugt.
- [ ] **4.3** Prüfen, ob die Ausnahme für `ranking_suggestions.user_action='accepted'`
  (`service.ts:957-964`) erhalten bleibt — manuell bestätigte Auswahl darf nicht verfallen.
- [ ] **4.4** Tests grün, committen.

---

## Aufgabe 5 — Gestaute Items verfallen lassen

**Warum:** B7. Die Queue zeigt 1037 Items, von denen die Hälfte nie verwendet wird; nach
Score sortiert stehen die ältesten oben und sehen aus wie „das, was ansteht".

**Dateien:** Migration + `lib/news-queue/service.ts` + `app/api/cron/scheduled-tasks/route.ts`

- [ ] **5.1** **Zuerst prüfen:** Erlaubt der CHECK-Constraint von `news_queue.status`
  den Wert `'expired'`? (`supabase/migrations/20260111140000_news_queue.sql`). Falls
  nicht, Migration schreiben — sonst schlägt jedes Update still fehl.
- [ ] **5.2** `expireStaleItems(supabase)`: `status='pending' AND expires_at < now()`
  → `status='expired'`. Kein Löschen — reversibel, und die Statistik bleibt auswertbar.
- [ ] **5.3** In den Cron einhängen (nach dem Enqueue, damit ein Lauf nie Items verliert,
  die er gerade verwenden wollte).
- [ ] **5.4** Einmalige Bereinigung des Altbestands als separater, ausdrücklich vom
  Betreiber ausgelöster Schritt — **nicht** automatisch mitlaufen lassen.
- [ ] **5.5** Admin-Ansicht: `expired` standardmäßig ausblenden, per Filter sichtbar.

---

## Aufgabe 6 — Entscheidung: Source-Diversität reaktivieren?

**Kein Auftrag, sondern ein Fund (B6).** `SOURCE_LIMIT_PERCENTAGE = 1.0`
(`lib/news-queue/service.ts:15`) hebelt den Quellen-Cap in
`get_balanced_queue_selection` vollständig aus — CLAUDE.md:104 beschreibt dagegen 30 %.
Heute fiel es nicht auf (10/34 = 29 %), aber es ist Zufall, keine Regel: Ein
publikationsstarker Newsletter kann den Post dominieren.

- [ ] **6.1** Betreiber fragen, ob der Cap zurück soll (Vorschlag: 30 %).
- [ ] **6.2** Falls ja: Wert setzen, Test über eine Auswahl mit dominanter Quelle.
- [ ] **6.3** In beiden Fällen CLAUDE.md korrigieren, damit Doku und Code übereinstimmen.

---

## Reihenfolge und Risiko

1 → 4 → 2 → 3 → 5 → 6. Aufgaben 1 und 4 schließen gemeinsam die Kette, die das gemeldete
Symptom erzeugt, und sind beide klein. 2 und 3 setzen die 7-Tage-Regel um. 5 ist
kosmetisch für die Auswahl, aber wichtig für das Vertrauen in die Anzeige.

**Hauptrisiko war:** Zu strenge Filter lassen den Pool leerlaufen (dünner Wochenendpost).
**An Prod gemessen (2026-08-11) und entkräftet:**

| Pool nach Filter | Items | Bedarf pro Post | Reserve |
|---|---|---|---|
| ≤ 48 h + frisch (7-Tage-Regel) | **791** | 34 | 23-fach |
| ≤ 24 h + frisch | 459 | 34 | 13,5-fach |

Selbst das strengere 24-h-Fenster trüge den Post noch komfortabel. Die Messung nach
Aufgabe 1–3 bleibt trotzdem im Plan — sie ist dann eine Kontrolle, keine offene Frage.

**Beobachtung am Rand:** Zum Messzeitpunkt gab es **0** `selected`-Items (wenige Stunden
zuvor: 9). `resetStuckSelectedItems` hat also gegriffen. Aufgabe 1 wirkt dadurch heute
ins Leere — die Lücke bleibt strukturell trotzdem offen, weil sie nur zwischen
Draft-Erzeugung und Aufräumlauf klafft. Genau dieses Fenster schließt Aufgabe 4.
