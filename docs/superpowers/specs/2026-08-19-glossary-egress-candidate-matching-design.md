# Design: Gezielte Begriffs-Kandidatensuche statt Voll-Katalog-Scan

Stand 2026-08-19. Folgt auf die Egress-Notfixes vom selben Tag (Commits
`dd179ca`, `8dc2418`): 10-Minuten-Cache → 60-Minuten-Cache für
`getMatcherTerms`/`getPublishedTermList`/`getChartProductNames`, sowie
`revalidate` der Begriffsseite von 900s auf 21600s (6h).

## Das Problem, das die Notfixes nicht lösen

`getMatcherTerms(lang)` (`lib/glossary/terms.ts`) lädt bei jedem Aufruf ALLE
veröffentlichten Begriffe (Stand 2026-08-19: 2171 Zeilen, ~220 Byte/Zeile ≈
480 KB), um sie in `lib/glossary/detail.ts` (`linkRelatedTerms`) gegen den
Erklärtext EINES einzelnen Begriffs zu matchen. Die Notfixes verlängern nur,
WIE SELTEN das passiert — nicht, WIE VIEL dabei übertragen wird. Die Kosten
skalieren linear mit dem Katalog: heute ~0,15–0,2 GB/Tag Obergrenze bei
2171 Begriffen, bei 10.000 Begriffen (plausibel in wenigen Monaten beim
aktuellen Wachstumstempo) wieder ~1 GB/Tag.

Bereits gemessen und dokumentiert (`lib/glossary/mentions.ts`,
PROD-BEFUND 2026-08-12): von 2527 Begriffen mit 16.398 Namen/Aliassen kommen
im Schnitt **17** tatsächlich in einem gegebenen Text vor. Der Voll-Katalog-Fetch
überträgt also im Schnitt >99 % Daten, die sofort wieder verworfen werden.

## Entscheidung

Eine neue Postgres-RPC (`find_glossary_candidate_terms`) verlagert genau den
Vorfilter, den `matchNameInText` (lib/glossary/mentions.ts:219-240) ohnehin
schon anwendet — `text.includes(name)`, case-insensitiv — nach Postgres. Sie
vergleicht dort, wo Egress nicht zählt (das ist reine DB-Rechenzeit, im
Compute-Plan enthalten), und überträgt nur die echten Kandidaten (~17 statt
2171 Zeilen).

**Sicherheitseigenschaft, nicht verhandelbar:** Die RPC muss eine ECHTE
OBERMENGE dessen sein, was `findGlossaryMentions`/`matchNameInText` hinterher
als Treffer akzeptieren würde. Sie ist bewusst GROSSZÜGIGER als der exakte
JS-Matcher (keine Abkürzungs-Sonderregel `isAbbreviation`, kein
Kompositum-/Flexions-Check) — ein paar zusätzliche, später verworfene
Kandidaten sind harmlos; ein fälschlich ausgeschlossener Begriff wäre ein
stiller Verlust (ein Begriff verschwindet unbemerkt aus der Verlinkung). Die
exakte Matching-Logik in `mentions.ts` bleibt UNVERÄNDERT — sie entscheidet
weiterhin endgültig, was als Treffer zählt, nur eben nur noch über die
Kandidaten, nicht über den ganzen Katalog.

**Kein Index nötig.** Das Zugriffsmuster ist "ist dieser KURZE Name Teilstring
von DIESEM Text", nicht die übliche Trigram-Situation ("ist DIESER Suchbegriff
in dieser indizierten Spalte enthalten"). `position()` über ~2171–10.000
Zeilen mit einem wenige KB großen Text ist Postgres-seitig im
Millisekundenbereich — ein GIN/Trigram-Index würde dieses Zugriffsmuster
nicht beschleunigen und ist deshalb kein Teil dieser Änderung.

## Umfang

**Im Umfang:** Der Lesepfad `lib/glossary/detail.ts` (`linkRelatedTerms`),
aufgerufen bei jedem Rendern/Revalidate einer Begriffsseite — der Pfad, der
die Egress-Eskalation verursacht hat.

**Bewusst NICHT im Umfang:**
- Die übrigen Aufrufer von `getMatcherTerms` (`confirm.ts`, `crawl.ts`,
  `translate.ts`, `jobs/advance.ts`, `article-jobs/service.ts`, diverse
  Scripts) — sie laufen im Cron-/Batch-Takt, nicht bei jedem Seitenaufruf,
  und sind damit nicht Teil der Egress-Eskalation. `getMatcherTerms` bleibt
  für sie unverändert bestehen. Ließe sich in einem Folge-Vorhaben auf
  dieselbe RPC umstellen, wenn ihr Egress-Beitrag relevant wird.
- `getPublishedTermList` (Sidebar-A-Z-Register, Sitemap, Lexikon-Index) —
  braucht strukturell die VOLLSTÄNDIGE Liste (es ist ein Verzeichnis, kein
  Text-Match) und ist bereits über den 60-Minuten-Cache aus den Notfixes
  abgedeckt.
- Der bestehende 60-Minuten-Cache in `lib/glossary/terms.ts` bleibt für die
  NICHT umgestellten Aufrufer bestehen.

## Nicht-Ziele

- Keine Änderung an der Wortgrenzen-/Kompositum-/Flexions-Logik in
  `lib/glossary/mentions.ts`.
- Keine Migration der Schreibpfade (s. „Umfang" oben).
- Kein Trigram-Index (s. Begründung oben).

## Sicherheit

Neue RPC folgt demselben, bereits geprüften Muster wie
`match_glossary_related_terms` (`supabase/migrations/20260804120000_glossary_related_terms_rpc.sql`):
`security invoker`, `set search_path = pg_catalog, public` (SEC-017-Konvention,
alle public-Funktionen dieses Projekts pinnen ihren search_path), explizites
`revoke all ... from public/anon/authenticated`, `grant execute ... to
service_role`. Keine Ausnahme von dieser Konvention.

## Erwarteter Effekt

Ersetzt einen ~480-KB-Transfer durch einen ~1-5-KB-Transfer pro
Begriffsseiten-Render (für den German-Fall; nicht-deutsche Locales sparen
zusätzlich die bisherige Übersetzungs-Abfrage über die volle Kandidatenliste).
Eliminiert außerdem die verbleibende Frische-Nebenwirkung der Notfixes: ein
neuer Begriff erscheint SOFORT rückwirkend verlinkt, nicht erst nach bis zu
60 Minuten — es gibt für diesen Pfad keinen Cache mehr, der das verzögern
könnte.
