# AI-Week Wrap-up — Design

**Datum:** 2026-08-09
**Status:** vom Betreiber freigegeben

## Zweck

Ein Wochenrückblick, der die „Thema des Tages"-Nachrichten von Montag bis
Sonnabend zu einem Post zusammenführt — mit Zwischenüberschriften, einem
Vorlauftext über die große Linie der Woche und pointierten Kurz-Takes.

Anders als der Tagesartikel verdichtet dieses Feature nicht viele unabhängige
Quellen zu je einem Abschnitt, sondern verbindet sechs fertige Abschnitte zu
einem Bogen. **Der Zusammenhang ist das Produkt** — daraus folgen die meisten
Entscheidungen unten.

## Auslöser

Eigene Seite `/admin/week-wrapup`, aufgebaut wie `/admin/create-article`:
Modellwahl, Effort, ein Knopf. Keine Kopie der Datei — die Seite ist schlanker,
weil die Item-Auswahl entfällt (die Themen stehen durch den Zeitraum fest).

## Zeitraum

Die **letzte abgeschlossene Woche Mo–Sa**. Am Sonntag oder Montag gedrückt
liefert sie dieselben sechs Tage; das Ergebnis hängt nicht am Klickzeitpunkt.

Sonntag ist bewusst nicht enthalten (Betreiber-Vorgabe „Montags bis
Sonnabend").

## Auswahl je Tag

Pro Tag genau ein Thema, in dieser Reihenfolge:

1. Der Abschnitt mit `bundleType === 'topic'` aus dem Artikel des Tages
2. Fällt der weg: der **erste** Abschnitt des Tages
3. Kein Artikel an dem Tag: der Tag entfällt

Damit sind es bis zu sechs Themen, chronologisch Mo → Sa. An Prod gemessen
(2026-08-01 bis 08-08): sieben von acht Tagen hatten genau einen
topic-Abschnitt, einer (Di 08-04) keinen — der Fallback ist kein Randfall,
sondern trat in der ersten geprüften Woche auf.

**Quelle sind die fertigen Artikel-Abschnitte, nicht die Roh-Items der
news_queue.** Sie sind redigiert, freigegeben und tragen die Original-Headline;
das Modell formuliert um, statt neu zu schreiben. Roh-Items würden einen Text
erzeugen, der inhaltlich vom veröffentlichten Artikel abweichen kann.

## Generierung: EIN Modellaufruf

Die zentrale Entscheidung. Sie folgt direkt aus der Anforderung, dass sich die
Themen aufeinander beziehen sollen: Querbezüge entstehen nur, wenn das Modell
alle sechs gleichzeitig sieht. Sechs getrennte Aufrufe könnten das strukturell
nicht.

**Eingabe:** die sechs Abschnitte im Volltext, je mit Wochentag und
Original-Headline. Rund 12.000 Zeichen.

**Ausgabe:**

```
[Vorlauf: 3–4 Zeilen — die große Linie der Woche]

## Montag — Alibaba stellt Qwen 3.8-Max vor
[Bericht, neu formuliert und reflektierter, mit Bezug auf die anderen Tage]
Synthszr Take: [2–3 Sätze, pointiert]

## Dienstag — …
```

**Überschriften:** `Wochentag — Original-Headline`. Die Chronologie wird
sichtbar, die Headline bleibt für Leser wiedererkennbar, die den Tagesartikel
kannten.

**Take-Länge:** 2–3 Sätze. Der Tagesartikel schreibt 5–7 Sätze vor
(SECTION_SYSTEM_PROMPT, Regel 4) — die Halbierung ist damit eine konkrete Zahl,
keine Stilbitte.

## Ergebnis

Ein Entwurf in `generated_posts`, wie beim Tagesartikel. Der Betreiber öffnet
ihn im Editor, prüft und veröffentlicht. Keine Automatik, kein Cron.

## Bewusst weggelassen

**Kein `article_jobs`-Eintrag.** Der Job-Mechanismus existiert, weil 40
Sektionen à 45–90 s das 300-Sekunden-Limit sprengen. Ein Aufruf über sechs
vorhandene Texte liegt bei ~60–90 s — die Job-Infrastruktur wäre hier Aufwand
ohne Gegenwert. Sollte sich das in der Praxis als knapp erweisen, ist der
Umstieg auf einen Job ein kleiner, späterer Schritt.

**Keine Kopie von `create-article/page.tsx`.** Die Seite ist 1.000+ Zeilen und
trägt die gesamte Queue-Auswahl, die hier entfällt.

## Risiken

**Leere Woche.** Sind an keinem der sechs Tage Artikel erschienen, gibt es
nichts zusammenzufassen. Die Route muss das als klare Meldung liefern, nicht als
leeren Entwurf.

**Verweigerung.** Der Wrap-up erbt das Risiko aus
[reference_modell_verweigerung]: ein Thema wie „KI entwirft Viren" kann das
Modell zur Verweigerung bringen — und hier hinge der GANZE Post daran, nicht nur
ein Abschnitt. `assertNonEmptyModelOutput` (ghostwriter-pipeline.ts) fängt das
sichtbar ab; die Meldung muss bis in die UI durchgereicht werden.

**Ein Aufruf, ein Ausfall.** Die Kehrseite der Ein-Aufruf-Architektur: es gibt
kein Teilergebnis. Das ist vertretbar, weil ein Wrap-up ohne Zusammenhang seinen
Zweck verfehlt — ein halber Wochenrückblick wäre kein brauchbares Produkt.
