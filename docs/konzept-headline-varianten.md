# Konzept: Drei Headline-Vorschläge pro News-Abschnitt

Stand 2026-08-15 · Betreiber-Anforderung: Der Ghostwriter soll pro `h2` drei
Überschriften vorschlagen — eine klassisch journalistische und zwei mit
originellem Twist oder Insight.

---

## 1. Warum das mehr ist als ein Komfort-Feature

Die Überschriften sind in diesem Projekt **zweimal neu kalibriert** worden, und
zwar in entgegengesetzte Richtungen:

| Commit | Richtung | Ergebnis |
|---|---|---|
| `bb8bfea` | „intellektueller Wortwitz" als Standard | Überkorrektur ins Kryptische — „Neun Etagen KI, und die Mietgrenze verläuft im siebten Stock". Thema ohne Text nicht erkennbar. |
| `b9f07d0` | zurück auf journalistisch + pointiert | Klar, aber die Pointe ist jetzt nur noch geduldet („dezent, nie auf Kosten der Klarheit"). |
| `2e4878b` | Widerspruch zwischen `planArticle` und `writeSection` aufgelöst | Beide Stellen journalistisch. |

Das Pendeln hat einen strukturellen Grund: **Der Prompt muss sich für einen
Stil entscheiden, bevor er den Text kennt.** Welche Überschrift die richtige
ist, hängt aber am Einzelfall — manche Meldung trägt eine Pointe, andere nicht.

Drei Varianten lösen das auf. Statt den Stil im Prompt zu erraten, wird er zur
**Auswahl im Editor**. Und die Auswahl ist auswertbar (§ 6) — das ist der
eigentliche Gewinn.

---

## 2. Die drei Sorten

Bewusst NICHT die vier Varianten des `mattes-headlines`-Skills übernommen: die
Pop-Referenz-Varianten (Fight Club, GTA, Black Mirror) sind für LinkedIn
gedacht. Im Nachrichtenkontext hat der Betreiber genau diese Richtung schon
einmal verworfen.

**1 — Journalistisch (Default).**
Unverändert die heutigen `ÜBERSCHRIFT`-Regeln: Kernaussage zuerst, wer tut was,
konkret mit Namen und Zahlen, Thema aus der Überschrift allein verständlich.
Das ist die Variante, die ohne Zutun im Artikel landet.

**2 — Pointe aus dem Take.**
Nimmt die *Haltung* des Synthszr Take vorweg, bleibt aber konkret genug, dass
das Thema erkennbar ist. Nicht kryptisch: der Gegenstand muss drinstehen, die
Zuspitzung kommt dazu.
→ statt „JPMorgan bewertet seine KI-Infrastruktur mit einer Milliarde"
  etwa „JPMorgan zahlt eine Milliarde für Infrastruktur, die es selbst nicht baut"

**3 — Insight aus dem Widerspruch.**
Sucht die Spannung, die in der Meldung steckt — Selbstwiderspruch, verkehrte
Reihenfolge, das Ungesagte. Hier darf sie am weitesten gehen, muss aber das
Thema weiterhin benennen.
→ etwa „X legt den Algorithmus offen und behält die Daten, mit denen man ihn prüfen könnte"

**Harte Grenze für alle drei:** die bestehenden Verbote gelten unverändert —
kein Englisch, kein „Produktname: Erklärung", kein Negations-Reframe, kein
„Wenn X, aber Y", max ~90 Zeichen. Variante 2 und 3 dürfen pointiert sein,
nicht rätselhaft. Die drei SO-NICHT-Beispiele aus dem heutigen Prompt bleiben
als Negativanker stehen und gelten ausdrücklich auch für sie.

---

## 3. Wo die Varianten entstehen — die zentrale Entscheidung

Zwei Wege, und der Unterschied ist qualitativ, nicht nur technisch:

**A) Im bestehenden `writeSection`-Call mitproduzieren.**
Grenzkosten nahe null. Aber: Das Ausgabeformat schreibt die Überschrift als
Punkt 1, **vor** Zusammenfassung und Take. Das Modell müsste die Pointe
formulieren, bevor es sie geschrieben hat. Genau daran sind die kryptischen
Headlines von 07/2026 gescheitert.

**B) Eigener, schlanker Call nach `writeSection`.** ← **Empfehlung**
Bekommt den **fertigen** Abschnitt (Zusammenfassung + Take) als Eingabe und
leitet die Varianten 2 und 3 daraus ab. Variante 1 ist die bereits erzeugte
Überschrift und wird nicht neu generiert — sie bleibt exakt das, was heute
entsteht, und der Default ändert sich dadurch nicht.

Der Aufruf ist klein: Prompt sind die Überschriftenregeln plus rund 15 Zeilen
Text, die Antwort sind zwei Zeilen. Er läuft **nach** `enforceHeadingLength`,
damit die 90-Zeichen-Regel für alle drei gleich greift.

*Modell:* `writeSection` läuft auf Opus 4.8. Für zwei Überschriften aus
vorliegendem Text reicht Sonnet 5 — mit dem ausdrücklichen Vorbehalt, dass
Headlines schon einmal von Gemini Flash zu Opus gewandert sind, weil die
Qualität nicht reichte. Deshalb: **konfigurierbar über `getModelForUseCase`**
(neuer Use-Case `headline_variants`), Start auf Sonnet 5, A/B gegen Opus, bevor
es festgeschrieben wird.

⚠️ Beim Modellwechsel den `temperature`-Guard beachten: Sonnet 5 lehnt
`temperature` und `budget_tokens` mit 400 ab (`is2026Frontier` in
`callModelNonStreaming`).

---

## 4. Wie die Varianten mitreisen

Die Überschrift wird als `## …` in Markdown erzeugt und über
`markdown-to-tiptap` in das Artikel-JSON überführt. Markdown kann keine
Alternativen tragen — sie müssen an der Konvertierung vorbei.

**Vorschlag: als Attribut am `heading`-Node im TipTap-JSON.**

```json
{ "type": "heading",
  "attrs": { "level": 2, "queueId": "…", "headlineAlts": ["…", "…"] } }
```

Der Präzedenzfall existiert: `HeadingWithQueueId` hängt bereits ein eigenes
Attribut an genau diesen Node. Vorteile: Die Varianten überleben Speichern und
Neuladen, ohne eine zweite Ablage, und sie sind genau dort, wo der Editor sie
braucht.

⚠️ **Das Attribut MUSS in `HeadingWithQueueId` registriert werden — in beiden
Renderpfaden.** `render-static-html.ts` fängt jeden Fehler ab und liefert bei
einem unbekannten Node einen **leeren String**: der komplette Artikel
verschwände aus dem Prerender-HTML, ohne Fehler und ohne Log. Ein zusätzliches
Attribut an einem bekannten Node-Typ ist deutlich harmloser als ein neuer Typ,
aber die Registrierung ist Pflicht und gehört in den Testumfang.

*Alternative, falls sich das Attribut als heikel erweist:* eine eigene Spalte
`headline_variants` (jsonb) an `generated_posts`, verschlüsselt über die
`queueId`. Nachteil: zweite Ablage, die mit dem Artikel synchron bleiben muss —
und eine Migration, die von Hand über das Dashboard laufen müsste.

---

## 5. Wo der Redakteur wählt

**Im TipTap-Editor, Klick auf die Überschrift → Popover mit den drei
Varianten.** Auch hier gibt es das Muster schon:
`tiptap-editor-with-patterns.tsx` zeigt bei Klick auf eine markierte Stelle ein
Popover mit „Behalten / Ablehnen / Deaktivieren". Dieselbe Mechanik, andere
Inhalte.

Anzeige: die aktive Variante markiert, die beiden anderen darunter, jeweils mit
Zeichenzahl. Ein Klick tauscht den Text der Überschrift; die Alternativen
bleiben im Attribut stehen, damit die Wahl umkehrbar ist.

**Der Auto-Pfad bleibt unberührt.** Der 05:30-Cron veröffentlicht ohne
Redakteur — dort greift Variante 1, also exakt das heutige Verhalten. Das
Feature ist additiv: ohne Klick ändert sich nichts.

---

## 6. Der eigentliche Ertrag: die Wahl ist ein Messwert

Jede Auswahl beantwortet die Frage, an der sich der Prompt zweimal verhoben
hat: *Wie pointiert dürfen Überschriften sein?*

Das Edit-Learning-System (`edit_history` → `edit_diffs` →
`learned_patterns`) ist dafür bereits gebaut. Eine Variantenwahl ist ein
**saubereres Signal als eine Textänderung**: Es gibt genau drei Möglichkeiten,
die Alternativen sind bekannt, und es braucht keine Diff-Interpretation.

Nach ein paar Wochen lässt sich ablesen:
- Wählt der Betreiber überwiegend 1, ist die journalistische Kalibrierung
  bestätigt und die Varianten sind eine Komfortfunktion.
- Wählt er häufig 2 oder 3, ist der Prompt zu vorsichtig — und dann weiß man
  erstmals *belegt*, in welche Richtung, statt es zu raten.

Dafür genügt eine schmale Tabelle (`post_id`, `queueId`, `gewaehlt`,
`varianten`) — bewusst getrennt vom bestehenden Pattern-Mechanismus, der auf
Satzebene arbeitet.

---

## 7. Aufwand und Risiken

| Baustein | Aufwand | Risiko |
|---|---|---|
| Varianten-Call + Prompt | klein | gering — additiv, `writeSection` unberührt |
| Attribut am heading-Node | klein | **mittel** — Registrierung in beiden Renderpfaden, sonst leerer Prerender |
| Popover im Editor | mittel | gering — Muster vorhanden |
| Auswertung der Wahl | klein | gering — nur Schreiben, kein Eingriff |

**Laufende Kosten:** ein zusätzlicher Aufruf je Abschnitt, bei sechs bis zehn
Abschnitten pro Artikel. Mit Sonnet 5 und kurzem Prompt fällt das gegen den
bestehenden Opus-Call mit `thinking` und 16 000 Tokens kaum ins Gewicht.

**Was ich für das größte Risiko halte** — nicht technisch, sondern
inhaltlich: dass Variante 2 und 3 wieder ins Kryptische kippen. Das ist genau
einmal passiert und war der Grund für `b9f07d0`. Gegenmittel: dieselben
SO-NICHT-Beispiele im Prompt, und die Regel „das Thema muss auch in Variante 3
aus der Überschrift hervorgehen" so hart formuliert wie heute für Variante 1.

---

## 8. Entschieden (Betreiber, 2026-08-15)

| Frage | Entscheidung | Folge |
|---|---|---|
| Umfang | **Alle drei frisch erzeugen** | Auch die journalistische Variante entsteht neu — sie kennt dann den fertigen Text. Aber: das Verhalten ändert sich auch dort, wo niemand auswählt. |
| Modell | **Opus 4.8** | Dasselbe wie `writeSection`. Teurer, dafür kein Qualitätsrisiko an der Stelle mit der größten Wirkung pro Zeichen. |
| Bündel | **Von Anfang an** | Zweiter Einbauort in `writeBundleSection`. |
| Auswertung | **Sofort mitbauen** | Die Daten der Anfangswochen sind sonst verloren. |

### Was aus „alle drei frisch" folgt

Das ist die einzige Entscheidung mit Nebenwirkung, deshalb ausdrücklich:

1. **Der Varianten-Call wird Teil des Erzeugungspfads**, nicht nur ein Anhängsel
   für den Editor. Fällt er aus, darf der Artikel nicht ohne Überschrift
   dastehen. → `writeSection` erzeugt seine Überschrift weiterhin wie bisher;
   sie ist der **Rückfallwert**. Nur wenn der Varianten-Call erfolgreich
   antwortet, ersetzt Variante 1 sie.
2. **Die 90-Zeichen-Regel muss auf alle drei laufen**, nicht nur auf die erste
   (`enforceHeadingLength` nach dem Varianten-Call, je Variante).
3. **Die Änderung wirkt sofort auf den 05:30-Cron.** Vor dem Scharfschalten
   gehört ein A/B-Lauf gegen echte `news_queue`-Items — dasselbe Vorgehen wie
   bei `2e4878b`, wo genau so eine importierte Falschzahl aufgefallen ist.
